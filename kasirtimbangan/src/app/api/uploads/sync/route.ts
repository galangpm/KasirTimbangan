import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySessionToken } from "@/utils/auth";
import { processQueuedBatch, enqueueUploadJob } from "@/utils/uploadWorker";
import { getPool } from "@/utils/db";

export async function POST(req: NextRequest) {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value || "";
  const payload = token ? verifySessionToken(token) : null;
  if (!payload) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (payload.role !== "kasir" && payload.role !== "superadmin") {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const rawLimit = Number(body?.limit ?? 0);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : undefined;
  try {
    // Enqueue terlebih dahulu semua gambar data URL yang belum diupload
    const pool = getPool();
    const [items]: any[] = await pool.query(
      `SELECT id, invoice_id, image_data_url, full_image_data_url
       FROM invoice_items
       WHERE (image_data_url LIKE 'data:image/%' OR full_image_data_url LIKE 'data:image/%')`
    );
    for (const row of items || []) {
      const invoiceItemId = Number(row.id);
      const invoiceId = String(row.invoice_id);
      const img = String(row.image_data_url || "");
      const full = String(row.full_image_data_url || "");
      // Cek apakah sudah ada job aktif untuk item/kind ini
      async function hasActive(kind: "thumb" | "full"): Promise<boolean> {
        const [[exists]] = await pool.query<any[]>(
          `SELECT id FROM uploads WHERE invoice_item_id = ? AND kind = ? AND status IN ('queued','uploading') LIMIT 1`,
          [invoiceItemId, kind]
        );
        return !!exists;
      }
      if (img.startsWith("data:image/") && !(await hasActive("thumb"))) {
        await enqueueUploadJob({ invoiceId, invoiceItemId, itemIndex: null, kind: "thumb", dataUrl: img });
      }
      if (full.startsWith("data:image/") && !(await hasActive("full"))) {
        await enqueueUploadJob({ invoiceId, invoiceItemId, itemIndex: null, kind: "full", dataUrl: full });
      }
    }

    // Lalu proses batch antrian upload
    const res = await processQueuedBatch(limit ?? undefined);
    return NextResponse.json({ ok: true, processed: res.processed }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Sync error" }, { status: 500 });
  }
}