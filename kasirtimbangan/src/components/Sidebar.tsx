"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import React, { useEffect, useMemo, useState } from "react";

type MenuItem = { href: string; label: string };

const BASE_ITEMS: MenuItem[] = [
  { href: "/", label: "Kasir" },
  { href: "/invoices", label: "Invoices" },
  { href: "/customers", label: "Pelanggan" },
  { href: "/uploads", label: "Upload Gambar" },
  { href: "/analytics", label: "Analitik" },
  { href: "/settings", label: "Pengaturan" },
  { href: "/debug/printer-bluetooth", label: "Debug Printer Bluetooth" },
];

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname.startsWith(href);
}

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  // Tentukan halaman login; jangan return sebelum hooks untuk patuh Rules of Hooks
  const hideSidebar = pathname.startsWith("/login") || pathname.startsWith("/install");
  const [role, setRole] = useState<"superadmin" | "kasir" | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const items = useMemo<MenuItem[]>(() => {
    if (role === "superadmin") return [...BASE_ITEMS, { href: "/logs", label: "Log Aktivitas" }, { href: "/users", label: "Manajemen User" }];
    if (role === "kasir") return [
      { href: "/", label: "Kasir" },
      { href: "/kasir/invoices", label: "Invoice Saya" },
      { href: "/uploads", label: "Upload Gambar" },
      { href: "/debug/printer-bluetooth", label: "Debug Printer Bluetooth" },
    ];
    return [{ href: "/login", label: "Login" }];
  }, [role]);

  useEffect(() => {
    if (hideSidebar) return; // hindari fetch saat halaman tanpa sidebar
    const load = async () => {
      try {
        const res = await fetch("/api/auth/me");
        const data = await res.json();
        if (data?.user) {
          setRole(data.user.role);
          setUsername(data.user.username);
        } else {
          setRole(null);
          setUsername(null);
        }
        try {
          const sres = await fetch("/api/settings");
          const sdata = await sres.json();
          const s = sdata?.settings;
          if (s && s.logoUrl) setLogoUrl(String(s.logoUrl));
        } catch {}
      } catch {}
    };
    load();
  }, [hideSidebar]);

  const logout = () => {
    // Navigasi ke endpoint logout yang akan menghapus semua cookie dan redirect ke /login
    window.location.replace("/api/auth/logout");
  };
  // Hilangkan gating mounted untuk mencegah hydration mismatch
  if (hideSidebar) return null;
  return (
    <>
      {/* Mobile top navigation (no hamburger, just horizontal scroll links) */}
      <nav className="md:hidden sticky top-0 z-30 bg-white border-b">
        <ul className="flex overflow-x-auto gap-2 p-2">
          {items.map((item) => {
            const active = isActive(pathname, item.href);
            const cls = active ? "neo-button small" : "neo-button ghost small";
            return (
              <li key={item.href} className="shrink-0">
                <Link href={item.href} className={`${cls} whitespace-nowrap`}>
                  {item.label}
                </Link>
              </li>
            );
          })}
          {role && (
            <li className="shrink-0">
              <button className="neo-button small danger" onClick={logout}>Logout</button>
            </li>
          )}
        </ul>
      </nav>

      {/* Desktop sidebar */}
  <aside className="hidden md:flex md:flex-col md:w-64 border-r bg-white h-[100dvh] md:h-screen sticky top-0 overflow-hidden neo-card">
    <div className="px-4 py-4 border-b">
      <div className="flex items-center justify-between">
        <img src={(logoUrl || "/logo.png") as string} alt="Kasir Timbangan" className="w-full h-auto" />
      </div>
      {role && (
        <div className="text-xs text-slate-500 mt-1">Masuk sebagai {username} ({role})</div>
      )}
    </div>
    <nav className="flex-1 px-2 py-4">
          <div className="text-xs uppercase text-slate-500 px-3 mb-2">Operasional</div>
          <ul className="space-y-1">
            {items.map((item) => {
              const active = isActive(pathname, item.href);
              const cls = active ? "neo-button small w-full justify-start" : "neo-button ghost small w-full justify-start";
              return (
                <li key={item.href}>
                  <Link href={item.href} className={cls}>
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        {/* Bottom sticky logout */}
        <div className="px-2 py-4 border-t">
          {role && (
            <button className="neo-button small danger w-full" onClick={logout}>Logout</button>
          )}
        </div>
      </aside>
    </>
  );
}