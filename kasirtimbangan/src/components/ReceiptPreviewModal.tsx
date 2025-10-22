"use client";
import { useEffect, useRef } from "react";

export default function ReceiptPreviewModal({
  open,
  onClose,
  receiptText,
  qrDataUrl,
  onPrint,
}: {
  open: boolean;
  onClose: () => void;
  receiptText: string;
  qrDataUrl?: string | null;
  onPrint: () => Promise<void> | void;
}) {
  const firstBtnRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (open) {
      setTimeout(() => { firstBtnRef.current?.focus(); }, 0);
    }
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="receipt-preview-title" onClick={onClose}>
      <div className="neo-card p-4 w-full max-w-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-3">
          <h3 id="receipt-preview-title" className="text-lg font-semibold">Preview Nota & Cetak</h3>
          <button className="neo-button ghost small" onClick={onClose}>Tutup</button>
        </div>
        <div className="mb-3">
          <div className="text-xs text-slate-500 mb-1">Output 58mm (sama dengan hasil cetak)</div>
          <pre className="font-mono whitespace-pre text-xs bg-slate-50 p-3 rounded border max-h-[40vh] overflow-auto">{receiptText}</pre>
        </div>
        {qrDataUrl ? (
          <div className="mt-2 flex justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qrDataUrl} alt="QR UUID Nota" className="w-32 h-32" />
          </div>
        ) : null}
        <div className="mt-4 flex justify-end gap-2">
          <button ref={firstBtnRef} className="neo-button primary small" onClick={() => onPrint()}>Cetak</button>
          <button className="neo-button ghost small" onClick={onClose}>Tutup</button>
        </div>
      </div>
    </div>
  );
}