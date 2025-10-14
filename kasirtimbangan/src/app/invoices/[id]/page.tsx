"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import PaymentModal from "@/components/PaymentModal";
import QRCode from "qrcode";
import { cacheGet } from "@/utils/invoiceCache";
import { useFlashStore } from "@/store/flashStore";

// Tambahkan helper untuk konsistensi error handling
const getErrorMessage = (e: unknown): string => {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  try { return JSON.stringify(e); } catch { return String(e); }
};

// Tipe eksplisit untuk data detail invoice termasuk gambar
interface InvoiceHeader { id: string; created_at: string; payment_method: string | null; notes?: string | null; }
interface InvoiceItemRow {
  id: string;
  fruit: string;
  weight_kg: number;
  price_per_kg: number;
  total_price: number;
  image_data_url: string | null; // crop/thumbnail
  full_image_data_url: string | null; // full image
}
interface InvoiceDetail { invoice: InvoiceHeader; items: InvoiceItemRow[]; }

export default function InvoiceDetailPage() {
  const params = useParams();
  const id = String(params?.id || "");
  const search = useSearchParams();
  const printMode = search.get("print") === "1";
  const [data, setData] = useState<InvoiceDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [openPay, setOpenPay] = useState(false);
  const [settings, setSettings] = useState<{ name: string; address: string; phone: string; receiptFooter: string } | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [imageModal, setImageModal] = useState<{ url: string; title: string } | null>(null);

  // Coba hydrate dari cache terlebih dahulu (24 jam)
  useEffect(() => {
    if (!id) return;
    const cached = cacheGet(id);
    if (cached) {
      setData({ invoice: cached.invoice, items: cached.items as any });
    }
  }, [id]);

  // Tutup modal gambar dengan tombol ESC
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setImageModal(null); };
    if (imageModal) {
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
    }
  }, [imageModal]);

  const fetchDetail = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/invoices/${id}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Gagal memuat detail nota");
      setData({ invoice: json.invoice as InvoiceHeader, items: (json.items as InvoiceItemRow[]) || [] });
    } catch (e: unknown) {
      useFlashStore.getState().show("error", getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [id]);

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/settings");
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Gagal memuat pengaturan usaha");
      setSettings(json.settings || null);
    } catch (e: unknown) {
      console.warn(getErrorMessage(e));
    }
  }, []);

  useEffect(() => { fetchDetail(); }, [fetchDetail]);
  useEffect(() => { fetchSettings(); }, [fetchSettings]);

  useEffect(() => {
    // Generate QR untuk UUID nota ketika data sudah tersedia
    if (data?.invoice?.id) {
      QRCode.toDataURL(data.invoice.id, { width: 256, margin: 0 })
        .then((url) => setQrDataUrl(url))
        .catch(() => setQrDataUrl(null));
    } else {
      setQrDataUrl(null);
    }
  }, [data?.invoice?.id]);

  const receiptText = useMemo(() => {
    if (!data) return "";
    const name = settings?.name || "Kasir Timbangan";
    const address = settings?.address || "";
    const phone = settings?.phone || "";
    const receiptFooter = settings?.receiptFooter || "Terima kasih!";
    const businessHeader = `${name}\n${address ? address + "\n" : ""}${phone ? "Telp: " + phone + "\n" : ""}`;
    const header = `${businessHeader}Nota Kasir\nID: ${data.invoice.id}\nTanggal: ${new Date(data.invoice.created_at).toLocaleString("id-ID")}\nMetode: ${data.invoice.payment_method ?? "-"}\n`;
    const lines = data.items.map((it) => {
      const w = Number(it.weight_kg).toFixed(3);
      const p = Number(it.price_per_kg).toLocaleString("id-ID");
      const t = Number(it.total_price).toLocaleString("id-ID");
      return `${it.fruit.padEnd(10)} ${w} kg x Rp ${p} = Rp ${t}`;
    }).join("\n");
    const total = data.items.reduce((acc, it) => acc + Number(it.total_price || 0), 0);
    const footer = `\nTotal: Rp ${total.toLocaleString("id-ID")}\n${receiptFooter}`;
    // Integrate QR into receipt text: show data URL string after footer
    const qrSection = qrDataUrl ? `\nQR Code:\n ${qrDataUrl} ` : "";
    return header + "\n" + lines + "\n" + footer + qrSection;
  }, [data, settings, qrDataUrl]);

  return (
    <div className="p-4 space-y-4">
      <div className="neo-card p-3">
        <div className="flex justify-between items-center">
          <h2 className="text-lg font-semibold">Detail Nota</h2>
          <div className="flex gap-2">
            <button className="neo-button small" onClick={() => setOpenPay(true)}>Pembayaran</button>
          </div>
        </div>
        {loading ? (
          <div className="mt-3">Memuat...</div>
        ) : data ? (
          <div className="mt-3 space-y-2">
            <div className="text-sm">
              <div><span className="font-mono text-xs">ID:</span> {data.invoice.id}</div>
              <div>Tanggal: <span suppressHydrationWarning>{new Date(data.invoice.created_at).toLocaleString("id-ID")}</span></div>
              <div>Metode: {data.invoice.payment_method ?? "-"}</div>
              {data.invoice.notes ? (<div>Catatan: {data.invoice.notes}</div>) : null}
              <div>
                Status: {" "}
                {(() => {
                  const pm = data.invoice.payment_method;
                  const isGift = pm === "gift" || pm === "tester";
                  const cls = isGift ? "gift" : pm ? "success" : "pending";
                  const label = isGift ? "gift" : pm ? "dibayar" : "pending";
                  return <span className={`neo-badge ${cls}`}>{label}</span>;
                })()}
              </div>
            </div>
            <div className="overflow-x-auto overflow-y-visible relative hscroll-touch">
              <table className="min-w-[720px] md:min-w-0 md:w-full text-sm neo-table">
                <thead>
                  <tr className="text-left">
                    <th className="px-3 py-2">Buah</th>
                    <th className="px-3 py-2">Berat (kg)</th>
                    <th className="px-3 py-2">Harga/kg</th>
                    <th className="px-3 py-2">Total</th>
                    <th className="px-3 py-2">Foto Crop</th>
                    <th className="px-3 py-2">Foto Full</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.length === 0 ? (
                    <tr><td className="px-3 py-2" colSpan={6}>Tidak ada item</td></tr>
                  ) : data.items.map((it) => (
                    <tr key={it.id} className="border-t">
                      <td className="px-3 py-2">{it.fruit}</td>
                      <td className="px-3 py-2"><span suppressHydrationWarning>{Number(it.weight_kg).toLocaleString("id-ID", { minimumFractionDigits: 3 })}</span></td>
                      <td className="px-3 py-2">Rp <span suppressHydrationWarning>{Number(it.price_per_kg).toLocaleString("id-ID")}</span></td>
                      <td className="px-3 py-2 font-bold">Rp <span suppressHydrationWarning>{Number(it.total_price).toLocaleString("id-ID")}</span></td>
                      <td className="px-3 py-2">
                        {it.image_data_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={it.image_data_url}
                            alt={`Foto Crop - ${it.fruit}`}
                            className="w-16 h-16 object-cover rounded cursor-zoom-in border"
                            onClick={() => setImageModal({ url: it.image_data_url as string, title: `Foto Crop - ${it.fruit}` })}
                          />
                        ) : (
                          <span className="text-slate-400">-</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {it.full_image_data_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={it.full_image_data_url}
                            alt={`Foto Full - ${it.fruit}`}
                            className="w-16 h-16 object-contain rounded cursor-zoom-in border"
                            onClick={() => setImageModal({ url: it.full_image_data_url as string, title: `Foto Full - ${it.fruit}` })}
                          />
                        ) : (
                          <span className="text-slate-400">-</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="mt-3">Data tidak tersedia</div>
        )}
      </div>

      {!printMode && (
        <PaymentModal
          open={openPay}
          onClose={() => setOpenPay(false)}
          onPay={async (m, notes) => {
            try {
              const res = await fetch(`/api/invoices/${id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ payment_method: m, notes: notes ?? undefined }),
              });
              const json = await res.json();
              if (!res.ok) throw new Error(json?.error || "Gagal memperbarui pembayaran");
              setData((prev) => prev ? { invoice: { ...prev.invoice, payment_method: m, notes: notes ?? prev.invoice.notes ?? null }, items: prev.items } : prev);
              setOpenPay(false);
              useFlashStore.getState().show("success", "Status pembayaran diperbarui");
            } catch (e: unknown) {
              useFlashStore.getState().show("error", getErrorMessage(e));
            }
          }}
          receiptText={receiptText}
        />
      )}

      {printMode && data && (
        <div className="neo-card p-4">
          <div className="text-center text-sm">
            <div className="font-semibold">Terima kasih!</div>
            <div>Harap simpan nota ini.</div>
          </div>
          <div className="mt-3 flex justify-center">
            {qrDataUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qrDataUrl} alt="QR UUID Nota" className="w-32 h-32" />
            )}
          </div>
        </div>
      )}

      {imageModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setImageModal(null)}>
          <div className="neo-card p-3 max-w-[95vw] max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-2">
              <div className="font-medium text-sm">{imageModal.title}</div>
              <button className="neo-button ghost small" onClick={() => setImageModal(null)}>Tutup</button>
            </div>
            <div className="flex items-center justify-center p-1">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={imageModal.url} alt={imageModal.title} className="max-w-[90vw] max-h-[80vh] object-contain" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}