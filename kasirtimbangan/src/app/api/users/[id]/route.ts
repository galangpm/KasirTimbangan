import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/utils/db";
import type { RowDataPacket, ResultSetHeader } from "mysql2/promise";
import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySessionToken, hashPassword } from "@/utils/auth";

type UserRow = RowDataPacket & { id: string; username: string; role: string; created_at: string };

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

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const guard = await requireSuperadmin();
  if (!guard.ok) return guard.res;
  try {
    const pool = getPool();
    const { id } = await context.params;
    const [rows] = await pool.query<UserRow[]>(`SELECT id, username, role, created_at FROM users WHERE id = ? LIMIT 1`, [id]);
    const user = rows?.[0];
    if (!user) return NextResponse.json({ ok: false, error: "User tidak ditemukan" }, { status: 404 });
    return NextResponse.json({ ok: true, user: { id: String(user.id), username: String(user.username), role: String(user.role), createdAt: user.created_at } }, { status: 200 });
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: getErrorMessage(e) || "Get user error" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const guard = await requireSuperadmin();
  if (!guard.ok) return guard.res;
  try {
    const body = await req.json();
    const username = body?.username !== undefined ? String(body.username).trim() : undefined;
    const password = body?.password !== undefined ? String(body.password).trim() : undefined;
    const role = body?.role !== undefined ? String(body.role).trim() : undefined;
    if (role && role !== "superadmin" && role !== "kasir") {
      return NextResponse.json({ ok: false, error: "Role tidak valid" }, { status: 400 });
    }
    // Validasi username (jika diubah): hanya huruf A-Z, tanpa spasi
    if (username !== undefined && !/^[A-Za-z]+$/.test(String(username))) {
      return NextResponse.json({ ok: false, error: "Username hanya huruf A-Z, tidak boleh spasi" }, { status: 400 });
    }
    const pool = getPool();
    const { id } = await context.params;
    // Cek username unik bila diubah
    if (username) {
      const [exists] = await pool.query<RowDataPacket[]>(`SELECT id FROM users WHERE username = ? AND id <> ? LIMIT 1`, [username, id]);
      if (Array.isArray(exists) && exists.length > 0) {
        return NextResponse.json({ ok: false, error: "Username sudah digunakan" }, { status: 409 });
      }
    }
    // Bangun query update dinamis
    const fields: string[] = [];
    const values: (string | number)[] = [];
    if (username) { fields.push("username = ?"); values.push(username); }
    if (role) { fields.push("role = ?"); values.push(role); }
    if (password) {
      const { saltHex, hashHex } = await hashPassword(password);
      fields.push("password_hash = ?", "password_salt = ?");
      values.push(hashHex, saltHex);
    }
    if (fields.length === 0) {
      return NextResponse.json({ ok: false, error: "Tidak ada perubahan" }, { status: 400 });
    }
    values.push(id);
    await pool.query<ResultSetHeader>(`UPDATE users SET ${fields.join(", ")} WHERE id = ?`, values);
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: getErrorMessage(e) || "Update user error" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const guard = await requireSuperadmin();
  if (!guard.ok) return guard.res;
  try {
    const pool = getPool();
    const { id } = await context.params;
    await pool.query<ResultSetHeader>(`DELETE FROM users WHERE id = ?`, [id]);
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: getErrorMessage(e) || "Delete user error" }, { status: 500 });
  }
}