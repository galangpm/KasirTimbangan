import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getPool } from "@/utils/db";
import type { PoolConnection, RowDataPacket, ResultSetHeader } from "mysql2/promise";
import { SESSION_COOKIE, verifySessionToken } from "@/utils/auth";
import { promises as fs } from "fs";
import path from "path";
import { enqueueUploadJob } from "@/utils/uploadWorker";

type InvoiceItemInput = {
  fruit: string;
  weightKg: number;
  pricePerKg: number;
  totalPrice: number;
  quantity?: number;
  imageDataUrl?: string | null;
  fullImageDataUrl?: string | null;
};

type CustomerInput = {
  name: string;
  whatsapp: string;
};

interface ColumnRow extends RowDataPacket {
  COLUMN_NAME: string;
  DATA_TYPE: string;
  COLUMN_TYPE: string;
}

const getErrorMessage = (e: unknown): string => {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  try { return JSON.stringify(e); } catch { return String(e); }
};

function isDataUrl(s: unknown): s is string {
  return typeof s === "string" && s.startsWith("data:image/");
}

async function saveImageDataUrlToPublic(dataUrl: string, invoiceId: string, kind: "thumb" | "full", index: number): Promise<string> {
  const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(dataUrl);
  if (!m) {
    // Bukan data URL, kembalikan apa adanya (bisa jadi sudah URL)
    return dataUrl;
  }
  const mime = m[1].toLowerCase();
  const b64 = m[2];
  const ext = mime === "image/png" ? "png" : "jpg";
  const dir = path.join(process.cwd(), "public", "images");
  await fs.mkdir(dir, { recursive: true });
  const safeInv = String(invoiceId).replace(/[^a-zA-Z0-9]/g, "");
  const filename = `inv_${safeInv}_${index}_${kind}.${ext}`;
  const filePath = path.join(dir, filename);
  await fs.writeFile(filePath, Buffer.from(b64, "base64"));
  return `/images/${filename}`;
}

async function migrateInvoicesSchema(conn: PoolConnection) {
  // Pastikan tabel invoices ada dulu
  await conn.query(`CREATE TABLE IF NOT EXISTS invoices (
    id INT AUTO_INCREMENT PRIMARY KEY,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    payment_method VARCHAR(16) NULL
  ) ENGINE=InnoDB`);

  // Cek kolom di invoices
  const [invCols] = await conn.query<ColumnRow[]>(
    `SELECT COLUMN_NAME, DATA_TYPE, COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS 
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'invoices'`
  );
  const invColMap: Record<string, ColumnRow> = {};
  for (const c of invCols || []) invColMap[c.COLUMN_NAME] = c;
  const idCol = invColMap["id"];

  // Migrasi created_at ke DATETIME jika masih TIMESTAMP agar nilai tersimpan persis sesuai lokal (Asia/Jakarta)
  try {
    const [createdColRows] = await conn.query<ColumnRow[]>(
      `SELECT DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS 
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'invoices' AND COLUMN_NAME = 'created_at'`
    );
    const currentType = String(createdColRows?.[0]?.DATA_TYPE || "").toLowerCase();
    if (currentType === "timestamp") {
      await conn.query(`ALTER TABLE invoices MODIFY COLUMN created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP`);
    }
  } catch {}

  // Jika id bukan CHAR(36), migrasikan ke UUID
  if (!idCol || idCol.COLUMN_TYPE.toLowerCase() !== "char(36)") {
    // Tambah kolom id_uuid jika belum ada
    const hasIdUuid = !!invColMap["id_uuid"];
    if (!hasIdUuid) {
      await conn.query(`ALTER TABLE invoices ADD COLUMN id_uuid CHAR(36) NULL`);
    }
    // Isi UUID untuk setiap baris yang belum punya
    await conn.query(`UPDATE invoices SET id_uuid = UUID() WHERE id_uuid IS NULL`);

    // Pastikan tabel invoice_items ada
    await conn.query(`CREATE TABLE IF NOT EXISTS invoice_items (
      id INT AUTO_INCREMENT PRIMARY KEY,
      invoice_id INT NOT NULL,
      fruit VARCHAR(64) NOT NULL,
      weight_kg DECIMAL(10,3) NOT NULL,
      price_per_kg INT NOT NULL,
      total_price INT NOT NULL,
      quantity INT NOT NULL DEFAULT 1,
      image_data_url MEDIUMTEXT NULL,
      full_image_data_url MEDIUMTEXT NULL
    ) ENGINE=InnoDB`);

    // Cek kolom di invoice_items
    const [itmCols] = await conn.query<ColumnRow[]>(
      `SELECT COLUMN_NAME, DATA_TYPE, COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS 
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'invoice_items'`
    );
    const itmColMap: Record<string, ColumnRow> = {};
    for (const c of itmCols || []) itmColMap[c.COLUMN_NAME] = c;
    // Tambah kolom quantity bila belum ada
    if (!itmColMap["quantity"]) {
      try { await conn.query(`ALTER TABLE invoice_items ADD COLUMN quantity INT NOT NULL DEFAULT 1`); } catch {}
    }

    // Tambah kolom invoice_id_uuid jika belum ada
    if (!itmColMap["invoice_id_uuid"]) {
      await conn.query(`ALTER TABLE invoice_items ADD COLUMN invoice_id_uuid CHAR(36) NULL`);
    }

    // Map nilai UUID dari invoices ke invoice_items
    await conn.query(`UPDATE invoice_items ii JOIN invoices i ON ii.invoice_id = i.id SET ii.invoice_id_uuid = i.id_uuid WHERE ii.invoice_id_uuid IS NULL`);

    // Drop semua foreign key yang refer ke invoices
    try {
      const [fks] = await conn.query<RowDataPacket[]>(`SELECT CONSTRAINT_NAME FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE 
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'invoice_items' AND REFERENCED_TABLE_NAME = 'invoices'`);
      for (const row of fks || []) {
        try { await conn.query(`ALTER TABLE invoice_items DROP FOREIGN KEY \`${String(row.CONSTRAINT_NAME)}\``); } catch {}
      }
    } catch {}

    // Drop PK lama di invoices
    try { await conn.query(`ALTER TABLE invoices DROP PRIMARY KEY`); } catch {}

    // Rename kolom id INT lama agar tidak bentrok, lalu ganti id_uuid -> id
    try { await conn.query(`ALTER TABLE invoices CHANGE COLUMN id id_int_old INT NOT NULL`); } catch {}
    await conn.query(`ALTER TABLE invoices CHANGE COLUMN id_uuid id CHAR(36) NOT NULL`);
    // Hapus kolom id_int_old jika ada
    try { await conn.query(`ALTER TABLE invoices DROP COLUMN id_int_old`); } catch {}
    // Tambahkan PK ke kolom id baru
    try { await conn.query(`ALTER TABLE invoices ADD PRIMARY KEY (id)`); } catch {}

    // Ubah invoice_items: drop kolom invoice_id INT lama, lalu ganti invoice_id_uuid -> invoice_id CHAR(36)
    try { await conn.query(`ALTER TABLE invoice_items DROP COLUMN invoice_id`); } catch {}
    await conn.query(`ALTER TABLE invoice_items CHANGE COLUMN invoice_id_uuid invoice_id CHAR(36) NOT NULL`);

    // Tambahkan index dan FK baru bila belum ada
    try { await conn.query(`ALTER TABLE invoice_items ADD INDEX idx_invoice_id (invoice_id)`); } catch {}
    try { await conn.query(`ALTER TABLE invoice_items ADD CONSTRAINT fk_invoice FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE`); } catch {}
  }

  // Tambahkan kolom user_id pada invoices bila belum ada, serta index dan FK ke users
  try { await conn.query(`ALTER TABLE invoices ADD COLUMN user_id CHAR(36) NULL`); } catch {}
  try { await conn.query(`ALTER TABLE invoices ADD INDEX idx_invoices_user_id (user_id)`); } catch {}
  // Tambah FK ke users, abaikan bila sudah ada atau users belum ada
  try { await conn.query(`ALTER TABLE invoices ADD CONSTRAINT fk_invoices_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT`); } catch {}

  // Buat tabel logs untuk audit trail bila belum ada
  await conn.query(`CREATE TABLE IF NOT EXISTS logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    user_id CHAR(36) NOT NULL,
    action VARCHAR(64) NOT NULL,
    invoice_id CHAR(36) NULL,
    details TEXT NULL,
    INDEX idx_logs_user_id (user_id),
    INDEX idx_logs_invoice_id (invoice_id),
    CONSTRAINT fk_logs_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT,
    CONSTRAINT fk_logs_invoice FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE SET NULL
  ) ENGINE=InnoDB`);

  // Pastikan skema akhir sesuai (id CHAR(36) pada invoices, dan invoice_items.invoice_id CHAR(36))
  await conn.query(`CREATE TABLE IF NOT EXISTS invoices (
    id CHAR(36) PRIMARY KEY,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    payment_method VARCHAR(16) NULL,
    user_id CHAR(36) NULL,
    customer_uuid CHAR(36) NULL
  ) ENGINE=InnoDB`);
  await conn.query(`CREATE TABLE IF NOT EXISTS invoice_items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    invoice_id CHAR(36) NOT NULL,
    fruit VARCHAR(64) NOT NULL,
    weight_kg DECIMAL(10,3) NOT NULL,
    price_per_kg INT NOT NULL,
    total_price INT NOT NULL,
    quantity INT NOT NULL DEFAULT 1,
    image_data_url MEDIUMTEXT NULL,
    full_image_data_url MEDIUMTEXT NULL,
    INDEX idx_invoice_id (invoice_id),
    CONSTRAINT fk_invoice FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
  ) ENGINE=InnoDB`);

  // Pastikan kolom quantity ada meski tabel sudah terlanjur dibuat tanpa kolom tersebut
  try {
    const [[qtyCol]] = await conn.query<RowDataPacket[]>(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'invoice_items' AND COLUMN_NAME = 'quantity' LIMIT 1`
    );
    if (!qtyCol) {
      await conn.query(`ALTER TABLE invoice_items ADD COLUMN quantity INT NOT NULL DEFAULT 1`);
    }
  } catch {}

  // Tabel customers dan relasi customer_uuid di invoices
  await conn.query(`CREATE TABLE IF NOT EXISTS customers (
    uuid CHAR(36) PRIMARY KEY,
    name VARCHAR(128) NOT NULL,
    whatsapp VARCHAR(64) NULL,
    address VARCHAR(255) NULL,
    UNIQUE KEY unique_whatsapp (whatsapp)
  ) ENGINE=InnoDB`);
  try { await conn.query(`ALTER TABLE customers ADD COLUMN address VARCHAR(255) NULL`); } catch {}
  // Migrasi kolom whatsapp agar nullable untuk skema lama
  try { await conn.query(`ALTER TABLE customers MODIFY COLUMN whatsapp VARCHAR(64) NULL`); } catch {}
  try { await conn.query(`ALTER TABLE invoices ADD COLUMN customer_uuid CHAR(36) NULL`); } catch {}
  try { await conn.query(`ALTER TABLE invoices ADD INDEX idx_invoices_customer_uuid (customer_uuid)`); } catch {}
  try { await conn.query(`ALTER TABLE invoices ADD CONSTRAINT fk_invoices_customer FOREIGN KEY (customer_uuid) REFERENCES customers(uuid) ON DELETE SET NULL`); } catch {}
}

// Format ke 'YYYY-MM-DD HH:mm:ss' untuk timezone tertentu (mis. Asia/Jakarta)
function toMySqlTimestampInTimeZone(isoString: string, timeZone: string): string {
  const d = new Date(isoString);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (type: string): string => String(parts.find(p => p.type === type)?.value || "00");
  const y = get("year");
  const m = get("month");
  const day = get("day");
  const hh = get("hour");
  const mm = get("minute");
  const ss = get("second");
  return `${y}-${m}-${day} ${hh}:${mm}:${ss}`;
}

export async function POST(req: NextRequest) {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value || "";
  const payload = token ? verifySessionToken(token) : null;
  if (!payload) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (payload.role !== "kasir" && payload.role !== "superadmin") {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }
  try {
    const body = await req.json();
    const { items, paymentMethod, customer, clientTs } = body || {} as { items: InvoiceItemInput[]; paymentMethod?: string; customer?: CustomerInput; clientTs?: string };
    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: "items wajib diisi" }, { status: 400 });
    }
    // Validasi customer
    const rawName = String(customer?.name || "").trim();
    const rawWa = String(customer?.whatsapp || "").trim();
    function normalizeWhatsapp(inp: string): string {
      const s = inp.replace(/\s|-/g, "").trim();
      if (!s) return "";
      if (s.startsWith("+")) return s;
      if (s.startsWith("0")) return "+62" + s.slice(1);
      if (s.startsWith("62")) return "+" + s;
      // default: jika tidak ada awalan, anggap lokal Indonesia tanpa 0
      return "+62" + s;
    }
    const normalizedWa = normalizeWhatsapp(rawWa);
    const waDigits = normalizedWa.replace(/[^0-9]/g, "");
    if (!rawName) {
      return NextResponse.json({ error: "Nama customer wajib diisi" }, { status: 400 });
    }
    if (normalizedWa) {
      if (waDigits.length < 10 || waDigits.length > 15) {
        return NextResponse.json({ error: "Nomor WhatsApp tidak valid" }, { status: 400 });
      }
    }

    const pool = getPool();
    const conn = await pool.getConnection();
    try {
      // Pastikan sesi DB memakai Asia/Jakarta agar NOW() dan operasi waktu konsisten
      try { await conn.query("SET time_zone = '+07:00'"); } catch {}
      await conn.beginTransaction();

      await migrateInvoicesSchema(conn);

      // Validasi bahwa user yang melakukan request ada di tabel users
      const [[userRow]] = await conn.query<RowDataPacket[]>(
        "SELECT id FROM users WHERE id = ? LIMIT 1",
        [String(payload.id)]
      );
      if (!userRow) {
        await conn.rollback();
        conn.release();
        return NextResponse.json({ ok: false, error: "User tidak ditemukan" }, { status: 400 });
      }

      // Pastikan/ambil UUID customer
      let customerUuid: string = "";
      if (normalizedWa) {
        // Jika WA tersedia, gunakan sebagai kunci unik
        const [[custRow]] = await conn.query<RowDataPacket[]>(
          `SELECT uuid FROM customers WHERE whatsapp = ? LIMIT 1`,
          [normalizedWa]
        );
        customerUuid = String(custRow?.uuid || "");
        if (!customerUuid) {
          const [[newCust]] = await conn.query<RowDataPacket[]>(`SELECT UUID() AS uuid`);
          customerUuid = String(newCust.uuid);
          await conn.query(
            `INSERT INTO customers (uuid, name, whatsapp) VALUES (?, ?, ?)`,
            [customerUuid, rawName, normalizedWa]
          );
        } else {
          // Update nama jika berubah (opsional)
          try { await conn.query(`UPDATE customers SET name = ? WHERE uuid = ?`, [rawName, customerUuid]); } catch {}
        }
      } else {
        // Jika WA kosong, buat customer baru dengan whatsapp NULL
        const [[newCust]] = await conn.query<RowDataPacket[]>(`SELECT UUID() AS uuid`);
        customerUuid = String(newCust.uuid);
        await conn.query(
          `INSERT INTO customers (uuid, name, whatsapp) VALUES (?, ?, NULL)`,
          [customerUuid, rawName]
        );
      }

      // Generate UUID untuk invoice, lalu insert
      const [[uuidRow]] = await conn.query<RowDataPacket[]>("SELECT UUID() AS uuid");
      const invoiceId: string = String(uuidRow.uuid);

      // Tentukan created_at berdasarkan timestamp dari klien, format ke Asia/Jakarta (GMT+7)
      let clientIso = typeof clientTs === "string" && clientTs ? clientTs : new Date().toISOString();
      // Jika parsing gagal, fallback ke waktu server
      if (isNaN(Date.parse(clientIso))) clientIso = new Date().toISOString();
      const createdAtJakartaForDb = toMySqlTimestampInTimeZone(clientIso, "Asia/Jakarta");

      await conn.query(
        "INSERT INTO invoices (id, created_at, payment_method, user_id, customer_uuid) VALUES (?, ?, ?, ?, ?)",
        [invoiceId, createdAtJakartaForDb, paymentMethod || null, String(payload.id), customerUuid]
      );

      const savedImages: Array<{ thumbUrl: string | null; fullUrl: string | null }> = [];
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        // Simpan nilai yang dikirim; upload file dilakukan di background worker
        let thumbFinal = it.imageDataUrl ? String(it.imageDataUrl) : null;
        let fullFinal = it.fullImageDataUrl ? String(it.fullImageDataUrl) : null;
        if (!thumbFinal && fullFinal) thumbFinal = fullFinal;
        if (!fullFinal && thumbFinal) fullFinal = thumbFinal;
        savedImages.push({ thumbUrl: thumbFinal, fullUrl: fullFinal });
        const qty = Number(it.quantity || 1);
        const [res] = await conn.query<ResultSetHeader>(
          `INSERT INTO invoice_items (
            invoice_id, fruit, weight_kg, price_per_kg, total_price, quantity, image_data_url, full_image_data_url
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            invoiceId,
            it.fruit,
            it.weightKg,
            it.pricePerKg,
            it.totalPrice,
            qty,
            thumbFinal,
            fullFinal,
          ]
        );
        const invoiceItemId = Number(res.insertId || 0);

        // Mode manual: jangan auto-enqueue upload saat membuat invoice.
        // Gambar disimpan apa adanya (data URL atau URL) di kolom invoice_items.
        // Enqueue akan dilakukan via endpoint /api/uploads/sync atau tombol Sync di UI.
      }

      // Validasi otomatis: bandingkan created_at tersimpan (anggap Asia/Jakarta) vs clientTs (UTC).
      // Jika selisih > 120 detik, koreksi created_at dan tulis log.
      try {
        const [[createdRow]] = await conn.query<RowDataPacket[]>(
          "SELECT created_at FROM invoices WHERE id = ? LIMIT 1",
          [invoiceId]
        );
        const dbLocalStr = String(createdRow?.created_at || "");
        const dbIsoWithTZ = dbLocalStr ? dbLocalStr.replace(" ", "T") + "+07:00" : "";
        const dbCreated = new Date(dbIsoWithTZ);
        const clientCreated = new Date(clientIso);
        const diffSec = Math.abs(Math.round((dbCreated.getTime() - clientCreated.getTime()) / 1000));
        if (Number.isFinite(diffSec) && diffSec > 120) {
          // Koreksi ke waktu dari klien dan catat di logs
          await conn.query("UPDATE invoices SET created_at = ? WHERE id = ?", [createdAtJakartaForDb, invoiceId]);
          const detailsMismatch = `timestamp_mismatch diff=${diffSec}s; db_local_jkt=${dbLocalStr}; client_utc=${clientCreated.toISOString()}`;
          try {
            await conn.query(
              `INSERT INTO logs (user_id, action, invoice_id, details) VALUES (?, 'timestamp_validation', ?, ?)`,
              [String(payload.id), invoiceId, detailsMismatch]
            );
          } catch {}
        }
      } catch {}

      // Tulis log pembuatan invoice
      const totalGrand = items.reduce((acc, it) => acc + Number(it.totalPrice || 0), 0);
      const itemsCount = items.length;
      const detailsStr = `method=${paymentMethod || ""}; items=${itemsCount}; total=${totalGrand}; customer=${rawName}:${normalizedWa}`;
      try {
        await conn.query(
          `INSERT INTO logs (user_id, action, invoice_id, details) VALUES (?, 'create_invoice', ?, ?)`,
          [String(payload.id), invoiceId, detailsStr]
        );
      } catch {}

      await conn.commit();
      conn.release();
      return NextResponse.json({ ok: true, invoice: { id: invoiceId }, images: savedImages }, { status: 200 });
    } catch (e) {
      await conn.rollback();
      conn.release();
      throw e;
    }
  } catch (e: unknown) {
    // Gagal menyimpan nota: kembalikan error agar frontend tidak melanjutkan ke detail
    return NextResponse.json({ ok: false, error: getErrorMessage(e) || "Gagal menyimpan nota" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const page = Math.max(1, Number(url.searchParams.get("page") || "1"));
    const pageSizeRaw = Number(url.searchParams.get("pageSize") || "10");
    const pageSize = Math.min(100, Math.max(1, isNaN(pageSizeRaw) ? 10 : pageSizeRaw));
    const dateFrom = url.searchParams.get("dateFrom"); // format: YYYY-MM-DD
    const dateTo = url.searchParams.get("dateTo");     // format: YYYY-MM-DD
    const q = url.searchParams.get("q");               // kata kunci (ID atau metode)
    const groupBy = url.searchParams.get("groupBy");   // agregasi khusus, misal: fruit
    const meta = (url.searchParams.get("meta") || "").toLowerCase(); // meta endpoint ringkas
    const range = (url.searchParams.get("range") || "").toLowerCase(); // dukungan range cepat
    const mineParam = (url.searchParams.get("mine") || "").toLowerCase() === "true"; // filter khusus milik user sendiri
    const statusParam = (url.searchParams.get("status") || "").toLowerCase(); // filter status: paid/pending

    // Baca session untuk kebutuhan filter "mine"
    const cookieStore = await cookies();
    const token = cookieStore.get(SESSION_COOKIE)?.value || "";
    const payload = token ? verifySessionToken(token) : null;

    const pool = getPool();
    const conn = await pool.getConnection();
    try {
      // Pastikan sesi DB memakai Asia/Jakarta agar NOW() dan operasi waktu konsisten
      try { await conn.query("SET time_zone = '+07:00'"); } catch {}
      // Hindari migrasi berat pada setiap GET; cukup pastikan tabel ada.
      await conn.query(`CREATE TABLE IF NOT EXISTS invoices (
        id CHAR(36) PRIMARY KEY,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        payment_method VARCHAR(16) NULL,
        user_id CHAR(36) NULL
      ) ENGINE=InnoDB`);
      await conn.query(`CREATE TABLE IF NOT EXISTS invoice_items (
        id INT AUTO_INCREMENT PRIMARY KEY,
        invoice_id CHAR(36) NOT NULL,
        fruit VARCHAR(64) NOT NULL,
        weight_kg DECIMAL(10,3) NOT NULL,
        price_per_kg INT NOT NULL,
        total_price INT NOT NULL,
        quantity INT NOT NULL DEFAULT 1,
        image_data_url MEDIUMTEXT NULL,
        full_image_data_url MEDIUMTEXT NULL,
        INDEX idx_invoice_id (invoice_id)
      ) ENGINE=InnoDB`);

      // Pastikan kolom quantity ada (untuk DB yang sudah terbuat sebelumnya tanpa kolom quantity)
      try {
        const [[qtyColGet]] = await conn.query<RowDataPacket[]>(
          `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'invoice_items' AND COLUMN_NAME = 'quantity' LIMIT 1`
        );
        if (!qtyColGet) {
          await conn.query(`ALTER TABLE invoice_items ADD COLUMN quantity INT NOT NULL DEFAULT 1`);
        }
      } catch {}

      // Meta endpoint: fingerprint perubahan untuk 24 jam terakhir agar seeding efisien
      if (meta === "last24") {
        // Jika diminta hanya milik user sendiri, pastikan user terautentikasi dan filter berdasarkan user_id
        let cntSql = `SELECT COUNT(*) AS cnt, MAX(created_at) AS latest, COUNT(payment_method) AS paid
           FROM invoices WHERE created_at >= NOW() - INTERVAL 1 DAY`;
        let revSql = `SELECT COALESCE(SUM(ii.total_price), 0) AS revenue
           FROM invoice_items ii JOIN invoices i ON ii.invoice_id = i.id
           WHERE i.created_at >= NOW() - INTERVAL 1 DAY`;
        const paramsMeta: string[] = [];
        if (mineParam) {
          if (!payload) { conn.release(); return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 }); }
          cntSql += ` AND user_id = ?`;
          revSql += ` AND i.user_id = ?`;
          paramsMeta.push(String(payload.id));
        }
        const [[cntRow]] = paramsMeta.length ? await conn.query<RowDataPacket[]>(cntSql, paramsMeta) : await conn.query<RowDataPacket[]>(cntSql);
        const [[revRow]] = paramsMeta.length ? await conn.query<RowDataPacket[]>(revSql, paramsMeta) : await conn.query<RowDataPacket[]>(revSql);
        const count = Number((cntRow as RowDataPacket)?.cnt || 0);
        const latest = String((cntRow as RowDataPacket)?.latest || "");
        const paid = Number((cntRow as RowDataPacket)?.paid || 0);
        const revenue = Number((revRow as RowDataPacket)?.revenue || 0);
        const fingerprint = `${count}:${paid}:${latest}:${revenue}`;
        conn.release();
        return NextResponse.json({ ok: true, fingerprint, meta: { count, paid, latest, revenue } }, { status: 200 });
      }

      // Jika diminta agregasi per jenis buah, gunakan jalur khusus ini
      if ((groupBy || "").toLowerCase() === "fruit") {
        const wherePartsFruit: string[] = [];
        const paramsFruit: Array<string> = [];
        if (dateFrom) { wherePartsFruit.push("i.created_at >= ?"); paramsFruit.push(`${dateFrom} 00:00:00`); }
        if (dateTo) { wherePartsFruit.push("i.created_at <= ?"); paramsFruit.push(`${dateTo} 23:59:59`); }
        if (q) {
          // Izinkan pencarian pada ID invoice, metode pembayaran, atau nama buah
          wherePartsFruit.push("(i.id LIKE ? OR i.payment_method LIKE ? OR ii.fruit LIKE ?)");
          paramsFruit.push(`%${q}%`);
          paramsFruit.push(`%${q}%`);
          paramsFruit.push(`%${q}%`);
        }
        if (mineParam) {
          if (!payload) { conn.release(); return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 }); }
          wherePartsFruit.push("i.user_id = ?");
          paramsFruit.push(String(payload.id));
        }
        const whereSqlFruit = wherePartsFruit.length ? `WHERE ${wherePartsFruit.join(" AND ")}` : "";

        const sqlFruit = `SELECT ii.fruit AS fruit,
            COALESCE(SUM(ii.weight_kg), 0) AS total_kg,
            COALESCE(SUM(ii.total_price), 0) AS revenue,
            COUNT(ii.id) AS items_count,
            CASE WHEN SUM(ii.weight_kg) > 0 THEN ROUND(SUM(ii.total_price) / SUM(ii.weight_kg)) ELSE 0 END AS avg_price_per_kg
          FROM invoice_items ii
          JOIN invoices i ON ii.invoice_id = i.id
          ${whereSqlFruit}
          GROUP BY ii.fruit
          ORDER BY revenue DESC`;
        let rowsFruitRes;
        if (paramsFruit.length) {
          rowsFruitRes = await conn.query(sqlFruit, paramsFruit);
        } else {
          rowsFruitRes = await conn.query(sqlFruit);
        }
        const [rowsFruit] = rowsFruitRes as unknown as [RowDataPacket[]];
        conn.release();
        return NextResponse.json({ ok: true, data: rowsFruit }, { status: 200 });
      }

      // Bangun klausa WHERE untuk list, dengan dukungan range=last24 yang akurat 24 jam
      const whereParts: string[] = [];
      const params: Array<string> = [];
      if (range === "last24") {
        whereParts.push("i.created_at >= NOW() - INTERVAL 1 DAY");
      } else {
        if (dateFrom) { whereParts.push("i.created_at >= ?"); params.push(`${dateFrom} 00:00:00`); }
        if (dateTo) { whereParts.push("i.created_at <= ?"); params.push(`${dateTo} 23:59:59`); }
      }
      if (q) {
        whereParts.push("(i.id LIKE ? OR i.payment_method LIKE ?)");
        params.push(`%${q}%`);
        params.push(`%${q}%`);
      }
      if (statusParam === "paid") {
        whereParts.push("i.payment_method IS NOT NULL");
      } else if (statusParam === "pending") {
        whereParts.push("i.payment_method IS NULL");
      }
      if (mineParam) {
        if (!payload) { conn.release(); return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 }); }
        whereParts.push("i.user_id = ?");
        params.push(String(payload.id));
      }
      const whereSql = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";

      // Total count untuk pagination
      const countSql = `SELECT COUNT(*) AS total FROM invoices i ${whereSql}`;
      let countRowsRes;
      if (params.length) { countRowsRes = await conn.query(countSql, params); } else { countRowsRes = await conn.query(countSql); }
      const [[countRow]] = countRowsRes as unknown as [RowDataPacket[]];
      const total: number = Number((countRow as RowDataPacket)?.total || 0);
      const totalPages = Math.max(1, Math.ceil(total / pageSize));
      const offset = (page - 1) * pageSize;

      // Data list nota sederhana tanpa agregat untuk memastikan kompatibilitas MariaDB
      const sql = `SELECT i.id, i.created_at, i.payment_method
         FROM invoices i
         ${whereSql}
         ORDER BY i.created_at DESC
         LIMIT ${offset}, ${pageSize}`;
      let rowsRes;
      if (params.length) { rowsRes = await conn.query(sql, params); } else { rowsRes = await conn.query(sql); }
      const [rows] = rowsRes as unknown as [RowDataPacket[]];
      // Hitung agregat per invoice secara terpisah agar aman dari masalah GROUP BY
      const data: Array<{ id: string; created_at: string; payment_method: string | null; grand_total: number; items_count: number; total_weight: number; }> = [];
      for (const r of rows || []) {
        const [[agg]] = await conn.query<RowDataPacket[]>(
          `SELECT 
             COALESCE(SUM(total_price), 0) AS grand_total, 
             COUNT(id) AS items_count,
             COALESCE(SUM(weight_kg), 0) AS total_weight
           FROM invoice_items 
           WHERE invoice_id = ?`,
          [r.id as string]
        );
        data.push({ 
          id: String(r.id),
          created_at: String(r.created_at),
          payment_method: (r.payment_method == null ? null : String(r.payment_method)),
          grand_total: Number((agg as RowDataPacket)?.grand_total || 0),
          items_count: Number((agg as RowDataPacket)?.items_count || 0),
          total_weight: Number((agg as RowDataPacket)?.total_weight || 0)
        });
      }

      conn.release();
      return NextResponse.json({ ok: true, page, pageSize, total, totalPages, data }, { status: 200 });
    } catch (e) {
      conn.release();
      throw e;
    }
  } catch (e: unknown) {
    // Fallback aman: kembalikan list kosong agar frontend tetap berfungsi tanpa error
    return NextResponse.json({
      ok: true,
      page: 1,
      pageSize: 10,
      total: 0,
      totalPages: 1,
      data: [],
      warning: getErrorMessage(e) || "Invoices API error"
    }, { status: 200 });
  }
}