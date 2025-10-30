import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getPool } from "@/utils/db";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { SESSION_COOKIE, verifySessionToken } from "@/utils/auth";
import * as XLSX from "xlsx";

interface CustomerExportRow extends RowDataPacket {
  uuid: string;
  name: string;
  whatsapp: string | null;
  address: string | null;
  tx_count: number;
  last_tx: string | null;
}

const getErrorMessage = (e: unknown): string => {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  try { return JSON.stringify(e); } catch { return String(e); }
};

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
  // Pastikan tabel customers ada sesuai skema terbaru
  await conn.query(`CREATE TABLE IF NOT EXISTS customers (
    uuid CHAR(36) PRIMARY KEY,
    name VARCHAR(128) NOT NULL,
    whatsapp VARCHAR(64) NULL,
    address VARCHAR(255) NULL,
    UNIQUE KEY unique_whatsapp (whatsapp)
  ) ENGINE=InnoDB`);
  try { await conn.query(`ALTER TABLE customers ADD COLUMN address VARCHAR(255) NULL`); } catch {}
  try { await conn.query(`ALTER TABLE customers MODIFY COLUMN whatsapp VARCHAR(64) NULL`); } catch {}
}

function parseDateOnly(input: string | null): string | null {
  if (!input) return null;
  const s = input.trim();
  if (!s) return null;
  // Terima format YYYY-MM-DD dan validasi sederhana
  const m = s.match(/^\d{4}-\d{2}-\d{2}$/);
  return m ? s : null;
}

export async function GET(req: NextRequest) {
  const guard = await requireSuperadmin();
  if (!guard.ok) return guard.res;
  try {
    const url = new URL(req.url);
    const start = parseDateOnly(url.searchParams.get("start"));
    const end = parseDateOnly(url.searchParams.get("end"));
    const includeNoTx = ["1", "true", "yes"].includes(String(url.searchParams.get("includeNoTx") || "").toLowerCase());

    const pool = getPool();
    const conn = await pool.getConnection();
    try {
      await migrateCustomersSchema(conn);

      // Query agregasi customers + ringkasan transaksi
      let sql = `
        SELECT 
          c.uuid AS uuid,
          c.name AS name,
          c.whatsapp AS whatsapp,
          c.address AS address,
          COUNT(i.id) AS tx_count,
          MAX(i.created_at) AS last_tx
        FROM customers c
        LEFT JOIN invoices i ON i.customer_uuid = c.uuid
        GROUP BY c.uuid, c.name, c.whatsapp, c.address
      `;
      const havingParts: string[] = [];
      const params: Array<string | number> = [];
      if (start && end) {
        havingParts.push(`(MAX(i.created_at) IS NOT NULL AND DATE(MAX(i.created_at)) BETWEEN ? AND ?)`);
        params.push(start, end);
        if (includeNoTx) {
          havingParts.push(`(MAX(i.created_at) IS NULL)`);
        }
      } else if (start) {
        havingParts.push(`(MAX(i.created_at) IS NOT NULL AND DATE(MAX(i.created_at)) >= ?)`);
        params.push(start);
        if (includeNoTx) {
          havingParts.push(`(MAX(i.created_at) IS NULL)`);
        }
      } else if (end) {
        havingParts.push(`(MAX(i.created_at) IS NOT NULL AND DATE(MAX(i.created_at)) <= ?)`);
        params.push(end);
        if (includeNoTx) {
          havingParts.push(`(MAX(i.created_at) IS NULL)`);
        }
      } else {
        // tanpa filter tanggal: tampilkan semua
      }
      if (havingParts.length) {
        sql += ` HAVING ${havingParts.join(" OR ")}`;
      }
      sql += ` ORDER BY c.name ASC`;

      const [rows] = params.length
        ? await conn.query<CustomerExportRow[]>(sql, params)
        : await conn.query<CustomerExportRow[]>(sql);

      // Bangun workbook Excel
      const aoa: any[][] = [];
      aoa.push(["UUID", "Nama", "WhatsApp", "Alamat", "Jumlah Transaksi", "Transaksi Terakhir"]);
      for (const r of rows || []) {
        aoa.push([
          String(r.uuid || ""),
          String(r.name || ""),
          r.whatsapp ? String(r.whatsapp) : "",
          r.address ? String(r.address) : "",
          Number(r.tx_count || 0),
          r.last_tx ? String(r.last_tx) : "",
        ]);
      }
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      // Set lebar kolom agar rapi
      (ws as any)["!cols"] = [
        { wch: 38 }, // UUID
        { wch: 24 }, // Nama
        { wch: 18 }, // WhatsApp
        { wch: 36 }, // Alamat
        { wch: 18 }, // Jumlah Transaksi
        { wch: 22 }, // Transaksi Terakhir
      ];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Pelanggan");
      const buf: Buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

      conn.release();

      const fileNameParts: string[] = ["customers_export"];
      if (start) fileNameParts.push(start.replace(/-/g, ""));
      if (end) fileNameParts.push(end.replace(/-/g, ""));
      const fileName = `${fileNameParts.join("_") || "customers_export"}.xlsx`;
      const arr = new Uint8Array(buf);
      const blob = new Blob([arr], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });

      return new NextResponse(blob, {
        status: 200,
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="${fileName}"`,
          "Cache-Control": "no-store",
        },
      });
    } catch (e) {
      conn.release();
      throw e;
    }
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: getErrorMessage(e) || "Export customers error" }, { status: 500 });
  }
}