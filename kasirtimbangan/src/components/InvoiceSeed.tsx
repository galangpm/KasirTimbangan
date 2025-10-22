"use client";
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { getLastFingerprint, setLastFingerprint, purgeExpired } from "@/utils/invoiceCache";

// Seeder ringan: jalan tiap 1 menit, hanya fetch jika fingerprint berubah
export default function InvoiceSeed() {
  const pathname = usePathname();
  const isLoginPage = (pathname || "").startsWith("/login");

  const timerRef = useRef<number | null>(null);
  const runningRef = useRef<boolean>(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (isLoginPage) return; // jangan jalan di halaman login
    const checkAndSeed = async () => {
      if (runningRef.current) return; // hindari overlapped
      runningRef.current = true;
      try {
        // Bersihkan cache yang kadaluarsa secara opportunistic
        purgeExpired();
        abortRef.current = new AbortController();
        const res = await fetch("/api/invoices?meta=last24", { cache: "no-store", signal: abortRef.current.signal });
        const json = await res.json();
        if (res.ok && json?.fingerprint) {
          const fpServer = String(json.fingerprint);
          const fpLocal = getLastFingerprint();
          if (fpLocal !== fpServer) {
            // Fingerprint berubah: lakukan reseed data last24 untuk mempercepat akses detail
            // Ambil halaman-paging awal last24, hanya metadata penting untuk cache list jika diperlukan
            try {
              const listRes = await fetch("/api/invoices?range=last24&page=1&pageSize=50", { cache: "no-store", signal: abortRef.current.signal });
              const listJson = await listRes.json();
              if (listRes.ok && Array.isArray(listJson?.data)) {
                // Tidak menyimpan item per-entry di sini untuk hemat bandwidth; detail akan diambil saat dibuka
                // Hanya update fingerprint sehingga komponen lain tahu ada perubahan
                setLastFingerprint(fpServer);
              } else {
                // Jika gagal, jangan update fingerprint agar coba lagi di iterasi berikutnya
              }
            } catch {}
          } else {
            // Tidak ada perubahan, cukup lewat
          }
        }
      } catch {}
      finally {
        runningRef.current = false;
        abortRef.current = null;
      }
    };

    // Jalankan saat idle pertama kali
    const startIdle = () => {
      type IdleDeadline = { readonly didTimeout: boolean; timeRemaining: () => number };
      type RequestIdleCallbackHandle = number;
      type RequestIdleCallbackOptions = { timeout?: number };
      type RequestIdleCallbackFunc = (
        callback: (deadline: IdleDeadline) => void,
        options?: RequestIdleCallbackOptions
      ) => RequestIdleCallbackHandle;

      const w = window as Window & { requestIdleCallback?: RequestIdleCallbackFunc };
      if (typeof w.requestIdleCallback === "function") {
        w.requestIdleCallback(() => { void checkAndSeed(); }, { timeout: 1500 });
      } else {
        setTimeout(() => { void checkAndSeed(); }, 500);
      }
    };

    startIdle();
    // Interval setiap 1 menit
    timerRef.current = window.setInterval(checkAndSeed, 60_000);
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
      if (abortRef.current) {
        try { abortRef.current.abort(); } catch {}
      }
    };
  }, [isLoginPage]);

  return null;
}