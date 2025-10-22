import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/utils/auth";
import { cookies } from "next/headers";

// Helper: delete all cookies safely
async function clearAllCookies(res: NextResponse) {
  const store = await cookies();
  const all = store.getAll();
  for (const c of all) {
    // Use set with maxAge 0 for broad compatibility
    res.cookies.set(c.name, "", {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 0,
    });
  }
  // Ensure session cookie is cleared even if not returned in getAll
  res.cookies.set(SESSION_COOKIE, "", {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 0,
  });
}

export async function POST() {
  const res = NextResponse.json({ ok: true }, { status: 200 });
  await clearAllCookies(res);
  return res;
}

// Support direct navigation to /api/auth/logout to redirect to login cleanly
export async function GET(req: NextRequest) {
  // Prefer absolute redirect to public origin if provided, fallback to current request origin
  const envOrigin = process.env.APP_PUBLIC_ORIGIN || process.env.NEXT_PUBLIC_APP_ORIGIN || "";
  const requestOrigin = (() => {
    try { return new URL(req.url).origin; } catch { return ""; }
  })();
  const origin = envOrigin || requestOrigin || "";
  const target = origin ? `${origin}/login` : "/login";
  const res = NextResponse.redirect(target, { status: 302 });
  await clearAllCookies(res);
  return res;
}