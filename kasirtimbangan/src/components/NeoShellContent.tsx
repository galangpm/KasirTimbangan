"use client";
import React from "react";
import { usePathname } from "next/navigation";

export default function NeoShellContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isLogin = pathname === "/login";

  return (
    <div className="neo-page">
      {isLogin ? (
        <div className="min-h-[100dvh] md:min-h-screen flex items-center justify-center p-4">
          {children}
        </div>
      ) : (
        <div className="neo-card">
          <div className="p-3 md:p-6">
            {children}
          </div>
        </div>
      )}
    </div>
  );
}