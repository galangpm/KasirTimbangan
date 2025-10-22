import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/utils/db";
import type { RowDataPacket, ResultSetHeader, PoolConnection } from "mysql2/promise";
import { FRUIT_PRICES } from "@/utils/price";
import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySessionToken } from "@/utils/auth";

// Helper untuk mengekstrak pesan error secara aman
const getErrorMessage = (e: unknown): string => {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  try { return JSON.stringify(e); } catch { return String(e); }
};

async function migratePricesSchema(conn: PoolConnection) {
  // Sederhanakan migrasi: cukup pastikan tabel prices ada tanpa ALTER/UNIQUE tambahan
  await conn.query(`CREATE TABLE IF NOT EXISTS prices (
    id CHAR(36) PRIMARY KEY,
    fruit VARCHAR(128) NOT NULL,
    price INT NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY unique_fruit (fruit)
  ) ENGINE=InnoDB`);
}

// Guard: hanya superadmin yang boleh mengubah daftar harga
async function requireSuperadmin(): Promise<{ ok: true } | { ok: false; res: NextResponse }> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value || "";
  const payload = token ? verifySessionToken(token) : null;
  if (!payload) {
    return { ok: false, res: NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 }) };
  }
  if (payload.role !== "superadmin") {
    return { ok: false, res: NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 }) };
  }
  return { ok: true };
}

export async function GET() {
  try {
    const pool = getPool();
    const conn = await pool.getConnection();
    try {
      await migratePricesSchema(conn);
      const [rows] = await conn.query<RowDataPacket[]>("SELECT id, fruit, price FROM prices ORDER BY fruit");
      const prices: Record<string, number> = {};
      for (const r of rows || []) {
        const fruit = String((r as RowDataPacket).fruit);
        const price = Number((r as RowDataPacket).price) || 0;
        prices[fruit] = price;
      }
      conn.release();
      return NextResponse.json({ ok: true, prices }, { status: 200 });
    } catch (e) {
      conn.release();
      throw e;
    }
  } catch (e: unknown) {
    // Fallback aman bila DB tidak terkonfigurasi/bermasalah
    return NextResponse.json({ ok: true, prices: FRUIT_PRICES, warning: getErrorMessage(e) || "Prices API error" }, { status: 200 });
  }
}

export async function PUT(req: NextRequest) {
  const guard = await requireSuperadmin();
  if (!guard.ok) return guard.res;
  try {
    const body = await req.json();
    const { prices, remove } = body || {};
    if (!prices || typeof prices !== "object") {
      return NextResponse.json({ error: "prices wajib berupa objek" }, { status: 400 });
    }
    const pool = getPool();
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // Migrasi skema agar sesuai (id UUID sebagai PK, fruit UNIQUE)
      await migratePricesSchema(conn);

      // Hapus buah yang diminta di-remove
      if (Array.isArray(remove) && remove.length > 0) {
        const placeholders = remove.map(() => "?").join(",");
        await conn.query(`DELETE FROM prices WHERE fruit IN (${placeholders})`, remove as ReadonlyArray<string>);
      }

      // Upsert semua harga yang dikirim
      let upserted = 0;
      for (const [fruit, priceVal] of Object.entries(prices as Record<string, number>)) {
        const price = Math.max(0, Math.floor(Number(priceVal) || 0));
        await conn.query<ResultSetHeader>(
          `INSERT INTO prices (id, fruit, price) VALUES (UUID(), ?, ?) 
           ON DUPLICATE KEY UPDATE price = VALUES(price)`,
          [fruit, price]
        );
        upserted += 1;
      }

      await conn.commit();
      conn.release();
      return NextResponse.json({ ok: true, upserted, removed: Array.isArray(remove) ? remove.length : 0 }, { status: 200 });
    } catch (e) {
      await conn.rollback();
      conn.release();
      throw e;
    }
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: getErrorMessage(e) || "Prices API error" }, { status: 500 });
  }
}