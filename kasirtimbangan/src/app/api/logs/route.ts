import { NextResponse } from "next/server";
import { getPool } from "@/utils/db";
import type { RowDataPacket } from "mysql2/promise";
import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySessionToken } from "@/utils/auth";

const parseDate = (s: string | null): string | null => {
  if (!s) return null;
  const m = /^\d{4}-\d{2}-\d{2}$/.exec(s.trim());
  return m ? m[0] : null;
};

export async function GET(request: Request) {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value || "";
  const payload = token ? verifySessionToken(token) : null;
  if (!payload) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  // Batasi akses: hanya superadmin untuk log manajemen
  if (payload.role !== "superadmin") {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page") || "1"));
  const pageSizeRaw = Number(url.searchParams.get("pageSize") || "20");
  const pageSize = Math.min(100, Math.max(1, isNaN(pageSizeRaw) ? 20 : pageSizeRaw));
  const offset = (page - 1) * pageSize;
  const dateFrom = parseDate(url.searchParams.get("dateFrom"));
  const dateTo = parseDate(url.searchParams.get("dateTo"));
  const action = (url.searchParams.get("action") || "").trim();
  const userId = (url.searchParams.get("userId") || "").trim();
  const q = (url.searchParams.get("q") || "").trim();
  const meta = (url.searchParams.get("meta") || "").trim().toLowerCase();

  const pool = getPool();

  // Meta endpoints
  if (meta === "actions") {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT DISTINCT action FROM logs ORDER BY action ASC`
    );
    return NextResponse.json({ ok: true, actions: rows.map((r) => String(r.action)) }, { status: 200 });
  }
  if (meta === "summary") {
    // Ringkasan count per action dan per user di range filter
    const whereParts: string[] = [];
    const params: any[] = [];
    if (dateFrom) { whereParts.push(`DATE(l.created_at) >= ?`); params.push(dateFrom); }
    if (dateTo) { whereParts.push(`DATE(l.created_at) <= ?`); params.push(dateTo); }
    if (action) { whereParts.push(`l.action = ?`); params.push(action); }
    if (userId) { whereParts.push(`l.user_id = ?`); params.push(userId); }
    if (q) { whereParts.push(`(l.details LIKE ? OR l.invoice_id LIKE ?)`); params.push(`%${q}%`, `%${q}%`); }
    const where = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";

    const [byAction] = await pool.query<RowDataPacket[]>(
      `SELECT l.action, COUNT(*) as count FROM logs l ${where} GROUP BY l.action ORDER BY count DESC`
      , params
    );
    const [byUser] = await pool.query<RowDataPacket[]>(
      `SELECT u.username, COUNT(*) as count FROM logs l LEFT JOIN users u ON u.id = l.user_id ${where} GROUP BY u.username ORDER BY count DESC`
      , params
    );
    const [[totRow]] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) as total FROM logs l ${where}`, params
    );
    return NextResponse.json({ ok: true, summary: { total: Number(totRow?.total || 0), byAction, byUser } }, { status: 200 });
  }

  // List logs dengan filter dan pagination
  const whereParts: string[] = [];
  const params: any[] = [];
  if (dateFrom) { whereParts.push(`DATE(l.created_at) >= ?`); params.push(dateFrom); }
  if (dateTo) { whereParts.push(`DATE(l.created_at) <= ?`); params.push(dateTo); }
  if (action) { whereParts.push(`l.action = ?`); params.push(action); }
  if (userId) { whereParts.push(`l.user_id = ?`); params.push(userId); }
  if (q) { whereParts.push(`(l.details LIKE ? OR l.invoice_id LIKE ?)`); params.push(`%${q}%`, `%${q}%`); }
  const where = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT l.id, l.created_at, l.user_id, u.username, l.action, l.invoice_id, l.details
     FROM logs l LEFT JOIN users u ON u.id = l.user_id
     ${where}
     ORDER BY l.created_at DESC
     LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  );
  const [[c]] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) as total FROM logs l ${where}`, params
  );
  const total = Number(c?.total || 0);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return NextResponse.json({ ok: true, data: rows, page, pageSize, total, totalPages }, { status: 200 });
}