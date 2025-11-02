import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/utils/db";
import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySessionToken } from "@/utils/auth";
import { retryUpload } from "@/utils/uploadWorker";
// Mode manual: tidak memulai worker otomatis di endpoint ini

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value || "";
  const payload = token ? verifySessionToken(token) : null;
  if (!payload) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const { id: idParam } = await ctx.params;
  const id = Number(idParam);
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ ok: false, error: "Invalid upload id" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const action = String(body?.action || "").toLowerCase();
  if (action !== "retry") {
    return NextResponse.json({ ok: false, error: "Unsupported action" }, { status: 400 });
  }

  // Pastikan job masih ada
  const pool = getPool();
  const [[row]] = await pool.query<any[]>(`SELECT id FROM uploads WHERE id=? LIMIT 1`, [id]);
  if (!row) {
    return NextResponse.json({ ok: false, error: "Upload not found" }, { status: 404 });
  }

  await retryUpload(id);
  return NextResponse.json({ ok: true, id, status: "queued" }, { status: 200 });
}