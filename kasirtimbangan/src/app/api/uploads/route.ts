import { NextResponse } from "next/server";
import { getPool } from "@/utils/db";
import type { RowDataPacket } from "mysql2/promise";
import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySessionToken } from "@/utils/auth";
// Mode manual: tidak memulai worker otomatis di endpoint ini

export async function GET(request: Request) {
  // Hanya akses untuk user yang login (superadmin/kasir)
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value || "";
  const payload = token ? verifySessionToken(token) : null;
  if (!payload) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const status = (url.searchParams.get("status") || "").trim().toLowerCase();
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 20), 1), 100);
  const offset = Math.max(Number(url.searchParams.get("offset") || 0), 0);

  const pool = getPool();
  const params: any[] = [];
  let where = "";
  if (status && ["queued", "uploading", "success", "error"].includes(status)) {
    where = "WHERE status = ?";
    params.push(status);
  }
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, invoice_id, invoice_item_id, item_index, kind, status, progress, filename, attempts, last_error, created_at, updated_at, data_url
     FROM uploads ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  return NextResponse.json({ ok: true, items: rows || [], limit, offset }, { status: 200 });
}