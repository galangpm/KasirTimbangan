import { NextResponse } from "next/server";
import { getPool } from "@/utils/db";
import { FRUIT_PRICES } from "@/utils/price";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";

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

export async function POST() {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Create tables if not exist (gunakan UUID untuk invoices.id dan invoice_items.invoice_id)
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
      FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
    ) ENGINE=InnoDB`);

    // Pastikan/migrasikan tabel prices ke skema terbaru (id UUID PK, fruit UNIQUE)
    await migratePricesSchema(conn);

    // Seed prices from FRUIT_PRICES
    let seededCount = 0;
    for (const [fruit, price] of Object.entries(FRUIT_PRICES)) {
      await conn.query(
        `INSERT INTO prices (id, fruit, price) VALUES (UUID(), ?, ?) 
         ON DUPLICATE KEY UPDATE price = VALUES(price)`,
        [fruit, Math.max(0, Math.floor(price))]
      );
      seededCount += 1;
    }

    await conn.commit();
    conn.release();
    return NextResponse.json({ ok: true, seededCount }, { status: 200 });
  } catch (e: unknown) {
    await conn.rollback();
    conn.release();
    return NextResponse.json({ ok: false, error: getErrorMessage(e) || "Install DB error" }, { status: 500 });
  }
}