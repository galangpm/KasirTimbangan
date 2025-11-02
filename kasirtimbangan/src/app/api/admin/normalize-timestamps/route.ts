import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getPool } from "@/utils/db";
import { SESSION_COOKIE, verifySessionToken } from "@/utils/auth";
import type { RowDataPacket } from "mysql2/promise";

type NormalizeBody = {
  table?: string; // default: 'invoices'
  column?: string; // default: 'created_at'
  shiftHours?: number; // default: 7
  dateFrom?: string; // 'YYYY-MM-DD'
  dateTo?: string;   // 'YYYY-MM-DD'
  dryRun?: boolean;  // jika true, tidak melakukan UPDATE, hanya preview
};

export async function POST(req: NextRequest) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(SESSION_COOKIE)?.value || "";
    const payload = token ? verifySessionToken(token) : null;
    if (!payload) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    if (payload.role !== "superadmin") return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });

    const body = (await req.json()) as NormalizeBody;
    const table = (body.table || "invoices").trim();
    const column = (body.column || "created_at").trim();
    const shiftHours = Number.isFinite(Number(body.shiftHours)) ? Number(body.shiftHours) : 7;
    const dateFrom = (body.dateFrom || "").trim();
    const dateTo = (body.dateTo || "").trim();
    const dryRun = Boolean(body.dryRun);

    // Validasi input sederhana
    if (!/^[a-zA-Z0-9_]+$/.test(table) || !/^[a-zA-Z0-9_]+$/.test(column)) {
      return NextResponse.json({ ok: false, error: "Invalid table/column" }, { status: 400 });
    }

    const pool = getPool();
    const conn = await pool.getConnection();
    try {
      // Pastikan timezone sesi
      try { await conn.query("SET time_zone = '+07:00'"); } catch {}

      // Tentukan WHERE range
      const whereParts: string[] = [];
      const params: Array<string | number> = [];
      if (dateFrom) { whereParts.push(`${table}.${column} >= ?`); params.push(`${dateFrom} 00:00:00`); }
      if (dateTo) { whereParts.push(`${table}.${column} <= ?`); params.push(`${dateTo} 23:59:59`); }
      // default: 30 hari terakhir
      if (!dateFrom && !dateTo) { whereParts.push(`${table}.${column} >= NOW() - INTERVAL 30 DAY`); }
      const whereSql = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";

      // Statistik awal
      const countSql = `SELECT COUNT(*) AS cnt, MIN(${column}) AS min_ts, MAX(${column}) AS max_ts FROM ${table} ${whereSql}`;
      const [[stats]] = params.length ? await conn.query<RowDataPacket[]>(countSql, params) : await conn.query<RowDataPacket[]>(countSql);
      const count = Number((stats as RowDataPacket)?.cnt || 0);
      const minTs = String((stats as RowDataPacket)?.min_ts || "");
      const maxTs = String((stats as RowDataPacket)?.max_ts || "");

      // Ambil sampel
      const sampleSql = `SELECT ${column} AS ts FROM ${table} ${whereSql} ORDER BY ${column} ASC LIMIT 5`;
      const [sampleRows] = params.length ? await conn.query<RowDataPacket[]>(sampleSql, params) : await conn.query<RowDataPacket[]>(sampleSql);
      const samples = (sampleRows || []).map(r => String(r.ts));

      if (dryRun) {
        conn.release();
        return NextResponse.json({ ok: true, dryRun: true, table, column, shiftHours, count, minTs, maxTs, samples }, { status: 200 });
      }

      // Lakukan normalisasi: geser jam
      const updateSql = `UPDATE ${table} SET ${column} = DATE_ADD(${column}, INTERVAL ? HOUR) ${whereSql}`;
      const updateParams = params.length ? [shiftHours, ...params] : [shiftHours];
      const [res] = await conn.query(updateSql, updateParams);

      // Catat log
      try {
        await conn.query(
          `INSERT INTO logs (user_id, action, invoice_id, details) VALUES (?, 'normalize_timestamps', NULL, ?)`,
          [String(payload.id), `table=${table}; column=${column}; shiftHours=${shiftHours}; count=${count}; range=${dateFrom || 'auto-30d'}..${dateTo || 'now'}`]
        );
      } catch {}

      conn.release();
      return NextResponse.json({ ok: true, table, column, shiftHours, count, minTs, maxTs, samples }, { status: 200 });
    } catch (e) {
      try { conn.release(); } catch {}
      throw e;
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg || "Normalize error" }, { status: 500 });
  }
}