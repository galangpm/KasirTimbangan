import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/utils/db";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySessionToken } from "@/utils/auth";

// Helper untuk mengekstrak pesan error secara aman
const getErrorMessage = (e: unknown): string => {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  try { return JSON.stringify(e); } catch { return String(e); }
};

async function migrateSettingsSchema(conn: PoolConnection) {
  await conn.query(`CREATE TABLE IF NOT EXISTS business_settings (
    id CHAR(36) PRIMARY KEY,
    name VARCHAR(128) NOT NULL,
    address VARCHAR(512) NOT NULL,
    phone VARCHAR(64) NOT NULL,
    receipt_footer VARCHAR(512) NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB`);
}

// Guard: hanya superadmin yang boleh mengubah pengaturan
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
      await migrateSettingsSchema(conn);
      const [rows] = await conn.query<RowDataPacket[]>(
        `SELECT id, name, address, phone, receipt_footer, updated_at 
         FROM business_settings 
         ORDER BY updated_at DESC 
         LIMIT 1`
      );
      conn.release();
      const row = rows[0] as RowDataPacket | undefined;
      if (!row) {
        return NextResponse.json({ ok: true, settings: null }, { status: 200 });
      }
      const settings = {
        id: String(row.id),
        name: String(row.name || ""),
        address: String(row.address || ""),
        phone: String(row.phone || ""),
        receiptFooter: String(row.receipt_footer || ""),
        updatedAt: row.updated_at,
      };
      return NextResponse.json({ ok: true, settings }, { status: 200 });
    } catch (e) {
      conn.release();
      throw e;
    }
  } catch (e: unknown) {
    // Fallback aman bila DB belum terkonfigurasi / gagal terhubung
    return NextResponse.json(
      { ok: true, settings: null, warning: getErrorMessage(e) || "Settings API error" },
      { status: 200 }
    );
  }
}

export async function PUT(req: NextRequest) {
  const guard = await requireSuperadmin();
  if (!guard.ok) return guard.res;
  try {
    const body = await req.json();
    const { name, address, phone, receiptFooter } = body || {};
    // Validasi sederhana
    const errors: string[] = [];
    if (!name || typeof name !== "string" || name.trim().length < 2) errors.push("Nama usaha wajib diisi (min 2 karakter)");
    if (!address || typeof address !== "string" || address.trim().length < 5) errors.push("Alamat wajib diisi (min 5 karakter)");
    if (!phone || typeof phone !== "string") {
      errors.push("Nomor telepon wajib diisi");
    } else {
      const phoneClean = phone.trim();
      // Format: digit, spasi, tanda +, -, boleh. Minimal 7 digit keseluruhan.
      const digitCount = (phoneClean.match(/\d/g) || []).length;
      if (digitCount < 7 || digitCount > 20) errors.push("Nomor telepon harus berisi 7-20 digit");
      const allowed = /^[+\-()\s\d]+$/;
      if (!allowed.test(phoneClean)) errors.push("Format nomor telepon tidak valid");
    }
    if (!receiptFooter || typeof receiptFooter !== "string" || receiptFooter.trim().length < 2) errors.push("Footer nota wajib diisi (min 2 karakter)");

    if (errors.length) {
      return NextResponse.json({ ok: false, errors }, { status: 400 });
    }

    const pool = getPool();
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await migrateSettingsSchema(conn);

      // Sederhana: pastikan hanya satu baris dengan cara kosongkan lalu insert baru
      await conn.query(`DELETE FROM business_settings`);
      await conn.query(
        `INSERT INTO business_settings (id, name, address, phone, receipt_footer) VALUES (UUID(), ?, ?, ?, ?)`,
        [name.trim(), address.trim(), phone.trim(), receiptFooter.trim()]
      );

      await conn.commit();
      conn.release();
      return NextResponse.json({ ok: true }, { status: 200 });
    } catch (e) {
      await conn.rollback();
      conn.release();
      throw e;
    }
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: getErrorMessage(e) || "Settings API error" }, { status: 500 });
  }
}