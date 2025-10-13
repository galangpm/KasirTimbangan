"use client";
import { useEffect, useRef } from "react";

export default function PaymentModal({
  open,
  onClose,
  onPay,
  receiptText,
}: {
  open: boolean;
  onClose: () => void;
  onPay: (method: "cash" | "card" | "qr") => void;
  receiptText?: string;
}) {
  const firstPayRef = useRef<HTMLButtonElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  // Lock body scroll ketika modal terbuka untuk konsistensi UX
  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // Fokuskan tombol pertama agar keyboard users langsung dapat fokus
    const id = window.setTimeout(() => {
      (firstPayRef.current ?? closeRef.current)?.focus();
    }, 0);
    // Tutup dengan tombol Escape
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.clearTimeout(id);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="payment-modal-title">
      <div className="neo-card p-4 w-full max-w-md">
        <h3 id="payment-modal-title" className="text-lg font-semibold mb-3">Metode Pembayaran & Preview Nota</h3>

        {/* Preview nota 58mm */}
        {receiptText && (
          <div className="mb-3">
            <div className="text-xs text-slate-500 mb-1">Preview Nota (58mm)</div>
            <pre className="whitespace-pre-wrap text-xs bg-slate-50 p-3 rounded border max-h-[35vh] overflow-auto">
              {receiptText}
            </pre>
          </div>
        )}

        <div className="grid grid-cols-3 gap-2 mb-4">
          <button
            ref={firstPayRef}
            className="neo-button secondary small"
            onClick={() => onPay("cash")}
          >Tunai</button>
          <button
            className="neo-button secondary small"
            onClick={() => onPay("qr")}
          >QR</button>
          <button
            className="neo-button secondary small"
            onClick={() => onPay("card")}
          >Kartu</button>
        </div>
        <div className="flex justify-between">
          <button ref={closeRef} className="neo-button ghost" onClick={onClose}>Tutup</button>
        </div>
      </div>
    </div>
  );
}