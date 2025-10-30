import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/utils/auth";
import { cookies } from "next/headers";

// Helper: delete all cookies safely
async function clearAllCookies(res: NextResponse, secure: boolean) {
  const store = await cookies();
  const all = store.getAll();
  for (const c of all) {
    // Use set with maxAge 0 for broad compatibility
    res.cookies.set(c.name, "", {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure,
      maxAge: 0,
    });
  }
  // Ensure session cookie is cleared even if not returned in getAll
  res.cookies.set(SESSION_COOKIE, "", {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure,
    maxAge: 0,
  });
}

export async function POST(req: NextRequest) {
  // Deteksi HTTPS untuk konsistensi flag secure
  const forwardedProto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || "";
  const forwardedSsl = req.headers.get("x-forwarded-ssl") || "";
  const isHttps = forwardedProto === "https" || forwardedSsl === "on" || req.nextUrl.protocol === "https:";

  const res = NextResponse.json({ ok: true }, { status: 200 });
  await clearAllCookies(res, isHttps);
  return res;
}

// Support direct navigation to /api/auth/logout to redirect to login cleanly
export async function GET(req: NextRequest) {
  // Force redirect ke domain yang dikonfigurasi via env jika tersedia
  const forwardedProto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || "";
  const forwardedSsl = req.headers.get("x-forwarded-ssl") || "";
  const isHttps = forwardedProto === "https" || forwardedSsl === "on" || req.nextUrl.protocol === "https:";

  const rawEnvOrigin = (process.env.APP_PUBLIC_ORIGIN || process.env.NEXT_PUBLIC_APP_ORIGIN || process.env.APP_BASE_DOMAIN || process.env.NEXT_PUBLIC_BASE_DOMAIN || "").trim();
  let origin = rawEnvOrigin;
  if (origin) {
    // Jika env hanya berisi domain tanpa skema, tambahkan skema berdasarkan koneksi
    if (!/^https?:\/\//i.test(origin)) {
      origin = `${isHttps ? "https" : "http"}://${origin}`;
    }
    // Hilangkan trailing slash agar konsisten
    origin = origin.replace(/\/+$/, "");
  }
  const target = origin ? `${origin}/login` : "/login";

  const res = NextResponse.redirect(target, { status: 302 });
  await clearAllCookies(res, isHttps);
  return res;
}