"use client";
import { useEffect } from "react";

export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return; // Hindari registrasi di dev (StrictMode/HMR)
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  
    const onLoad = () => {
      // Dedup: jika sudah ada controller atau pendaftaran aktif, jangan register lagi
      navigator.serviceWorker.getRegistrations?.().then((regs) => {
        const hasActive = regs?.some((r) => r.active || r.waiting || r.installing);
        if (hasActive || navigator.serviceWorker.controller) return;
  
        // Jadwalkan saat idle untuk menghindari benturan dengan hydration
        const idle = (cb: () => void) => {
          const w = window as unknown as { requestIdleCallback?: (cb: IdleRequestCallback, opts?: { timeout?: number }) => number };
          const ric = w.requestIdleCallback;
          if (typeof ric === "function") ric(() => cb(), { timeout: 3000 });
          else setTimeout(cb, 0);
        };
        idle(() => {
          navigator.serviceWorker
            .register("/sw.js")
            .catch((err) => console.error("SW registration failed", err));
        });
      });
    };
  
    if (document.readyState === "complete") onLoad();
    else window.addEventListener("load", onLoad, { once: true });
  
    return () => window.removeEventListener("load", onLoad);
  }, []);
  return null;
}