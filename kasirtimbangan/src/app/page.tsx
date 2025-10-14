"use client";
import { useEffect, useState, useRef } from "react";
import { useInvoiceStore } from "@/store/invoiceStore";
import type { InvoiceItem } from "@/store/invoiceStore";
import CameraCapture from "@/components/CameraCapture";
import PaymentModal from "@/components/PaymentModal";
import { usePriceStore } from "@/store/priceStore";
import ServiceWorkerRegister from "@/components/ServiceWorkerRegister";
import { useFlashStore } from "@/store/flashStore";
import { useRouter } from "next/navigation";
import { connectAndPrint } from "@/utils/bluetoothPrint";
import { connectAndPrintTextAndQR } from "@/utils/bluetoothPrint";
import QRCode from "qrcode";
import { cacheSet, cacheUpdatePayment } from "@/utils/invoiceCache";

// Helper: format sesuai model timbangan tanpa leading zero di depan
const formatWeightScale = (kg: number) => {
  if (!Number.isFinite(kg)) return "-";
  const fixed = kg.toFixed(3); // 3 digit desimal
  const [intPart, decPart] = fixed.split(".");
  return `${intPart}.${decPart}`;
};

// Formatter nota 58mm (hitam/putih, teks saja)
const RECEIPT_WIDTH = 32;
function padRight(str: string, len: number) {
  if (str.length >= len) return str.slice(0, len);
  return str + " ".repeat(len - str.length);
}
function padLeft(str: string, len: number) {
  if (str.length >= len) return str.slice(0, len);
  return " ".repeat(len - str.length) + str;
}
function center(str: string, width = RECEIPT_WIDTH) {
  const s = str.slice(0, width);
  const space = Math.max(0, Math.floor((width - s.length) / 2));
  return " ".repeat(space) + s;
}
function sep(width = RECEIPT_WIDTH) { return "-".repeat(width); }
function formatCurrencyIDR(n: number) { return `Rp ${Number(n || 0).toLocaleString("id-ID")}`; }
function formatWeight3(n: number) { return Number(n || 0).toLocaleString("id-ID", { minimumFractionDigits: 3 }); }
// Helper aman untuk pesan error
const getErrorMessage = (e: unknown): string => {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  try { return JSON.stringify(e); } catch { return String(e); }
};
// Tipe untuk data nota (dari endpoint detail invoices)
interface InvoiceHeader { id: string; created_at: string; payment_method: string | null; notes?: string | null }
interface InvoiceItemRow { id: string; fruit: string; weight_kg: number; price_per_kg: number; total_price: number; }
function buildReceipt58(data: { invoice: InvoiceHeader; items: InvoiceItemRow[] } | null, settings: { name: string; address: string; phone: string; receiptFooter: string } | null) {
  if (!data) return "Nota kosong";
  const name = settings?.name || "Kasir Timbangan";
  const address = settings?.address || "";
  const phone = settings?.phone || "";
  const invId = String(data.invoice.id);
  const tanggal = new Date(data.invoice.created_at).toLocaleString("id-ID");
  const metode = data.invoice.payment_method ?? "-";

  const lines: string[] = [];
  lines.push(center(name));
  if (address) lines.push(center(address));
  if (phone) lines.push(center(`Telp: ${phone}`));
  lines.push(sep());
  lines.push(padRight(`ID: ${invId}`, RECEIPT_WIDTH));
  lines.push(padRight(`Tanggal: ${tanggal}`, RECEIPT_WIDTH));
  lines.push(padRight(`Metode: ${metode}`, RECEIPT_WIDTH));
  if (data.invoice.notes && (data.invoice.payment_method === "tester" || data.invoice.payment_method === "gift")) {
    lines.push(padRight(`Catatan: ${data.invoice.notes}`, RECEIPT_WIDTH));
  }
  lines.push(sep());
  // Items
  for (const it of (data.items || [])) {
    const fruit = String(it.fruit);
    const totalStr = formatCurrencyIDR(Number(it.total_price));
    const left = fruit.length > 18 ? fruit.slice(0, 18) : fruit;
    const line1 = (() => {
      const l = left;
      const r = totalStr;
      const spaces = Math.max(0, RECEIPT_WIDTH - l.length - r.length);
      return l + " ".repeat(spaces) + r;
    })();
    const weightStr = `${formatWeight3(Number(it.weight_kg))} kg`;
    const priceStr = `${formatCurrencyIDR(Number(it.price_per_kg))}/kg`;
    const line2 = padRight(`  ${weightStr} x ${priceStr}`, RECEIPT_WIDTH);
    lines.push(line1);
    lines.push(line2);
  }
  lines.push(sep());
  const totalVal = (data.items || []).reduce((acc: number, it: InvoiceItemRow) => acc + Number(it.total_price || 0), 0);
  const totalLine = (() => {
    const label = "TOTAL";
    const value = formatCurrencyIDR(totalVal);
    const spaces = Math.max(0, RECEIPT_WIDTH - label.length - value.length);
    return label + " ".repeat(spaces) + value;
  })();
  lines.push(totalLine);
  lines.push(sep());
  const footer = settings?.receiptFooter || "Terima kasih!";
  const footerLines = footer.split(/\r?\n/);
  for (const fl of footerLines) lines.push(center(fl));
  lines.push("");
  // Tambahkan qrSection setelah footer agar pelanggan mudah memindai UUID nota

  lines.push("");
  return lines.join("\n");
}

export default function Home() {
  const {
    items,
    newInvoice,
    addItem,
    submitInvoice,
    setPaymentMethod,
    removeItem,
  } = useInvoiceStore();

  const { prices } = usePriceStore();

  // Pastikan dropdown buah dan harga selalu berdasarkan DB
  useEffect(() => {
    const loadFromDB = async () => {
      try {
        const res = await fetch("/api/prices");
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "Gagal memuat harga dari DB");
        usePriceStore.getState().setAll(data.prices || {});
        // Jika buah yang dipilih tidak ada, set ke buah pertama dari DB
        const keys = Object.keys(usePriceStore.getState().prices);
        if (!keys.includes(fruit)) {
          setFruit(keys[0] || "");
        }
      } catch (e: unknown) {
        console.warn(getErrorMessage(e));
      }
    };
    loadFromDB();
  }, []);
  
  // Ketika harga di store berubah, pastikan buah yang dipilih valid
  useEffect(() => {
    const keys = Object.keys(prices);
    if (!keys.includes(fruit)) {
      setFruit(keys[0] || "");
    }
  }, [prices]);
  const [fruit, setFruit] = useState<string>(Object.keys(prices)[0] ?? "apple");
  const [capturedDataUrl, setCapturedDataUrl] = useState<string | null>(null);
  const [capturedFullDataUrl, setCapturedFullDataUrl] = useState<string | null>(null);
  const [imageModalUrl, setImageModalUrl] = useState<string | null>(null);
  const [weightKg, setWeightKg] = useState<number | null>(null);
  const [weightText, setWeightText] = useState<string | null>(null);
  const [showCamera, setShowCamera] = useState(false);
  const [showPayment, setShowPayment] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [previewText, setPreviewText] = useState("");
  const [previewQrUrl, setPreviewQrUrl] = useState<string | null>(null);
  const [lastInvoiceId, setLastInvoiceId] = useState<string>("");
  // Cache settings agar tidak perlu fetch saat submit/cetak
  const [settingsCache, setSettingsCache] = useState<{ name: string; address: string; phone: string; receiptFooter: string } | null>(null);
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const res = await fetch("/api/settings");
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || "Gagal memuat pengaturan usaha");
        setSettingsCache(json.settings || null);
      } catch (e: unknown) {
        console.warn(getErrorMessage(e));
      }
    };
    loadSettings();
  }, []);

  // Generate QR untuk UUID ketika modal preview aktif
  useEffect(() => {
    if (showPreview && lastInvoiceId) {
      QRCode.toDataURL(lastInvoiceId, { width: 192, margin: 0 })
        .then((url) => setPreviewQrUrl(url))
        .catch(() => setPreviewQrUrl(null));
    } else {
      setPreviewQrUrl(null);
    }
  }, [showPreview, lastInvoiceId]);
  const [showPriceMenu, setShowPriceMenu] = useState(false);
  const [priceMenuItems, setPriceMenuItems] = useState<Array<{ fruit: string; price: number }>>([]);
  const [priceMenuOriginalKeys, setPriceMenuOriginalKeys] = useState<string[]>([]);
  const [loadingPrices, setLoadingPrices] = useState(false);
  const [savingPrices, setSavingPrices] = useState(false);
  const [newFruit, setNewFruit] = useState("");
  const [newPrice, setNewPrice] = useState<string>("");
  const [showMainMenu, setShowMainMenu] = useState(false);
  const [installing, setInstalling] = useState(false);
  const router = useRouter();
  const imageCloseRef = useRef<HTMLButtonElement | null>(null);
  const cameraCloseRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!imageModalUrl) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setImageModalUrl(null);
      }
    };
    document.addEventListener("keydown", onKey);
    imageCloseRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
    };
  }, [imageModalUrl]);

  useEffect(() => {
    if (!showCamera) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setShowCamera(false);
      }
    };
    document.addEventListener("keydown", onKey);
    cameraCloseRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
    };
  }, [showCamera]);


  // OCR baru: panggil endpoint GPT untuk OCR
  const runOcr = async (imageDataUrl: string): Promise<void> => {
    try {
      const res = await fetch("/api/ocr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageDataUrl }),
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(errText || `OCR gagal dengan status ${res.status}`);
      }
      const data = await res.json();
      const normalized: string = data?.normalized ?? "";
      setWeightText(normalized || "");
      const parsed = parseFloat((normalized || "").replace(/[^0-9.]/g, ""));
      if (!isNaN(parsed)) setWeightKg(parsed);
    } catch (e: unknown) {
      console.error("OCR error", getErrorMessage(e));
      setWeightText("-");
    }
  };

  useEffect(() => {
    const onFull = (e: Event) => {
      const ce = e as CustomEvent<{ fullDataUrl: string }>;
      if (ce?.detail?.fullDataUrl) {
        setCapturedFullDataUrl(ce.detail.fullDataUrl);
      }
    };
    window.addEventListener("camera-captured-full", onFull as EventListener);
    return () => {
      window.removeEventListener("camera-captured-full", onFull as EventListener);
    };
  }, []);
  const handleCapture = async (_imageData: ImageData, dataUrl: string) => {
    setCapturedDataUrl(dataUrl);
    await runOcr(dataUrl);
    setShowCamera(false);
  };

  const handleAddItem = () => {
    if (!fruit) { useFlashStore.getState().show("warning", "Pilih jenis buah"); return; }
    let w = weightKg ?? 0;
    if (!w || w <= 0) {
      const input = prompt("Masukkan berat (kg):", "0.500");
      if (!input) return;
      const val = parseFloat(input);
      if (isNaN(val) || val <= 0) { useFlashStore.getState().show("warning", "Berat tidak valid"); return; }
      w = val;
      setWeightKg(val);
      setWeightText(input);
    }
    const pricePerKg = prices[fruit] ?? 0;
    const total = Math.round(pricePerKg * w * 100) / 100;
    // Simpan imageDataUrl per item jika ada
    const item: InvoiceItem = {
      fruit,
      weightKg: w,
      pricePerKg,
      totalPrice: total,
      imageDataUrl: capturedDataUrl ?? undefined,
      fullImageDataUrl: capturedFullDataUrl ?? undefined,
    };
    addItem(item);
    setCapturedDataUrl(null);
    setCapturedFullDataUrl(null);
    setWeightKg(null);
    setWeightText(null);
  };

  const handleSubmit = async () => {
    try {
      // Kurangi ukuran payload: kirim tanpa fullImageDataUrl dan batasi imageDataUrl bila terlalu besar
      const sanitizedItems = items.map((it: InvoiceItem) => ({
        fruit: it.fruit,
        weightKg: it.weightKg,
        pricePerKg: it.pricePerKg,
        totalPrice: it.totalPrice,
        imageDataUrl:
          typeof it.imageDataUrl === "string" && it.imageDataUrl.length <= 500_000
            ? it.imageDataUrl
            : undefined,
      }));

      const res = await fetch("/api/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: sanitizedItems }),
        cache: "no-store",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Gagal menyimpan nota");
      const invId: string = String(json?.invoice?.id || "");
      setLastInvoiceId(invId);

      // Cache lokal detail invoice untuk akses cepat selama 24 jam
      try {
        cacheSet(invId, {
          invoice: { id: invId, created_at: new Date().toISOString(), payment_method: null },
          items: items.map((it: InvoiceItem) => ({
            id: "",
            fruit: it.fruit,
            weight_kg: it.weightKg,
            price_per_kg: it.pricePerKg,
            total_price: it.totalPrice,
            image_data_url: it.imageDataUrl ?? null,
            full_image_data_url: it.fullImageDataUrl ?? null,
          })),
        });
      } catch {}

      // Bangun preview teks dari items lokal dan cache settings (tanpa fetch tambahan)
      const localData = {
        invoice: { id: invId, created_at: new Date().toISOString(), payment_method: null },
        items: items.map((it: InvoiceItem) => ({
          id: "",
          fruit: it.fruit,
          weight_kg: it.weightKg,
          price_per_kg: it.pricePerKg,
          total_price: it.totalPrice,
        })),
      };
      const text = buildReceipt58(localData, settingsCache);
      setPreviewText(text);
      // Tampilkan Preview Nota dulu, termasuk QR UUID, sebelum menuju pembayaran
      setShowPreview(true);
      // Jangan langsung buka pembayaran agar tidak menghambat alur
    } catch (e: unknown) {
      useFlashStore.getState().show("error", getErrorMessage(e));
    }
  };

  return (
    <div className="p-4 space-y-4">
      <ServiceWorkerRegister />

      <div className="neo-card p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Kasir Timbangan</h2>
          <button
            className="neo-button primary"
            onClick={handleSubmit}
            disabled={items.length === 0}
          >
            Simpan & Bayar
          </button>
        </div>

        {/* Input Item: pilih buah, lihat berat OCR, buka kamera, tambah item */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
          <div>
            <label className="text-sm">Jenis Buah</label>
            <select
              className="neo-input w-full"
              value={fruit}
              onChange={(e) => setFruit(e.target.value)}
            >
              {Object.keys(prices).map((k) => (
                <option key={k} value={k}>{k}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-sm">Berat (kg) - Hasil OCR</label>
            <div className="text-base font-mono mt-1">
              {weightKg ? formatWeightScale(weightKg) : "-"}
            </div>
            <label className="text-sm mt-3 block">Koreksi Manual (kg)</label>
            <input
              type="text"
              className="neo-input w-full font-mono"
              placeholder="0.500"
              value={weightText ?? ""}
              onChange={(e) => {
                const val = e.target.value;
                setWeightText(val);
                const parsed = parseFloat(val.replace(/[^0-9.]/g, ""));
                if (!isNaN(parsed)) setWeightKg(parsed);
              }}
            />
            <p className="text-xs text-slate-500 mt-1">Masukkan desimal dengan titik, contoh: 0.750</p>
          </div>
        </div>
        <div className="flex gap-2 mb-4">
          <button className="neo-button secondary" onClick={() => setShowCamera(true)}>Buka Kamera</button>
          <button className="neo-button" onClick={handleAddItem} disabled={!fruit}>Tambah Item</button>
        </div>

        {/* Verifikasi Foto: tampilkan hasil crop dan foto lengkap */}
        {(capturedDataUrl || capturedFullDataUrl) && (
          <div className="mb-4">
            <h4 className="text-sm font-semibold">Verifikasi Foto</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
              {capturedDataUrl && (
                <div className="neo-card p-3">
                  <div className="text-xs text-slate-600 mb-2">Hasil Crop (untuk OCR)</div>
                  <div className="w-full max-w-[360px] mx-auto">
                    <div className="aspect-video overflow-hidden rounded border">
                      <img
                        src={capturedDataUrl ?? undefined}
                        alt="crop"
                        className="w-full h-full object-contain cursor-zoom-in"
                        onClick={() => setImageModalUrl(capturedDataUrl ?? null)}
                      />
                    </div>
                  </div>
                </div>
              )}
              {capturedFullDataUrl && (
                <div className="neo-card p-3">
                  <div className="text-xs text-slate-600 mb-2">Foto Lengkap</div>
                  <div className="w-full max-w-[360px] mx-auto">
                    <div className="aspect-video overflow-hidden rounded border">
                      <img
                        src={capturedFullDataUrl ?? undefined}
                        alt="full"
                        className="w-full h-full object-contain cursor-zoom-in"
                        onClick={() => setImageModalUrl(capturedFullDataUrl ?? null)}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
            <div className="mt-2">
              <button
                className="neo-button ghost small"
                onClick={() => { setCapturedDataUrl(null); setCapturedFullDataUrl(null); }}
              >
                Reset Foto
              </button>
            </div>
          </div>
        )}
        <div className="space-y-2">
          {items.length === 0 ? (
            <div className="text-sm text-slate-600">Belum ada item. Tambahkan item terlebih dahulu.</div>
          ) : (
            <ul className="text-sm">
              {items.map((it: InvoiceItem, idx: number) => (
                <li key={idx} className="neo-card p-3 mb-2 relative">
                  <div className="flex items-start justify-between mb-2">
                    <h3 className="font-semibold truncate pr-4">{String(it.fruit)}</h3>
                    <button
                      className="neo-button danger small"
                      title="Hapus item"
                      onClick={() => removeItem(idx)}
                    >
                      Hapus
                    </button>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-3">
                      {it.fullImageDataUrl && (
                        <div className="w-28 h-20 md:w-32 md:h-24 neo-card overflow-hidden flex items-center justify-center shrink-0">
                          <img
                            src={it.fullImageDataUrl}
                            alt="foto utuh"
                            className="w-full h-full object-cover"
                          />
                        </div>
                      )}
                      {it.imageDataUrl && (
                        <div className="w-28 h-20 md:w-32 md:h-24 neo-card overflow-hidden flex items-center justify-center shrink-0">
                          <img
                            src={it.imageDataUrl}
                            alt="crop detail"
                            className="w-full h-full object-cover"
                          />
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 items-end">
                    <div className="text-xs text-slate-600">
                      Berat (kg): <span className="font-medium">{Number(it.weightKg || 0).toFixed(3)}</span>
                      <br />
                      Harga/kg: <span className="font-medium">Rp {Number(it.pricePerKg || 0).toLocaleString("id-ID")},-</span>
                    </div>
                    <div className="text-right">
                      <div className="text-s md:text-1xl font-bold">
                        Rp {Number(it.totalPrice || 0).toLocaleString("id-ID")},-
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {showPayment && (
        <PaymentModal
          open={showPayment}
          onClose={() => setShowPayment(false)}
          onPay={async (m, notes) => {
            try {
              setPaymentMethod(m);
              const id = lastInvoiceId;
              if (!id) throw new Error("ID nota tidak tersedia");
              // Update metode pembayaran di DB (tanpa menunggu fetch detail untuk mempercepat)
              const patchRes = await fetch(`/api/invoices/${id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ payment_method: m, notes: notes ?? undefined }),
              });
              const patchJson = await patchRes.json();
              if (!patchRes.ok) throw new Error(patchJson?.error || "Gagal mengubah metode pembayaran");

              // Update cache lokal status pembayaran
              try { cacheUpdatePayment(id, m, notes ?? null); } catch {}

              // Bangun teks nota dari data lokal dan cache settings (tanpa fetch tambahan)
              const localData2 = {
                invoice: { id, created_at: new Date().toISOString(), payment_method: m, notes: notes ?? null },
                items: items.map((it: InvoiceItem) => ({
                  id: "",
                  fruit: it.fruit,
                  weight_kg: it.weightKg,
                  price_per_kg: it.pricePerKg,
                  total_price: it.totalPrice,
                })),
              };

              // Khusus metode tester/hadiah: jangan cetak sama sekali
              if (m === "tester" || m === "gift") {
                setShowPayment(false);
                useFlashStore.getState().show("info", "Status pembayaran diperbarui tanpa cetak");
                newInvoice();
              } else {
                const text2 = buildReceipt58(localData2, settingsCache);
                // Cetak teks nota lalu QR UUID agar jelas dan mudah dipindai
                await connectAndPrintTextAndQR(text2, id);
                useFlashStore.getState().show("success", "Cetak dikirim ke printer");
                setShowPayment(false);
                newInvoice();
              }
            } catch (e: unknown) {
              useFlashStore.getState().show("error", getErrorMessage(e));
            }
          }}
          receiptText={previewText}
        />
      )}

      {/* Overlay Kamera: menjaga halaman kasir tetap terlihat di belakang */}
      {showCamera && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50 overflow-y-auto" onClick={() => setShowCamera(false)}>
          <div className="neo-card w-full max-w-2xl p-0 max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-3 border-b shrink-0">
              <h3 className="text-lg font-semibold">Ambil Foto Timbangan</h3>
              <button ref={cameraCloseRef} className="neo-button ghost small" onClick={() => setShowCamera(false)}>Tutup</button>
            </div>
            <div className="p-3 overflow-y-auto">
              <CameraCapture onCaptured={handleCapture} onClose={() => setShowCamera(false)} />
            </div>
          </div>
        </div>
      )}

      {/* Modal Preview Nota */}
      {showPreview && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 overflow-y-auto">
          <div className="neo-card w-full max-w-lg p-4 max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-3">Preview Nota</h3>
            <pre className="whitespace-pre-wrap text-sm bg-slate-50 p-3 rounded border max-h-[50vh] overflow-auto">{previewText}</pre>
            <div className="mt-4 flex gap-2 shrink-0">
              <button className="flex-1 neo-button ghost" onClick={() => setShowPreview(false)}>Tutup</button>
              <button className="flex-1 neo-button secondary" onClick={() => { setShowPreview(false); setShowPayment(true); }}>Lanjut ke Pembayaran</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// onClick={() => { setShowMainMenu(false); setShowPriceMenu(true); }}
// disabled={installing}
// onClick={async () => {
//   setInstalling(true);
//   try {
//     const res = await fetch("/api/db/install", { method: "POST" });
//     const data = await res.json();
//     if (!res.ok) throw new Error(data?.error || "Gagal install DB");
//     alert("DB terpasang atau diperbarui.");
//   } catch (e: any) {
//     alert(e?.message || String(e));
//   } finally {
//     setInstalling(false);
//     // setShowMainMenu(false);
//   }
// }}
// onClick={() => { router.push("/invoices"); setShowMainMenu(false); }}
// onClick={() => setShowMainMenu(false)}
// onClick={savePricesToDB}
// onClick={() => setShowMainMenu(false)}

// Generate QR untuk UUID ketika modal preview aktif
// .then((url) => setPreviewQrUrl(url))
// .catch(() => setPreviewQrUrl(null));
// }, [showPreview, lastInvoiceId]);
