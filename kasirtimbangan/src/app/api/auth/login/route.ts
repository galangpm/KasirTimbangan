import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/utils/db";
import type { RowDataPacket } from "mysql2/promise";
import { SESSION_COOKIE, buildSessionPayload, createSessionToken, verifyPassword, type UserRole } from "@/utils/auth";

type UserRow = RowDataPacket & { id: string; username: string; password_hash: string; password_salt: string; role: string };

const getErrorMessage = (e: unknown): string => {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  try { return JSON.stringify(e); } catch { return String(e); }
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const username = String(body?.username || "").trim();
    const password = String(body?.password || "").trim();
    if (!username || !password) {
      return NextResponse.json({ ok: false, error: "Username dan password wajib diisi" }, { status: 400 });
    }
    const pool = getPool();
    const [rows] = await pool.query<UserRow[]>(
      `SELECT id, username, password_hash, password_salt, role FROM users WHERE username = ? LIMIT 1`,
      [username]
    );
    const user = rows?.[0];
    if (!user) {
      return NextResponse.json({ ok: false, error: "User tidak ditemukan" }, { status: 401 });
    }
    const ok = await verifyPassword(password, String(user.password_salt), String(user.password_hash));
    if (!ok) {
      return NextResponse.json({ ok: false, error: "Password salah" }, { status: 401 });
    }
    const role = String(user.role) as UserRole;
    const payload = buildSessionPayload(String(user.id), String(user.username), role);
    const token = createSessionToken(payload);

    // Tentukan apakah request di belakang HTTPS (mis. reverse proxy) untuk set flag secure dengan benar
    const forwardedProto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || "";
    const forwardedSsl = req.headers.get("x-forwarded-ssl") || "";
    const isHttps = forwardedProto === "https" || forwardedSsl === "on" || req.nextUrl.protocol === "https:";

    const res = NextResponse.json({ ok: true, user: { id: String(user.id), username: String(user.username), role: String(user.role) } }, { status: 200 });
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: isHttps,
      maxAge: 7 * 24 * 60 * 60, // 7 hari
    });
    return res;
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: getErrorMessage(e) || "Login error" }, { status: 500 });
  }
}