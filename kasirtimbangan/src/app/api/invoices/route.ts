import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/utils/db";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";

type InvoiceItemInput = {
  fruit: string;
  weightKg: number;
  pricePerKg: number;
  totalPrice: number;
  imageDataUrl?: string | null;
  fullImageDataUrl?: string | null;
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

async function migrateInvoicesSchema(conn: PoolConnection) {
  // Pastikan tabel invoices ada dulu
  await conn.query(`CREATE TABLE IF NOT EXISTS invoices (
    id INT AUTO_INCREMENT PRIMARY KEY,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
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

  // Pastikan skema akhir sesuai (id CHAR(36) pada invoices, dan invoice_items.invoice_id CHAR(36))
  await conn.query(`CREATE TABLE IF NOT EXISTS invoices (
    id CHAR(36) PRIMARY KEY,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    payment_method VARCHAR(16) NULL
  ) ENGINE=InnoDB`);
  await conn.query(`CREATE TABLE IF NOT EXISTS invoice_items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    invoice_id CHAR(36) NOT NULL,
    fruit VARCHAR(64) NOT NULL,
    weight_kg DECIMAL(10,3) NOT NULL,
    price_per_kg INT NOT NULL,
    total_price INT NOT NULL,
    image_data_url MEDIUMTEXT NULL,
    full_image_data_url MEDIUMTEXT NULL,
    INDEX idx_invoice_id (invoice_id),
    CONSTRAINT fk_invoice FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
  ) ENGINE=InnoDB`);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { items, paymentMethod } = body || {} as { items: InvoiceItemInput[]; paymentMethod?: string };
    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: "items wajib diisi" }, { status: 400 });
    }

    const pool = getPool();
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      await migrateInvoicesSchema(conn);

      // Generate UUID untuk invoice, lalu insert
      const [[uuidRow]] = await conn.query<RowDataPacket[]>("SELECT UUID() AS uuid");
      const invoiceId: string = String(uuidRow.uuid);

      await conn.query(
        "INSERT INTO invoices (id, payment_method) VALUES (?, ?)",
        [invoiceId, paymentMethod || null]
      );

      for (const it of items) {
        await conn.query(
          `INSERT INTO invoice_items (
            invoice_id, fruit, weight_kg, price_per_kg, total_price, image_data_url, full_image_data_url
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            invoiceId,
            it.fruit,
            it.weightKg,
            it.pricePerKg,
            it.totalPrice,
            it.imageDataUrl ?? null,
            it.fullImageDataUrl ?? null,
          ]
        );
      }

      await conn.commit();
      conn.release();
      return NextResponse.json({ ok: true, invoice: { id: invoiceId } }, { status: 200 });
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

    const pool = getPool();
    const conn = await pool.getConnection();
    try {
      // Hindari migrasi berat pada setiap GET; cukup pastikan tabel ada.
      await conn.query(`CREATE TABLE IF NOT EXISTS invoices (
        id CHAR(36) PRIMARY KEY,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        payment_method VARCHAR(16) NULL
      ) ENGINE=InnoDB`);
      await conn.query(`CREATE TABLE IF NOT EXISTS invoice_items (
        id INT AUTO_INCREMENT PRIMARY KEY,
        invoice_id CHAR(36) NOT NULL,
        fruit VARCHAR(64) NOT NULL,
        weight_kg DECIMAL(10,3) NOT NULL,
        price_per_kg INT NOT NULL,
        total_price INT NOT NULL,
        image_data_url MEDIUMTEXT NULL,
        full_image_data_url MEDIUMTEXT NULL,
        INDEX idx_invoice_id (invoice_id)
      ) ENGINE=InnoDB`);

      // Meta endpoint: fingerprint perubahan untuk 24 jam terakhir agar seeding efisien
      if (meta === "last24") {
        const [[cntRow]] = await conn.query<RowDataPacket[]>(
          `SELECT COUNT(*) AS cnt, MAX(created_at) AS latest, COUNT(payment_method) AS paid
           FROM invoices WHERE created_at >= NOW() - INTERVAL 1 DAY`
        );
        const [[revRow]] = await conn.query<RowDataPacket[]>(
          `SELECT COALESCE(SUM(ii.total_price), 0) AS revenue
           FROM invoice_items ii JOIN invoices i ON ii.invoice_id = i.id
           WHERE i.created_at >= NOW() - INTERVAL 1 DAY`
        );
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
      const data: Array<{ id: string; created_at: string; payment_method: string | null; grand_total: number; items_count: number; }> = [];
      for (const r of rows || []) {
        const [[agg]] = await conn.query<RowDataPacket[]>(
          `SELECT COALESCE(SUM(total_price), 0) AS grand_total, COUNT(id) AS items_count FROM invoice_items WHERE invoice_id = ?`,
          [r.id as string]
        );
        data.push({ 
          id: String(r.id),
          created_at: String(r.created_at),
          payment_method: (r.payment_method == null ? null : String(r.payment_method)),
          grand_total: Number((agg as RowDataPacket)?.grand_total || 0),
          items_count: Number((agg as RowDataPacket)?.items_count || 0)
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