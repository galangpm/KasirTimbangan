import { getPool } from "@/utils/db";
import type { PoolConnection, RowDataPacket, ResultSetHeader } from "mysql2/promise";
import fs from "fs";
import path from "path";

type UploadRow = {
  id: number;
  invoice_id: string;
  invoice_item_id: number | null;
  item_index: number | null;
  kind: "thumb" | "full" | string;
  status: "queued" | "uploading" | "success" | "error" | string;
  progress: number;
  filename: string | null;
  data_url: string | null;
  attempts: number;
};

type IdRow = RowDataPacket & { id: number | string };

const isDataUrlImage = (v: unknown): boolean => {
  const s = String(v || "");
  return /^data:image\/(png|jpe?g|webp);base64,/i.test(s);
};

let started = false;
let ticking = false;
const TICK_MS = 1500;
const BATCH_LIMIT = 2; // proses 2 file sekaligus untuk efisiensi

export function ensureUploadWorkerStarted() {
  if (started) return;
  started = true;
  setInterval(tick, TICK_MS);
}

async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    const pool = getPool();
    const conn = await pool.getConnection();
    try {
      const [rows] = await conn.query<RowDataPacket[]>(
        `SELECT id FROM uploads WHERE status = 'queued' ORDER BY created_at ASC LIMIT ?`,
        [BATCH_LIMIT]
      );
      const ids = (rows as IdRow[]).map((r) => Number(r.id)).filter((n) => Number.isFinite(n));
      // Lock jobs to "uploading"
      for (const id of ids) {
        await conn.query(`UPDATE uploads SET status='uploading', attempts=attempts+1, progress=0 WHERE id=? AND status='queued'`, [id]);
      }
      conn.release();
      // Process sequentially to simplify progress updates
      for (const id of ids) {
        await processJob(id);
      }
    } catch (e) {
      try { conn.release(); } catch {}
      // swallow; will retry next tick
    }
  } finally {
    ticking = false;
  }
}

async function processJob(id: number) {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    const [[job]] = await conn.query<RowDataPacket[]>(`SELECT * FROM uploads WHERE id = ? LIMIT 1`, [id]);
    if (!job) {
      try { await conn.query(`UPDATE uploads SET status='error', last_error='Job not found' WHERE id=?`, [id]); } catch {}
      conn.release();
      return;
    }
    const dataUrl: string = String(job.data_url || "");
    if (!isDataUrlImage(dataUrl)) {
      await conn.query(`UPDATE uploads SET status='error', last_error='Invalid data url' WHERE id=?`, [id]);
      conn.release();
      return;
    }
    const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/i.exec(dataUrl);
    const mime = (m?.[1] || "image/png").toLowerCase();
    const b64 = m?.[2] || "";
    const ext = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg";

    const dir = path.join(process.cwd(), "public", "images");
    await fs.promises.mkdir(dir, { recursive: true });
    const safeInv = String(job.invoice_id || "").replace(/[^a-zA-Z0-9_-]/g, "");
    const kind = String(job.kind || "thumb");
    const idx = Number(job.item_index ?? job.invoice_item_id ?? 0);
    const filename = `inv_${safeInv}_${idx}_${kind}.${ext}`;
    const filePath = path.join(dir, filename);

    const buf = Buffer.from(b64, "base64");
    const total = buf.length;
    const chunkSize = 64 * 1024;
    const stream = fs.createWriteStream(filePath);
    let offset = 0;
    await new Promise<void>((resolve, reject) => {
      function writeChunk() {
        try {
          while (offset < total) {
            const end = Math.min(offset + chunkSize, total);
            const chunk = buf.subarray(offset, end);
            const ok = stream.write(chunk);
            offset = end;
            const prog = Math.min(99, Math.floor((offset / total) * 100));
            // best-effort progress update
            conn.query(`UPDATE uploads SET progress=? WHERE id=?`, [prog, id]).catch(() => {});
            if (!ok) { stream.once("drain", writeChunk); return; }
          }
          stream.end();
        } catch (e) {
          reject(e);
        }
      }
      stream.on("finish", resolve);
      stream.on("error", reject);
      writeChunk();
    });

    const publicUrl = `/images/${filename}`;
    await conn.query(`UPDATE uploads SET status='success', progress=100, filename=? WHERE id=?`, [publicUrl, id]);

    // Update kolom di invoice_items sesuai jenis gambar
    const itemId = Number(job.invoice_item_id || 0);
    if (itemId > 0) {
      if (String(kind).toLowerCase() === "full") {
        await conn.query(`UPDATE invoice_items SET full_image_data_url=? WHERE id=?`, [publicUrl, itemId]);
      } else {
        await conn.query(`UPDATE invoice_items SET image_data_url=? WHERE id=?`, [publicUrl, itemId]);
      }
    }

    conn.release();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    try { await conn.query(`UPDATE uploads SET status='error', last_error=? WHERE id=?`, [msg, id]); } catch {}
    try { conn.release(); } catch {}
  }
}

export async function retryUpload(id: number) {
  const pool = getPool();
  await pool.query(`UPDATE uploads SET status='queued', progress=0, last_error=NULL WHERE id=?`, [id]);
}

export async function enqueueUploadJob(params: {
  invoiceId: string;
  invoiceItemId: number;
  itemIndex?: number | null;
  kind: "thumb" | "full";
  dataUrl: string;
}) {
  const { invoiceId, invoiceItemId, itemIndex = null, kind, dataUrl } = params;
  if (!isDataUrlImage(dataUrl)) return; // abaikan jika bukan data URL gambar
  const pool = getPool();
  await pool.query(
    `INSERT INTO uploads (invoice_id, invoice_item_id, item_index, kind, status, progress, filename, data_url, attempts)
     VALUES (?, ?, ?, ?, 'queued', 0, NULL, ?, 0)`,
    [invoiceId, invoiceItemId, itemIndex, kind, dataUrl]
  );
}

// Jalankan satu batch proses upload secara manual tanpa interval background
export async function processQueuedBatch(limit: number = BATCH_LIMIT): Promise<{ processed: number }>
{
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    const max = Math.max(1, Number(limit) || BATCH_LIMIT);
    const [rows] = await conn.query<RowDataPacket[]>(
      `SELECT id FROM uploads WHERE status = 'queued' ORDER BY created_at ASC LIMIT ?`,
      [max]
    );
    const ids = (rows as IdRow[]).map((r) => Number(r.id)).filter((n) => Number.isFinite(n));
    for (const id of ids) {
      await conn.query(
        `UPDATE uploads SET status='uploading', attempts=attempts+1, progress=0 WHERE id=? AND status='queued'`,
        [id]
      );
    }
    conn.release();
    for (const id of ids) {
      await processJob(id);
    }
    return { processed: ids.length };
  } catch (e) {
    try { conn.release(); } catch {}
    throw e;
  }
}