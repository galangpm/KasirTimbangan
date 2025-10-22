import { NextResponse } from "next/server";
import { getPool } from "@/utils/db";
import { FRUIT_PRICES } from "@/utils/price";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { randomBytes, scrypt as _scrypt } from "crypto";
import { promisify } from "util";
import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySessionToken } from "@/utils/auth";

const scrypt = promisify(_scrypt);

interface ColumnRow extends RowDataPacket {
  COLUMN_NAME: string;
}

const getErrorMessage = (e: unknown): string => {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  try { return JSON.stringify(e); } catch { return String(e); }
};

async function migratePricesSchema(conn: PoolConnection) {
  await conn.query(`CREATE TABLE IF NOT EXISTS prices (
    id CHAR(36) PRIMARY KEY,
    fruit VARCHAR(128) NOT NULL UNIQUE,
    price INT NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB`);
  const [cols] = await conn.query<ColumnRow[]>(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'prices'`
  );
  const colSet = new Set((cols || []).map((c) => c.COLUMN_NAME));
  if (!colSet.has("id")) {
    await conn.query(`ALTER TABLE prices ADD COLUMN id CHAR(36) NULL`);
    await conn.query(`UPDATE prices SET id = UUID() WHERE id IS NULL`);
    try { await conn.query(`ALTER TABLE prices DROP PRIMARY KEY`); } catch {}
    try { await conn.query(`ALTER TABLE prices ADD PRIMARY KEY (id)`); } catch {}
    try { await conn.query(`ALTER TABLE prices ADD UNIQUE KEY unique_fruit (fruit)`); } catch {}
  } else {
    try { await conn.query(`ALTER TABLE prices ADD UNIQUE KEY unique_fruit (fruit)`); } catch {}
  }
}

export async function POST(request: Request) {
  // Guard akses: izinkan tanpa login jika kunci "asera" valid, selain itu wajib superadmin
  const url = new URL(request.url);
  const headerKey = (request.headers.get("x-asera-key") || "").trim().toLowerCase();
  const paramKey = (url.searchParams.get("key") || "").trim().toLowerCase();
  const hasAseraKey = headerKey === "asera" || paramKey === "asera";

  let payload: ReturnType<typeof verifySessionToken> | null = null;
  if (!hasAseraKey) {
    const cookieStore = await cookies();
    const token = cookieStore.get(SESSION_COOKIE)?.value || "";
    payload = token ? verifySessionToken(token) : null;
    if (!payload) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    if (payload.role !== "superadmin") {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }
  }

  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const onlyUsers = (url.searchParams.get("only") || "").toLowerCase() === "users";

    let seededCount = 0;
    if (!onlyUsers) {
      // Create tables if not exist (gunakan UUID untuk invoices.id dan invoice_items.invoice_id)
      await conn.query(`CREATE TABLE IF NOT EXISTS invoices (
        id CHAR(36) PRIMARY KEY,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        payment_method VARCHAR(16) NULL,
        notes TEXT NULL,
        user_id CHAR(36) NULL,
        customer_uuid CHAR(36) NULL
      ) ENGINE=InnoDB`);

      // Buat tabel customers untuk menyimpan data pelanggan
      await conn.query(`CREATE TABLE IF NOT EXISTS customers (
        uuid CHAR(36) PRIMARY KEY,
        name VARCHAR(128) NOT NULL,
        whatsapp VARCHAR(64) NULL,
        address VARCHAR(255) NULL,
        UNIQUE KEY unique_whatsapp (whatsapp)
      ) ENGINE=InnoDB`);

      // Pastikan kolom notes ada (untuk skema lama yang belum punya)
      try {
        const [colsInv] = await conn.query<ColumnRow[]>(
          `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'invoices' AND COLUMN_NAME = 'notes'`
        );
        if (!Array.isArray(colsInv) || colsInv.length === 0) {
          await conn.query(`ALTER TABLE invoices ADD COLUMN notes TEXT NULL`);
        }
      } catch {}

      // Pastikan kolom user_id ada dan tambahkan index + FK bila perlu
      try {
        const [colsUserId] = await conn.query<ColumnRow[]>(
          `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'invoices' AND COLUMN_NAME = 'user_id'`
        );
        if (!Array.isArray(colsUserId) || colsUserId.length === 0) {
          await conn.query(`ALTER TABLE invoices ADD COLUMN user_id CHAR(36) NULL`);
        }
        try { await conn.query(`ALTER TABLE invoices ADD INDEX idx_invoices_user_id (user_id)`); } catch {}
        try { await conn.query(`ALTER TABLE invoices ADD CONSTRAINT fk_invoices_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT`); } catch {}
      } catch {}

      // Pastikan kolom customer_uuid ada dan tambah index + FK ke customers
      try {
        const [colsCustomerUuid] = await conn.query<ColumnRow[]>(
          `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'invoices' AND COLUMN_NAME = 'customer_uuid'`
        );
        if (!Array.isArray(colsCustomerUuid) || colsCustomerUuid.length === 0) {
          await conn.query(`ALTER TABLE invoices ADD COLUMN customer_uuid CHAR(36) NULL`);
        }
        try { await conn.query(`ALTER TABLE invoices ADD INDEX idx_invoices_customer_uuid (customer_uuid)`); } catch {}
        try { await conn.query(`ALTER TABLE invoices ADD CONSTRAINT fk_invoices_customer FOREIGN KEY (customer_uuid) REFERENCES customers(uuid) ON DELETE SET NULL`); } catch {}
      } catch {}

      // Pastikan kolom address ada di tabel customers untuk skema lama
      try {
        const [colsCustAddr] = await conn.query<ColumnRow[]>(
          `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'customers' AND COLUMN_NAME = 'address'`
        );
        if (!Array.isArray(colsCustAddr) || colsCustAddr.length === 0) {
          await conn.query(`ALTER TABLE customers ADD COLUMN address VARCHAR(255) NULL`);
        }
      } catch {}

      // Migrasi kolom whatsapp agar nullable untuk skema lama
      try { await conn.query(`ALTER TABLE customers MODIFY COLUMN whatsapp VARCHAR(64) NULL`); } catch {}

      await conn.query(`CREATE TABLE IF NOT EXISTS invoice_items (
        id INT AUTO_INCREMENT PRIMARY KEY,
        invoice_id CHAR(36) NOT NULL,
        fruit VARCHAR(64) NOT NULL,
        weight_kg DECIMAL(10,3) NOT NULL,
        price_per_kg INT NOT NULL,
        total_price INT NOT NULL,
        image_data_url MEDIUMTEXT NULL,
        full_image_data_url MEDIUMTEXT NULL,
        FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
      ) ENGINE=InnoDB`);

      // Tabel uploads untuk antrian upload gambar background
      await conn.query(`CREATE TABLE IF NOT EXISTS uploads (
        id INT AUTO_INCREMENT PRIMARY KEY,
        invoice_id CHAR(36) NOT NULL,
        invoice_item_id INT NULL,
        item_index INT NULL,
        kind VARCHAR(16) NOT NULL,
        status VARCHAR(16) NOT NULL DEFAULT 'queued',
        progress TINYINT NOT NULL DEFAULT 0,
        filename VARCHAR(255) NULL,
        data_url MEDIUMTEXT NULL,
        attempts INT NOT NULL DEFAULT 0,
        last_error TEXT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_uploads_invoice_id (invoice_id),
        INDEX idx_uploads_item (invoice_item_id),
        FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE,
        FOREIGN KEY (invoice_item_id) REFERENCES invoice_items(id) ON DELETE SET NULL
      ) ENGINE=InnoDB`);

      // Migrasi/seed tabel prices
      
      // Pastikan/migrasikan tabel prices ke skema terbaru (id UUID PK, fruit UNIQUE)
      await migratePricesSchema(conn);

      // Seed prices from FRUIT_PRICES
      for (const [fruit, price] of Object.entries(FRUIT_PRICES)) {
        await conn.query(
          `INSERT INTO prices (id, fruit, price) VALUES (UUID(), ?, ?) 
           ON DUPLICATE KEY UPDATE price = VALUES(price)`,
          [fruit, Math.max(0, Math.floor(price))]
        );
        seededCount += 1;
      }
    }

    // Buat tabel users bila belum ada
    await conn.query(`CREATE TABLE IF NOT EXISTS users (
      id CHAR(36) PRIMARY KEY,
      username VARCHAR(64) NOT NULL,
      password_hash CHAR(64) NOT NULL,
      password_salt CHAR(32) NOT NULL,
      role VARCHAR(16) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY unique_username (username)
    ) ENGINE=InnoDB`);

    // Buat tabel logs untuk audit trail (dipastikan terbuat terlepas dari onlyUsers)
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

    // Seed default users jika belum ada
    let usersSeeded = 0;
    const defaults: Array<{ username: string; password: string; role: "superadmin" | "kasir" }> = [
      { username: "superadmin", password: "superadmin", role: "superadmin" },
      { username: "kasir", password: "kasir", role: "kasir" },
    ];
    for (const d of defaults) {
      const [exists] = await conn.query<RowDataPacket[]>(
        `SELECT id FROM users WHERE username = ? LIMIT 1`,
        [d.username]
      );
      if (!Array.isArray(exists) || exists.length === 0) {
        const saltHex = randomBytes(16).toString("hex");
        const key = (await scrypt(d.password, saltHex, 32)) as Buffer;
        const hashHex = key.toString("hex");
        await conn.query(
          `INSERT INTO users (id, username, password_hash, password_salt, role) VALUES (UUID(), ?, ?, ?, ?)`,
          [d.username, hashHex, saltHex, d.role]
        );
        usersSeeded += 1;
      }
    }

    await conn.commit();
    conn.release();
    // Tulis log instalasi
    try {
      const scope = onlyUsers ? "users" : "all";
      const details = `scope=${scope}; pricesSeeded=${seededCount}; usersSeeded=${usersSeeded}`;
      let installerUserId: string | undefined = payload?.id ? String(payload.id) : undefined;
      if (!installerUserId) {
        const [rows] = await pool.query<RowDataPacket[]>(
          `SELECT id FROM users WHERE username = 'superadmin' LIMIT 1`
        );
        installerUserId = String(rows?.[0]?.id || "");
      }
      if (installerUserId) {
        await pool.query(
          `INSERT INTO logs (user_id, action, details) VALUES (?, 'install_db', ?)`,
          [installerUserId, details]
        );
      }
    } catch {}
    return NextResponse.json({ ok: true, seededCount, usersSeeded, only: onlyUsers ? "users" : "all" }, { status: 200 });
  } catch (e: unknown) {
    try { await conn.rollback(); } catch {}
    try { conn.release(); } catch {}
    return NextResponse.json({ ok: false, error: getErrorMessage(e) || "Install DB error" }, { status: 500 });
  }
}