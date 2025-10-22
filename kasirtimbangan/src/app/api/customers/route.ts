import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getPool } from "@/utils/db";
import type { PoolConnection, RowDataPacket, ResultSetHeader } from "mysql2/promise";
import { SESSION_COOKIE, verifySessionToken } from "@/utils/auth";

type CustomerInput = { name: string; whatsapp?: string; address?: string };

interface ColumnRow extends RowDataPacket {
  COLUMN_NAME: string;
}

const getErrorMessage = (e: unknown): string => {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  try { return JSON.stringify(e); } catch { return String(e); }
};

function normalizeWhatsapp(inp: string): string {
  const s = inp.replace(/\s|-/g, "").trim();
  if (!s) return "";
  if (s.startsWith("+")) return s;
  if (s.startsWith("0")) return "+62" + s.slice(1);
  if (s.startsWith("62")) return "+" + s;
  return "+62" + s;
}
function isValidWhatsapp(wa: string): boolean {
  const digits = wa.replace(/[^0-9]/g, "");
  return digits.length >= 10 && digits.length <= 15;
}

async function requireSuperadmin(): Promise<{ ok: true; payload: any } | { ok: false; res: NextResponse }> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value || "";
  const payload = token ? verifySessionToken(token) : null;
  if (!payload) {
    return { ok: false, res: NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 }) };
  }
  if (payload.role !== "superadmin") {
    return { ok: false, res: NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 }) };
  }
  return { ok: true, payload };
}

async function migrateCustomersSchema(conn: PoolConnection) {
  await conn.query(`CREATE TABLE IF NOT EXISTS customers (
    uuid CHAR(36) PRIMARY KEY,
    name VARCHAR(128) NOT NULL,
    whatsapp VARCHAR(64) NULL,
    address VARCHAR(255) NULL,
    UNIQUE KEY unique_whatsapp (whatsapp)
  ) ENGINE=InnoDB`);
  // Pastikan kolom address tersedia untuk skema lama
  try { await conn.query(`ALTER TABLE customers ADD COLUMN address VARCHAR(255) NULL`); } catch {}
  // Migrasi kolom whatsapp agar nullable untuk skema lama
  try { await conn.query(`ALTER TABLE customers MODIFY COLUMN whatsapp VARCHAR(64) NULL`); } catch {}
}

export async function GET(req: NextRequest) {
  const guard = await requireSuperadmin();
  if (!guard.ok) return guard.res;
  try {
    const url = new URL(req.url);
    const page = Math.max(1, Number(url.searchParams.get("page") || "1"));
    const pageSizeRaw = Number(url.searchParams.get("pageSize") || "10");
    const pageSize = Math.min(100, Math.max(1, isNaN(pageSizeRaw) ? 10 : pageSizeRaw));
    const q = (url.searchParams.get("q") || "").trim();
    const tx = (url.searchParams.get("tx") || "all").toLowerCase(); // all|with|without

    const pool = getPool();
    const conn = await pool.getConnection();
    try {
      await migrateCustomersSchema(conn);

      const whereParts: string[] = [];
      const params: Array<string> = [];
      if (q) {
        whereParts.push("(name LIKE ? OR whatsapp LIKE ? OR address LIKE ?)");
        params.push(`%${q}%`, `%${q}%`, `%${q}%`);
      }
      const whereSql = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";

      const countSql = `SELECT COUNT(*) AS total FROM customers ${whereSql}`;
      const [countRows] = params.length ? await conn.query<RowDataPacket[]>(countSql, params) : await conn.query<RowDataPacket[]>(countSql);
      const total = Number(countRows?.[0]?.total || 0);
      const totalPages = Math.max(1, Math.ceil(total / pageSize));
      const offset = (page - 1) * pageSize;

      const sql = `SELECT uuid, name, whatsapp, address FROM customers ${whereSql} ORDER BY name ASC LIMIT ${offset}, ${pageSize}`;
      const [rows] = params.length ? await conn.query<RowDataPacket[]>(sql, params) : await conn.query<RowDataPacket[]>(sql);

      const data: Array<{ uuid: string; name: string; whatsapp: string; address: string | null; tx_count: number; last_tx: string | null; }> = [];
      for (const r of rows || []) {
        const id = String(r.uuid);
        const [[agg]] = await conn.query<RowDataPacket[]>(
          `SELECT COUNT(*) AS cnt, MAX(created_at) AS latest FROM invoices WHERE customer_uuid = ?`,
          [id]
        );
        const cnt = Number(agg?.cnt || 0);
        const latest = String(agg?.latest || "") || null;
        data.push({ uuid: id, name: String(r.name || ""), whatsapp: String(r.whatsapp || ""), address: r.address ? String(r.address) : null, tx_count: cnt, last_tx: latest });
      }

      // Filter after aggregation if tx filter requested
      const filtered = tx === "with" ? data.filter((d) => d.tx_count > 0) : tx === "without" ? data.filter((d) => d.tx_count === 0) : data;

      conn.release();
      return NextResponse.json({ ok: true, page, pageSize, total, totalPages, data: filtered }, { status: 200 });
    } catch (e) {
      conn.release();
      throw e;
    }
  } catch (e: unknown) {
    return NextResponse.json({ ok: true, page: 1, pageSize: 10, total: 0, totalPages: 1, data: [], warning: getErrorMessage(e) || "Customers API error" }, { status: 200 });
  }
}

export async function POST(req: NextRequest) {
  const guard = await requireSuperadmin();
  if (!guard.ok) return guard.res;
  try {
    const body = await req.json();
    const { name, whatsapp, address } = body || {} as CustomerInput;
    const n = String(name || "").trim();
    const wNorm = normalizeWhatsapp(String(whatsapp || ""));
    const wDigits = wNorm.replace(/[^0-9]/g, "");
    const w: string | null = wNorm ? wNorm : null;
    const a = address ? String(address).trim() : null;
    if (!n) {
      return NextResponse.json({ ok: false, error: "Nama wajib diisi" }, { status: 400 });
    }
    if (w && !isValidWhatsapp(w)) {
      return NextResponse.json({ ok: false, error: "Nomor WhatsApp tidak valid" }, { status: 400 });
    }
    const pool = getPool();
    const conn = await pool.getConnection();
    try {
      await migrateCustomersSchema(conn);
      if (w) {
        const [[exists]] = await conn.query<RowDataPacket[]>(`SELECT uuid FROM customers WHERE whatsapp = ? LIMIT 1`, [w]);
        if (exists) {
          conn.release();
          return NextResponse.json({ ok: false, error: "WhatsApp sudah terdaftar" }, { status: 409 });
        }
      }
      const [[uuidRow]] = await conn.query<RowDataPacket[]>(`SELECT UUID() AS uuid`);
      const uuid = String(uuidRow.uuid);
      await conn.query(`INSERT INTO customers (uuid, name, whatsapp, address) VALUES (?, ?, ?, ?)`, [uuid, n, w, a]);
      conn.release();
      return NextResponse.json({ ok: true, customer: { uuid } }, { status: 200 });
    } catch (e) {
      conn.release();
      throw e;
    }
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: getErrorMessage(e) || "Customers create error" }, { status: 500 });
  }
}