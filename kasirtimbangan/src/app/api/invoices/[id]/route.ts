import { NextRequest, NextResponse } from "next/server"
import { getPool } from "@/utils/db"
import type { RowDataPacket, ResultSetHeader } from "mysql2/promise"

// Helper untuk mengekstrak pesan error secara aman
const getErrorMessage = (e: unknown): string => {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  try { return JSON.stringify(e); } catch { return String(e); }
};

// Tipe baris untuk hasil query
type InvoiceRow = RowDataPacket & { id: string; created_at: string; payment_method: string | null; notes: string | null };
type InvoiceItemRow = RowDataPacket & {
  id: string;
  fruit: string;
  weight_kg: number;
  price_per_kg: number;
  total_price: number;
  image_data_url: string | null;
  full_image_data_url: string | null;
};

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  try {
    const pool = getPool()
    const conn = await pool.getConnection()
    try {
      const [invRows] = await conn.query<InvoiceRow[]>(
        `SELECT id, created_at, payment_method, COALESCE(notes, NULL) AS notes FROM invoices WHERE id = ? LIMIT 1`,
        [id]
      )
      const inv = invRows[0]
      if (!inv) {
        conn.release()
        return NextResponse.json({ ok: false, error: "Nota tidak ditemukan" }, { status: 404 })
      }

      const [items] = await conn.query<InvoiceItemRow[]>(
        `SELECT id, fruit, weight_kg, price_per_kg, total_price, image_data_url, full_image_data_url
         FROM invoice_items WHERE invoice_id = ? ORDER BY id ASC`,
        [id]
      )

      conn.release()
      return NextResponse.json({ ok: true, invoice: inv, items }, { status: 200 })
    } catch (e) {
      conn.release()
      throw e
    }
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: getErrorMessage(e) || "Invoice detail error" }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const pool = getPool();
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query(`DELETE FROM invoice_items WHERE invoice_id = ?`, [id]);
      const [res] = await conn.query<ResultSetHeader>(`DELETE FROM invoices WHERE id = ?`, [id]);
      await conn.commit();
      conn.release();
      if ((res.affectedRows || 0) === 0) {
        return NextResponse.json({ ok: false, error: "Nota tidak ditemukan" }, { status: 404 });
      }
      return NextResponse.json({ ok: true }, { status: 200 });
    } catch (e) {
      await conn.rollback();
      conn.release();
      throw e;
    }
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: getErrorMessage(e) || "Invoice delete error" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const body = await req.json();
    const { payment_method, notes } = body || {} as { payment_method?: string; notes?: string };
    if (!payment_method || !["cash", "card", "qr", "tester", "gift"].includes(payment_method)) {
      return NextResponse.json({ ok: false, error: "Metode pembayaran tidak valid" }, { status: 400 });
    }
    // Wajib notes untuk tester/hadiah
    if ((payment_method === "tester" || payment_method === "gift") && (!notes || !String(notes).trim())) {
      return NextResponse.json({ ok: false, error: "Catatan wajib diisi untuk metode Tester/Hadiah" }, { status: 400 });
    }
    const pool = getPool();
    const conn = await pool.getConnection();
    try {
      // Pastikan kolom notes ada
      try {
        const [cols] = await conn.query<RowDataPacket[]>(
          `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'invoices' AND COLUMN_NAME = 'notes'`
        );
        if (!Array.isArray(cols) || cols.length === 0) {
          await conn.query(`ALTER TABLE invoices ADD COLUMN notes TEXT NULL`);
        }
      } catch {}

      const [res] = await conn.query<ResultSetHeader>(
        `UPDATE invoices SET payment_method = ?, notes = ? WHERE id = ?`,
        [payment_method, notes ?? null, id]
      );
      conn.release();
      if ((res.affectedRows || 0) === 0) {
        return NextResponse.json({ ok: false, error: "Nota tidak ditemukan" }, { status: 404 });
      }
      return NextResponse.json({ ok: true }, { status: 200 });
    } catch (e) {
      conn.release();
      throw e;
    }
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: getErrorMessage(e) || "Invoice update error" }, { status: 500 });
  }
}