import { NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/utils/auth";
import { cookies } from "next/headers";

export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value || "";
  const payload = token ? verifySessionToken(token) : null;
  if (!payload) {
    return NextResponse.json({ ok: true, user: null }, { status: 200 });
  }
  return NextResponse.json({ ok: true, user: { id: payload.id, username: payload.username, role: payload.role } }, { status: 200 });
}