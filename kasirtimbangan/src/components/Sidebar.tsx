"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import React from "react";

const MENU_ITEMS = [
  { href: "/", label: "Kasir" },
  { href: "/invoices", label: "Invoices" },
  { href: "/analytics", label: "Analitik" },
  { href: "/settings", label: "Pengaturan" },
];

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname.startsWith(href);
}

export default function Sidebar() {
  const pathname = usePathname();
  // Hilangkan gating mounted untuk mencegah hydration mismatch

  return (
    <>
      {/* Mobile top navigation (no hamburger, just horizontal scroll links) */}
      <nav className="md:hidden sticky top-0 z-30 bg-white border-b">
        <ul className="flex overflow-x-auto gap-2 p-2">
          {MENU_ITEMS.map((item) => {
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
        </ul>
      </nav>

      {/* Desktop sidebar */}
      <aside className="hidden md:flex md:flex-col md:w-64 border-r bg-white min-h-screen sticky top-0 neo-card">
        <div className="px-4 py-4 border-b">
          <span className="font-semibold text-lg">Kasir Timbangan</span>
        </div>
        <nav className="flex-1 px-2 py-4">
          <div className="text-xs uppercase text-slate-500 px-3 mb-2">Operasional</div>
          <ul className="space-y-1">
            {MENU_ITEMS.map((item) => {
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
      </aside>
    </>
  );
}