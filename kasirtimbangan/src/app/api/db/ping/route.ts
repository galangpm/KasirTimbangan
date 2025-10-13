import { NextResponse } from "next/server";
import { getPool } from "@/utils/db";

const getErrorMessage = (e: unknown): string => {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  try { return JSON.stringify(e); } catch { return String(e); }
};

export async function GET() {
  try {
    const pool = getPool();
    const [result] = await pool.query("SELECT 1 AS ok");
    return NextResponse.json({ ok: true, result }, { status: 200 });
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: getErrorMessage(e) || "DB error" }, { status: 500 });
  }
}