"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useFlashStore } from "@/store/flashStore";

type InvoiceRow = {
  id: string;
  created_at: string;
  payment_method: string | null;
  grand_total: number;
  items_count: number;
};

export default function KasirInvoicesPage() {
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [totalPages, setTotalPages] = useState(1);
  const [rows, setRows] = useState<InvoiceRow[]>([]);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detail, setDetail] = useState<{
    invoice: { id: string; created_at: string; payment_method: string | null; customer_name: string | null; customer_whatsapp: string | null; notes: string | null };
    items: Array<{ id: string; fruit: string; weight_kg: number; price_per_kg: number; total_price: number; image_data_url: string | null; full_image_data_url: string | null }>;
  } | null>(null);

  // Akses hanya untuk kasir
  useEffect(() => {
    const check = async () => {
      try {
        const res = await fetch("/api/auth/me");
        const data = await res.json();
        if (!data?.user) { router.replace("/login"); return; }
        if (String(data.user.role || "") !== "kasir") {
          useFlashStore.getState().show("warning", "Akses ditolak: hanya untuk kasir");
          router.replace("/");
          return;
        }
        setAuthChecked(true);
      } catch { router.replace("/login"); }
    };
    check();
  }, [router]);

  const load = async (p: number = page, ps: number = pageSize) => {
    if (!authChecked) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(p), pageSize: String(ps), mine: "true" });
      const res = await fetch(`/api/invoices?${params.toString()}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Gagal memuat invoice");
      setRows(json.data || []);
      setTotalPages(Number(json.totalPages || 1));
      setPage(Number(json.page || p));
      setPageSize(Number(json.pageSize || ps));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      useFlashStore.getState().show("error", msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(1, pageSize); }, [authChecked]);

  const goPrev = () => { if (page > 1) load(page - 1, pageSize); };
  const goNext = () => { if (page < totalPages) load(page + 1, pageSize); };

  const openDetail = async (invoiceId: string) => {
    setDetailOpen(true);
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/invoices/${invoiceId}`);
      const json = await res.json();
      if (!res.ok || !json?.ok) throw new Error(json?.error || "Gagal memuat detail");
      setDetail({ invoice: json.invoice, items: json.items || [] });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      useFlashStore.getState().show("error", msg);
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  };
  const closeDetail = () => { setDetailOpen(false); setDetail(null); };

  if (!authChecked) return <div className="neo-card p-4">Memeriksa akses...</div>;

  return (
    <div className="space-y-6">
      <div className="neo-card p-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Invoice Saya</h2>
        <div className="flex items-center gap-2">
          <select className="neo-input" value={pageSize} onChange={(e) => { const ps = Number(e.target.value); setPageSize(ps); load(1, ps); }}>
            <option value={10}>10</option>
            <option value={20}>20</option>
            <option value={50}>50</option>
          </select>
          <button className="neo-button" onClick={() => load(page, pageSize)} disabled={loading}>{loading ? "Memuat..." : "Refresh"}</button>
        </div>
      </div>

      <div className="neo-card p-0 overflow-x-auto">
        <table className="min-w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left px-4 py-2">Nomor Invoice</th>
              <th className="text-left px-4 py-2">Tanggal</th>
              <th className="text-left px-4 py-2">Total Pembayaran</th>
            </tr>
          </thead>
          <tbody>
            {(rows || []).length === 0 ? (
              <tr><td className="px-4 py-3" colSpan={3}>Tidak ada data</td></tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="px-4 py-3 font-mono">{r.id}</td>
                  <td className="px-4 py-3">{new Date(r.created_at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })}</td>
                  <td className="px-4 py-3 font-semibold">Rp {Number(r.grand_total || 0).toLocaleString("id-ID")}</td>
                  <td className="px-4 py-3 text-right">
                    <button className="neo-button small" onClick={() => openDetail(r.id)}>Lihat Detail</button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="neo-card p-4 flex items-center justify-between">
        <div>Halaman {page} dari {totalPages}</div>
        <div className="flex gap-2">
          <button className="neo-button secondary" onClick={goPrev} disabled={page <= 1 || loading}>Sebelumnya</button>
          <button className="neo-button secondary" onClick={goNext} disabled={page >= totalPages || loading}>Berikutnya</button>
        </div>
      </div>

      {detailOpen ? (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="kasir-inv-detail-title" onClick={closeDetail}>
          <div className="neo-card p-4 w-full max-w-3xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-3">
              <h3 id="kasir-inv-detail-title" className="text-lg font-semibold">Detail Pembelian</h3>
              <button className="neo-button ghost small" onClick={closeDetail}>Tutup</button>
            </div>
            {detailLoading ? (
              <div className="p-4">Memuat detail...</div>
            ) : !detail ? (
              <div className="p-4">Tidak ada data</div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <div className="text-sm"><span className="text-slate-500">Nomor:</span> <span className="font-mono">{detail.invoice.id}</span></div>
                    <div className="text-sm"><span className="text-slate-500">Tanggal:</span> {new Date(detail.invoice.created_at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })}</div>
                    <div className="text-sm"><span className="text-slate-500">Pembayaran:</span> {detail.invoice.payment_method || "-"}</div>
                  </div>
                  <div>
                    <div className="text-sm"><span className="text-slate-500">Pelanggan:</span> {detail.invoice.customer_name || "-"}</div>
                    <div className="text-sm"><span className="text-slate-500">WhatsApp:</span> {detail.invoice.customer_whatsapp || "-"}</div>
                    {detail.invoice.notes ? (<div className="text-sm"><span className="text-slate-500">Catatan:</span> {detail.invoice.notes}</div>) : null}
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="text-left px-4 py-2">Buah</th>
                        <th className="text-right px-4 py-2">Berat (kg)</th>
                        <th className="text-right px-4 py-2">Harga/kg</th>
                        <th className="text-right px-4 py-2">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(detail.items || []).length === 0 ? (
                        <tr><td className="px-4 py-3" colSpan={4}>Tidak ada item</td></tr>
                      ) : (
                        detail.items.map((it) => (
                          <tr key={it.id} className="border-t">
                            <td className="px-4 py-3">{it.fruit}</td>
                            <td className="px-4 py-3 text-right">{Number(it.weight_kg).toLocaleString("id-ID")}</td>
                            <td className="px-4 py-3 text-right">Rp {Number(it.price_per_kg).toLocaleString("id-ID")}</td>
                            <td className="px-4 py-3 text-right font-semibold">Rp {Number(it.total_price).toLocaleString("id-ID")}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="flex justify-end">
                  <div className="neo-card p-3">
                    <div className="text-sm"><span className="text-slate-500">Jumlah Item:</span> {(detail.items || []).length}</div>
                    <div className="text-sm font-semibold"><span className="text-slate-500">Total:</span> Rp {Number((detail.items || []).reduce((acc, it) => acc + Number(it.total_price || 0), 0)).toLocaleString("id-ID")}</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}