"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { createPortal } from "react-dom";
import PaymentModal from "@/components/PaymentModal";
import { cacheGet, cacheUpdatePayment } from "@/utils/invoiceCache";

// Tipe eksplisit untuk data invoice
interface InvoiceListRow {
  id: string;
  created_at: string; // ISO string dari server
  payment_method: string | null;
  items_count: number;
  grand_total: number;
}

interface InvoiceHeader {
  id: string;
  created_at: string;
  payment_method: string | null;
}

interface InvoiceItemRow {
  id: string;
  fruit: string;
  weight_kg: number;
  price_per_kg: number;
  total_price: number;
}

interface InvoiceDetail {
  invoice: InvoiceHeader;
  items: InvoiceItemRow[];
}

const getErrorMessage = (e: unknown): string => {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  try { return JSON.stringify(e); } catch { return String(e); }
};

export default function InvoicesPage() {
  const [rows, setRows] = useState<InvoiceListRow[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [q, setQ] = useState<string>("");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detailData, setDetailData] = useState<InvoiceDetail | null>(null);
  const closeDetailBtnRef = useRef<HTMLButtonElement | null>(null);
  const [payModalOpen, setPayModalOpen] = useState(false);
  const [payModalInvoiceId, setPayModalInvoiceId] = useState<string | null>(null);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("pageSize", String(pageSize));
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    if (q) params.set("q", q);
    return params.toString();
  }, [page, pageSize, dateFrom, dateTo, q]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/invoices?${queryString}`);
      const data: { data?: InvoiceListRow[]; page?: number; pageSize?: number; total?: number; totalPages?: number; error?: string } = await res.json();
      if (!res.ok) throw new Error(data?.error || "Gagal memuat daftar nota");
      setRows(data.data || []);
      setPage(data.page || 1);
      setPageSize(data.pageSize || 10);
      setTotal(data.total || 0);
      setTotalPages(data.totalPages || 1);
    } catch (e: unknown) {
      alert(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [queryString]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const exportCsv = () => {
    const headers = ["Invoice ID","Tanggal","Metode","Status","Jumlah Item","Total"];
    const rowsCsv = rows.map((r) => [
      r.id,
      new Date(r.created_at).toLocaleString("id-ID"),
      r.payment_method ?? "-",
      r.payment_method ? "dibayar" : "pending",
      String(r.items_count ?? 0),
      String(Number(r.grand_total || 0)),
    ]);
    const csv = [headers.join(","), ...rowsCsv.map((arr) => arr.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `invoices_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportExcel = async () => {
    const XLSX = await import("xlsx");
    const headers = ["Invoice ID","Tanggal","Metode","Status","Jumlah Item","Total"];
    const dataAoA = [
      headers,
      ...rows.map((r) => [
        r.id,
        new Date(r.created_at).toLocaleString("id-ID"),
        r.payment_method ?? "-",
        r.payment_method ? "dibayar" : "pending",
        Number(r.items_count ?? 0),
        Number(r.grand_total || 0),
      ]),
    ];
    const ws = XLSX.utils.aoa_to_sheet(dataAoA);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Invoices");
    XLSX.writeFile(wb, `invoices_${Date.now()}.xlsx`);
  };

  const openDetail = async (id: string) => {
    try {
      // Prefer cache jika tersedia agar modal terbuka cepat
      const cached = cacheGet(id);
      if (cached) {
        setDetailData({
          invoice: cached.invoice,
          items: (cached.items || []).map((it: any) => ({
            id: it.id,
            fruit: it.fruit,
            weight_kg: it.weight_kg,
            price_per_kg: it.price_per_kg,
            total_price: it.total_price,
          })),
        });
        setDetailId(id);
      }
      // Tetap fetch dari server untuk memastikan data terbaru
      const res = await fetch(`/api/invoices/${id}`);
      const data: (InvoiceDetail & { error?: string }) = await res.json();
      if (!res.ok) throw new Error(data?.error || "Gagal memuat detail nota");
      setDetailData(data);
      setDetailId(id);
    } catch (e: unknown) {
      alert(getErrorMessage(e));
    }
  };

  const openPayModal = (id: string) => {
    setPayModalInvoiceId(id);
    setPayModalOpen(true);
  };

  const onPayFromList = async (method: "cash" | "card" | "qr") => {
    if (!payModalInvoiceId) return;
    try {
      const res = await fetch(`/api/invoices/${payModalInvoiceId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payment_method: method }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Gagal memperbarui pembayaran");
      // Update cache lokal agar status di modal/detail cepat berubah
      try { cacheUpdatePayment(payModalInvoiceId, method); } catch {}
      setPayModalOpen(false);
      setPayModalInvoiceId(null);
      await fetchData();
      alert("Status pembayaran diperbarui");
    } catch (e: unknown) {
      alert(getErrorMessage(e));
    }
  };

  const closeDetail = () => { setDetailId(null); setDetailData(null); };

  // Accessibility: lock body scroll, allow Escape to close, and focus initial control when detail modal opens
  useEffect(() => {
    if (!detailId) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeDetail();
      }
    };
    document.addEventListener("keydown", onKey);
    const id = window.setTimeout(() => closeDetailBtnRef.current?.focus(), 0);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", onKey);
      window.clearTimeout(id);
    };
  }, [detailId]);

  const [_menuOpenId, _setMenuOpenId] = useState<string | null>(null);
  const [menuState, setMenuState] = useState<{ id: string; rect: DOMRect } | null>(null);

  useEffect(() => {
    if (!menuState) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onScroll = () => setMenuState(null);
    const onResize = () => setMenuState(null);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [menuState]);

  const deleteInvoice = async (id: string) => {
    if (!confirm("Hapus nota ini? Tindakan ini tidak dapat dibatalkan.")) return;
    try {
      const res = await fetch(`/api/invoices/${id}`, { method: "DELETE" });
      const json: { ok?: boolean; error?: string } = await res.json();
      if (!res.ok) throw new Error(json?.error || "Gagal menghapus nota");
      // refresh list
      await fetchData();
      alert("Nota berhasil dihapus");
    } catch (e: unknown) {
      alert(getErrorMessage(e));
    }
  };

  return (
    <div className="p-4 space-y-4">
      <div className="neo-card p-3">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <div>
            <label className="text-sm">Dari Tanggal</label>
            <input type="date" className="mt-1 w-full neo-input" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </div>
          <div>
            <label className="text-sm">Sampai Tanggal</label>
            <input type="date" className="mt-1 w-full neo-input" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>
          <div>
            <label className="text-sm">Cari (ID/Metode)</label>
            <input type="text" placeholder="contoh: cash atau sebagian UUID" className="mt-1 w-full neo-input" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div>
            <label className="text-sm">Ukuran Halaman</label>
            <select className="mt-1 w-full neo-input" value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>
              {[10,20,50,100].map((n) => (<option key={n} value={n}>{n}</option>))}
            </select>
          </div>
          <div className="flex items-end">
            <button
              className="w-full neo-button"
              onClick={() => fetchData()}
              disabled={loading}
            >{loading ? "Memuat..." : "Terapkan Filter"}</button>
          </div>
        </div>
        <div className="mt-3 flex gap-2">
          <button className="neo-button success" onClick={exportCsv}>Ekspor CSV</button>
          <button className="neo-button secondary" onClick={exportExcel}>Ekspor Excel</button>
        </div>
      </div>

      <div className="neo-card overflow-x-auto overflow-y-visible relative p-0 hscroll-touch">
        <table className="min-w-[720px] md:min-w-0 md:w-full text-sm neo-table">
                <thead>
                <tr className="bg-slate-100 text-left">
                  <th className="px-3 py-2 whitespace-nowrap">Invoice ID</th>
                  <th className="px-3 py-2 whitespace-nowrap">Tanggal</th>
                  <th className="px-3 py-2 whitespace-nowrap">Metode</th>
                  <th className="px-3 py-2 whitespace-nowrap">Status</th>
                  <th className="px-3 py-2 whitespace-nowrap">Jumlah Item</th>
                  <th className="px-3 py-2 whitespace-nowrap">Total</th>
                  <th className="px-3 py-2 whitespace-nowrap">Aksi</th>
                   </tr>
                </thead>
                <tbody>
                {rows.length === 0 ? (
                   <tr>
                     <td className="px-3 py-4 text-center whitespace-nowrap" colSpan={7}>Tidak ada data</td>
                   </tr>
                ) : rows.map((r) => (
                   <tr key={r.id} className="border-t hover:bg-slate-50">


                    <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{r.id}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{new Date(r.created_at).toLocaleString("id-ID")}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{r.payment_method ?? "-"}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span className={`neo-badge ${r.payment_method ? "success" : "pending"}`}>
                        {r.payment_method ? "dibayar" : "pending"}
                      </span>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{r.items_count}</td>
                    <td className="px-3 py-2 font-bold whitespace-nowrap">Rp {Number(r.grand_total || 0).toLocaleString("id-ID")}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                       <div className="relative">
                         <button
                           className="neo-button small ghost"
                           onClick={(e) => {
                             const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect();
                             setMenuState((prev) => (prev && prev.id === r.id ? null : { id: r.id, rect }));
                           }}
                         >Aksi ▾</button>
                         {/* remove inline absolute menu rendering */}
                         {false && _menuOpenId === r.id && (
                           <div className="absolute z-[9999] mt-1 right-0 min-w-[180px] bg-white border rounded shadow">
                             <button className="block w-full text-left px-3 py-2 hover:bg-slate-100" onClick={() => { /* openDetail(menuState?.id); */ if (menuState) openPayModal(menuState.id); setMenuState(null); }}>Detail (Modal)</button>
                             <Link href={`/invoices/${r.id}`} className="block px-3 py-2 hover:bg-slate-100">Halaman Detail</Link>
                             <Link href={`/invoices/${r.id}?print=1`} className="block px-3 py-2 hover:bg-slate-100">Preview/Print</Link>
                             <button className="block w-full text-left px-3 py-2 hover:bg-slate-100 text-red-600" onClick={() => deleteInvoice(r.id)}>Hapus Nota</button>
                           </div>
                         )}
                       </div>
                     </td>
                   </tr>
                 ))}
               </tbody>
             </table>
           </div>

      {/* dropdown menu moved to portal */}
      {menuState && createPortal(
        <>
          <div className="fixed inset-0 z-[9998]" onClick={() => setMenuState(null)}></div>
          <div
            className="fixed z-[9999]"
            style={{
              top: Math.min(window.innerHeight - 8 - 200, menuState.rect.bottom + 4),
              left: Math.max(8, Math.min(window.innerWidth - 8 - 220, menuState.rect.right - 220)),
            }}
          >
            <div className="neo-dropdown min-w-[220px]">
              <button className="block w-full text-left px-3 py-2 hover:bg-slate-100" onClick={() => { openDetail(menuState.id); setMenuState(null); }}>Detail (Modal)</button>
              <Link href={`/invoices/${menuState.id}`} className="block px-3 py-2 hover:bg-slate-100" onClick={() => setMenuState(null)}>Halaman Detail</Link>
              <Link href={`/invoices/${menuState.id}?print=1`} className="block px-3 py-2 hover:bg-slate-100" onClick={() => setMenuState(null)}>Preview/Print</Link>
              <button className="block w-full text-left px-3 py-2 hover:bg-slate-100 text-red-600" onClick={() => { deleteInvoice(menuState.id); setMenuState(null); }}>Hapus Nota</button>
            </div>
          </div>
        </>,
        document.body
      )}
      <div className="mt-3 flex items-center justify-between">
        <div className="text-sm text-slate-700">Total: {total} | Halaman {page} dari {totalPages}</div>
        <div className="flex items-center gap-2">
          <button
            className="neo-button ghost small"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >Prev</button>
          <button
            className="neo-button ghost small"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >Next</button>
        </div>
      </div>

      {detailId && detailData && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="invoice-detail-title" onClick={closeDetail}>
          <div className="neo-card p-4 w-full max-w-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-3">
              <h3 id="invoice-detail-title" className="text-lg font-semibold">Detail Nota</h3>
              <button ref={closeDetailBtnRef} className="neo-button ghost small" onClick={closeDetail}>Tutup</button>
            </div>
            <div className="text-sm mb-3">
              <div><span className="font-mono text-xs">ID:</span> {detailData.invoice.id}</div>
              <div>Tanggal: {new Date(detailData.invoice.created_at).toLocaleString("id-ID")}</div>
              <div>Metode: {detailData.invoice.payment_method ?? "-"}</div>
              <div>
                Status: {" "}
                <span className={`neo-badge ${detailData.invoice.payment_method ? "success" : "pending"}`}>
                  {detailData.invoice.payment_method ? "dibayar" : "pending"}
                </span>
              </div>
            </div>
            <div className="overflow-x-auto overflow-y-visible relative">
              <table className="min-w-[600px] text-sm neo-table">
                <thead>
                  <tr className="bg-slate-100 text-left">
                    <th className="px-3 py-2 whitespace-nowrap">Buah</th>
                    <th className="px-3 py-2 whitespace-nowrap">Berat (kg)</th>
                    <th className="px-3 py-2 whitespace-nowrap">Harga/kg</th>
                    <th className="px-3 py-2 whitespace-nowrap">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {detailData.items.length === 0 ? (
                    <tr><td className="px-3 py-2 whitespace-nowrap" colSpan={4}>Tidak ada item</td></tr>
                  ) : detailData.items.map((it) => (
                    <tr key={it.id} className="border-t">
                      <td className="px-3 py-2 whitespace-nowrap">{it.fruit}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{Number(it.weight_kg).toLocaleString("id-ID", { minimumFractionDigits: 3 })}</td>
                      <td className="px-3 py-2 whitespace-nowrap">Rp {Number(it.price_per_kg).toLocaleString("id-ID")}</td>
                      <td className="px-3 py-2 font-bold whitespace-nowrap">Rp {Number(it.total_price).toLocaleString("id-ID")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
      <PaymentModal
        open={payModalOpen}
        onClose={() => { setPayModalOpen(false); setPayModalInvoiceId(null); }}
        onPay={onPayFromList}
      />
    </div>
  );
}