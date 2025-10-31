import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import fs from "fs";
import path from "path";
import { getPool } from "@/utils/db";
import type { RowDataPacket } from "mysql2/promise";
import { SESSION_COOKIE, verifySessionToken } from "@/utils/auth";

const getErrorMessage = (e: unknown): string => {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  try { return JSON.stringify(e); } catch { return String(e); }
};

async function requireSuperadmin(): Promise<{ ok: true } | { ok: false; res: NextResponse }>{
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value || "";
  const payload = token ? verifySessionToken(token) : null;
  if (!payload) return { ok: false, res: NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 }) };
  if (payload.role !== "superadmin") return { ok: false, res: NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 }) };
  return { ok: true };
}

function parseDataUrl(dataUrl: string): { ext: string; buffer: Buffer } | null {
  const m = dataUrl.match(/^data:image\/(png|jpe?g|webp);base64,(.+)$/i);
  if (!m) return null;
  const type = m[1].toLowerCase();
  const b64 = m[2];
  const ext = type === "jpeg" ? "jpg" : type;
  try {
    const buf = Buffer.from(b64, "base64");
    return { ext, buffer: buf };
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const guard = await requireSuperadmin();
  if (!guard.ok) return guard.res;
  try {
    const body = await req.json();
    const { dataUrl } = body || {};
    if (!dataUrl || typeof dataUrl !== "string") {
      return NextResponse.json({ ok: false, error: "dataUrl gambar wajib diisi" }, { status: 400 });
    }
    const parsed = parseDataUrl(dataUrl);
    if (!parsed) {
      return NextResponse.json({ ok: false, error: "Format dataUrl tidak valid (harus image png/jpg/webp)" }, { status: 400 });
    }

    // Pastikan direktori tujuan ada
    const imagesDir = path.join(process.cwd(), "public", "images");
    try { fs.mkdirSync(imagesDir, { recursive: true }); } catch {}

    const filename = `logo-${Date.now()}.${parsed.ext}`;
    const filepath = path.join(imagesDir, filename);
    fs.writeFileSync(filepath, parsed.buffer);
    const url = `/images/${filename}`;

    // Simpan URL ke DB settings (update baris terbaru atau buat baru jika belum ada)
    const pool = getPool();
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const [rows] = await conn.query<RowDataPacket[]>(
        `SELECT id FROM business_settings ORDER BY updated_at DESC LIMIT 1`
      );
      if (Array.isArray(rows) && rows.length > 0) {
        await conn.query(`UPDATE business_settings SET logo_url=? ORDER BY updated_at DESC LIMIT 1`, [url]);
      } else {
        await conn.query(
          `INSERT INTO business_settings (id, name, address, phone, receipt_footer, logo_url) VALUES (UUID(), 'Kasir Timbangan', '', '', 'Terima kasih telah berbelanja!', ?)` ,
          [url]
        );
      }

      await conn.commit();
      conn.release();
    } catch (e) {
      try { await (conn as any).rollback(); } catch {}
      try { (conn as any).release(); } catch {}
      throw e;
    }

    return NextResponse.json({ ok: true, url }, { status: 200 });
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: getErrorMessage(e) || "Upload logo error" }, { status: 500 });
  }
}