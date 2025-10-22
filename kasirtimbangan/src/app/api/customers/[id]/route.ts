import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getPool } from "@/utils/db";
import type { RowDataPacket, ResultSetHeader } from "mysql2/promise";
import { SESSION_COOKIE, verifySessionToken } from "@/utils/auth";

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

async function requireSuperadmin(): Promise<{ ok: true } | { ok: false; res: NextResponse }> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value || "";
  const payload = token ? verifySessionToken(token) : null;
  if (!payload) return { ok: false, res: NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 }) };
  if (payload.role !== "superadmin") {
    return { ok: false, res: NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 }) };
  }
  return { ok: true };
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireSuperadmin();
  if (!guard.ok) return guard.res;
  const { id } = await ctx.params;
  try {
    const pool = getPool();
    const conn = await pool.getConnection();
    try {
      const [[cust]] = await conn.query<RowDataPacket[]>(
        `SELECT uuid, name, whatsapp, address FROM customers WHERE uuid = ? LIMIT 1`,
        [id]
      );
      if (!cust) {
        conn.release();
        return NextResponse.json({ ok: false, error: "Customer tidak ditemukan" }, { status: 404 });
      }

      const [invRows] = await conn.query<RowDataPacket[]>(
        `SELECT i.id, i.created_at, i.payment_method FROM invoices i WHERE i.customer_uuid = ? ORDER BY i.created_at DESC`,
        [id]
      );
      const data: Array<{ id: string; created_at: string; payment_method: string | null; items_count: number; grand_total: number; }> = [];
      for (const r of invRows || []) {
        const [[agg]] = await conn.query<RowDataPacket[]>(
          `SELECT COALESCE(SUM(total_price), 0) AS grand_total, COUNT(id) AS items_count FROM invoice_items WHERE invoice_id = ?`,
          [String(r.id)]
        );
        data.push({
          id: String(r.id),
          created_at: String(r.created_at),
          payment_method: r.payment_method == null ? null : String(r.payment_method),
          items_count: Number(agg?.items_count || 0),
          grand_total: Number(agg?.grand_total || 0),
        });
      }
      conn.release();
      return NextResponse.json({ ok: true, customer: { uuid: String(cust.uuid), name: String(cust.name), whatsapp: cust.whatsapp == null ? null : String(cust.whatsapp), address: cust.address ? String(cust.address) : null }, transactions: data }, { status: 200 });
    } catch (e) {
      conn.release();
      throw e;
    }
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: getErrorMessage(e) || "Customer detail error" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireSuperadmin();
  if (!guard.ok) return guard.res;
  const { id } = await ctx.params;
  try {
    const body = await req.json();
    const nameRaw = String(body?.name || "").trim();
    const waRaw = String(body?.whatsapp || "").trim();
    const addrRaw = body?.address ? String(body.address).trim() : null;
    if (!nameRaw) return NextResponse.json({ ok: false, error: "Nama wajib diisi" }, { status: 400 });
    const waNorm = normalizeWhatsapp(waRaw);
    const wa: string | null = waNorm ? waNorm : null;
    if (wa && !isValidWhatsapp(wa)) return NextResponse.json({ ok: false, error: "Nomor WhatsApp tidak valid" }, { status: 400 });
    const pool = getPool();
    const conn = await pool.getConnection();
    try {
      if (wa) {
        const [[existsOther]] = await conn.query<RowDataPacket[]>(
          `SELECT uuid FROM customers WHERE whatsapp = ? AND uuid <> ? LIMIT 1`,
          [wa, id]
        );
        if (existsOther) {
          conn.release();
          return NextResponse.json({ ok: false, error: "WhatsApp sudah dipakai customer lain" }, { status: 409 });
        }
      }
      const [res] = await conn.query<ResultSetHeader>(
        `UPDATE customers SET name = ?, whatsapp = ?, address = ? WHERE uuid = ?`,
        [nameRaw, wa, addrRaw, id]
      );
      conn.release();
      if ((res.affectedRows || 0) === 0) return NextResponse.json({ ok: false, error: "Customer tidak ditemukan" }, { status: 404 });
      return NextResponse.json({ ok: true }, { status: 200 });
    } catch (e) {
      conn.release();
      throw e;
    }
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: getErrorMessage(e) || "Customer update error" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireSuperadmin();
  if (!guard.ok) return guard.res;
  const { id } = await ctx.params;
  try {
    const pool = getPool();
    const conn = await pool.getConnection();
    try {
      const [res] = await conn.query<ResultSetHeader>(`DELETE FROM customers WHERE uuid = ?`, [id]);
      conn.release();
      if ((res.affectedRows || 0) === 0) return NextResponse.json({ ok: false, error: "Customer tidak ditemukan" }, { status: 404 });
      return NextResponse.json({ ok: true }, { status: 200 });
    } catch (e) {
      conn.release();
      throw e;
    }
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: getErrorMessage(e) || "Customer delete error" }, { status: 500 });
  }
}