import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/utils/db";
import type { RowDataPacket, ResultSetHeader } from "mysql2/promise";
import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySessionToken, hashPassword } from "@/utils/auth";

type UserRow = RowDataPacket & { id: string; username: string; password_hash: string; password_salt: string; role: string; created_at: string };

const getErrorMessage = (e: unknown): string => {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  try { return JSON.stringify(e); } catch { return String(e); }
};

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
  const guard = await requireSuperadmin();
  if (!guard.ok) return guard.res;
  try {
    const pool = getPool();
    const [rows] = await pool.query<UserRow[]>(`SELECT id, username, role, created_at FROM users ORDER BY created_at DESC`);
    const users = (rows || []).map((r) => ({ id: String(r.id), username: String(r.username), role: String(r.role), createdAt: r.created_at }));
    return NextResponse.json({ ok: true, users }, { status: 200 });
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: getErrorMessage(e) || "Users list error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const guard = await requireSuperadmin();
  if (!guard.ok) return guard.res;
  try {
    const body = await req.json();
    const username = String(body?.username || "").trim();
    const password = String(body?.password || "").trim();
    const role = String(body?.role || "").trim();
    if (!username || !password || !role) {
      return NextResponse.json({ ok: false, error: "username, password, dan role wajib diisi" }, { status: 400 });
    }
    // Validasi username: hanya huruf A-Z, tanpa spasi
    if (!/^[A-Za-z]+$/.test(username)) {
      return NextResponse.json({ ok: false, error: "Username hanya huruf A-Z, tidak boleh spasi" }, { status: 400 });
    }
    if (role !== "superadmin" && role !== "kasir") {
      return NextResponse.json({ ok: false, error: "Role tidak valid" }, { status: 400 });
    }
    const pool = getPool();
    const [exists] = await pool.query<RowDataPacket[]>(`SELECT id FROM users WHERE username = ? LIMIT 1`, [username]);
    if (Array.isArray(exists) && exists.length > 0) {
      return NextResponse.json({ ok: false, error: "Username sudah digunakan" }, { status: 409 });
    }
    const { saltHex, hashHex } = await hashPassword(password);
    const [res] = await pool.query<ResultSetHeader>(
      `INSERT INTO users (id, username, password_hash, password_salt, role) VALUES (UUID(), ?, ?, ?, ?)`,
      [username, hashHex, saltHex, role]
    );
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: getErrorMessage(e) || "Create user error" }, { status: 500 });
  }
}