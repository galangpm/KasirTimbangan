"use client";
import Link from "next/link";
import { useEffect, useMemo, useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { useFlashStore } from "@/store/flashStore";

type CustomerListRow = {
  uuid: string;
  name: string;
  whatsapp: string;
  address: string | null;
  tx_count: number;
  last_tx: string | null;
};

function getErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  try { return JSON.stringify(e); } catch { return String(e); }
}
function normalizeWhatsapp(inp: string): string {
  const s = inp.replace(/\s|-/g, "").trim();
  if (!s) return "";
  if (s.startsWith("+")) return s;
  if (s.startsWith("0")) return "+62" + s.slice(1);
  if (s.startsWith("62")) return "+" + s;
  return "+62" + s;
}
function isValidWhatsapp(wa: string): boolean {
  const digits = wa.replace(/[^0-9]/g, "");
  return digits.length >= 10 && digits.length <= 15;
}
function formatCurrency(n: number): string {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);
}

export default function CustomersPage() {
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);

  // Filters & pagination
  const [q, setQ] = useState("");
  const [tx, setTx] = useState<"all" | "with" | "without">("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<CustomerListRow[]>([]);

  // Export controls
  const [exportStart, setExportStart] = useState<string>("");
  const [exportEnd, setExportEnd] = useState<string>("");
  const [exportIncludeNoTx, setExportIncludeNoTx] = useState<boolean>(false);
  const handleExport = useCallback(() => {
    const params = new URLSearchParams();
    if (exportStart) params.set("start", exportStart);
    if (exportEnd) params.set("end", exportEnd);
    if (exportIncludeNoTx) params.set("includeNoTx", "1");
    const url = `/api/customers/export${params.toString() ? `?${params.toString()}` : ""}`;
    window.open(url, "_blank");
  }, [exportStart, exportEnd, exportIncludeNoTx]);

  // Create form
  const [newName, setNewName] = useState("");
  const [newWhatsapp, setNewWhatsapp] = useState("");
  const [newAddress, setNewAddress] = useState("");
  const [creating, setCreating] = useState(false);
  const [newErrors, setNewErrors] = useState<{ name?: string; whatsapp?: string; address?: string }>({});

  // Edit inline
  const [editUuid, setEditUuid] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editWhatsapp, setEditWhatsapp] = useState("");
  const [editAddress, setEditAddress] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  useEffect(() => {
    const check = async () => {
      try {
        const res = await fetch("/api/auth/me");
        const data = await res.json();
        if (!data?.user) {
          router.replace("/login");
          return;
        }
        if (data.user.role !== "superadmin") {
          useFlashStore.getState().show("warning", "Akses ditolak: hanya untuk superadmin");
          router.replace("/");
          return;
        }
        setAuthChecked(true);
      } catch {
        router.replace("/login");
      }
    };
    check();
  }, [router]);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("pageSize", String(pageSize));
    if (q) params.set("q", q);
    if (tx && tx !== "all") params.set("tx", tx);
    return params.toString();
  }, [page, pageSize, q, tx]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/customers?${queryString}`);
      const data: { ok?: boolean; data?: CustomerListRow[]; page?: number; pageSize?: number; total?: number; totalPages?: number; error?: string; warning?: string } = await res.json();
      if (!res.ok || data.ok === false) throw new Error(data?.error || "Gagal memuat daftar pelanggan");
      setRows(data.data || []);
      setPage(data.page || 1);
      setPageSize(data.pageSize || 10);
      setTotal(data.total || 0);
      setTotalPages(data.totalPages || 1);
      if (data.warning) useFlashStore.getState().show("warning", data.warning);
    } catch (e: unknown) {
      useFlashStore.getState().show("error", getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [queryString]);

  useEffect(() => { if (authChecked) fetchData(); }, [authChecked, fetchData]);

  const handleCreate = async () => {
    const errs: { name?: string; whatsapp?: string; address?: string } = {};
    const nameVal = newName.trim();
    const waNorm = normalizeWhatsapp(newWhatsapp.trim());
    if (!nameVal) errs.name = "Nama wajib diisi";
    if (!waNorm || !isValidWhatsapp(waNorm)) errs.whatsapp = "Nomor WhatsApp tidak valid";
    setNewErrors(errs);
    if (Object.keys(errs).length > 0) return;
    setCreating(true);
    try {
      const res = await fetch("/api/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: nameVal, whatsapp: waNorm, address: newAddress.trim() || null })
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) throw new Error(data?.error || "Gagal membuat pelanggan");
      useFlashStore.getState().show("success", "Pelanggan berhasil ditambahkan");
      setNewName("");
      setNewWhatsapp("");
      setNewAddress("");
      setNewErrors({});
      setPage(1);
      fetchData();
    } catch (e: unknown) {
      useFlashStore.getState().show("error", getErrorMessage(e));
    } finally {
      setCreating(false);
    }
  };

  const startEdit = (r: CustomerListRow) => {
    setEditUuid(r.uuid);
    setEditName(r.name);
    setEditWhatsapp(r.whatsapp);
    setEditAddress(r.address || "");
  };
  const cancelEdit = () => {
    setEditUuid(null);
    setEditName("");
    setEditWhatsapp("");
    setEditAddress("");
  };
  const saveEdit = async () => {
    if (!editUuid) return;
    const nameVal = editName.trim();
    const waNorm = normalizeWhatsapp(editWhatsapp.trim());
    if (!nameVal) { useFlashStore.getState().show("warning", "Nama wajib diisi"); return; }
    if (!waNorm || !isValidWhatsapp(waNorm)) { useFlashStore.getState().show("warning", "Nomor WhatsApp tidak valid"); return; }
    setEditSaving(true);
    try {
      const res = await fetch(`/api/customers/${editUuid}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: nameVal, whatsapp: waNorm, address: editAddress.trim() || null })
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) throw new Error(data?.error || "Gagal memperbarui pelanggan");
      useFlashStore.getState().show("success", "Data pelanggan diperbarui");
      cancelEdit();
      fetchData();
    } catch (e: unknown) {
      useFlashStore.getState().show("error", getErrorMessage(e));
    } finally {
      setEditSaving(false);
    }
  };

  const deleteCustomer = async (uuid: string) => {
    const ok = window.confirm("Hapus pelanggan ini?");
    if (!ok) return;
    try {
      const res = await fetch(`/api/customers/${uuid}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok || data.ok === false) throw new Error(data?.error || "Gagal menghapus pelanggan");
      useFlashStore.getState().show("success", "Pelanggan dihapus");
      if (editUuid === uuid) cancelEdit();
      fetchData();
    } catch (e: unknown) {
      useFlashStore.getState().show("error", getErrorMessage(e));
    }
  };

  if (!authChecked) return <div className="p-4">Memeriksa akses...</div>;

  return (
    <div className="p-4 space-y-4">
      {/* Header + Filter */}
      <div className="neo-card p-3">
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-lg font-semibold">Pelanggan</h1>
          <Link className="neo-button ghost" href="/">Kembali ke Kasir</Link>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <div>
            <label className="text-sm">Cari (nama/WhatsApp)</label>
            <input className="mt-1 w-full neo-input" type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="ketik kata kunci" />
          </div>
          <div>
            <label className="text-sm">Filter transaksi</label>
            <select className="mt-1 w-full neo-input" value={tx} onChange={(e) => setTx(e.target.value as any)}>
              <option value="all">Semua</option>
              <option value="with">Pernah transaksi</option>
              <option value="without">Belum pernah</option>
            </select>
          </div>
          <div>
            <label className="text-sm">Ukuran halaman</label>
            <select className="mt-1 w-full neo-input" value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>
              {[10,20,50,100].map((n) => (<option key={n} value={n}>{n}</option>))}
            </select>
          </div>
          <div className="flex items-end">
            <button className="w-full neo-button" disabled={loading} onClick={() => { setPage(1); fetchData(); }}>{loading ? "Memuat..." : "Terapkan Filter"}</button>
          </div>
          <div className="flex items-end">
            <button className="w-full neo-button ghost" onClick={() => { setQ(""); setTx("all"); setPage(1); }}>Reset</button>
          </div>
        </div>
      </div>

      {/* Create form */}
      <div className="neo-card p-4">
        <div className="font-semibold mb-3">Tambah Pelanggan Baru</div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="text-sm">Nama</label>
            <input className="mt-1 w-full neo-input" type="text" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Nama lengkap" />
            {newErrors.name ? <div className="text-red-600 text-xs mt-1">{newErrors.name}</div> : null}
          </div>
          <div>
            <label className="text-sm">WhatsApp</label>
            <input className="mt-1 w-full neo-input" type="tel" value={newWhatsapp} onChange={(e) => setNewWhatsapp(e.target.value)} placeholder="contoh: 0812xxxx" />
            {newErrors.whatsapp ? <div className="text-red-600 text-xs mt-1">{newErrors.whatsapp}</div> : null}
          </div>
          <div>
            <label className="text-sm">Alamat</label>
            <input className="mt-1 w-full neo-input" type="text" value={newAddress} onChange={(e) => setNewAddress(e.target.value)} placeholder="Opsional" />
          </div>
        </div>
        <div className="mt-3">
          <button className="neo-button" onClick={handleCreate} disabled={creating}>{creating ? "Menyimpan..." : "Simpan Pelanggan"}</button>
        </div>
      </div>

      {/* Table */}
      <div className="neo-card p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="font-semibold">Daftar Pelanggan</div>
          <div className="text-sm text-slate-500">Total: {total}</div>
        </div>
        {/* Export controls */}
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3 mb-3">
          <div>
            <label className="text-sm">Rentang mulai</label>
            <input className="mt-1 w-full neo-input" type="date" value={exportStart} onChange={(e) => setExportStart(e.target.value)} />
          </div>
          <div>
            <label className="text-sm">Rentang akhir</label>
            <input className="mt-1 w-full neo-input" type="date" value={exportEnd} onChange={(e) => setExportEnd(e.target.value)} />
          </div>
          <div className="md:col-span-2">
            <label className="text-sm">Opsi</label>
            <div className="mt-1 flex items-center gap-3">
              <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={exportIncludeNoTx} onChange={(e) => setExportIncludeNoTx(e.target.checked)} /> Sertakan yang belum pernah transaksi</label>
            </div>
          </div>
          <div className="flex items-end">
            <button className="w-full neo-button" onClick={handleExport}>Ekspor Excel</button>
          </div>
        </div>
        <div className="overflow-x-auto hscroll-touch">
          <table className="min-w-[860px] md:min-w-0 md:w-full text-sm neo-table">
            <thead>
              <tr className="text-left">
                <th className="px-3 py-2">Nama</th>
                <th className="px-3 py-2">Kontak</th>
                <th className="px-3 py-2">Alamat</th>
                <th className="px-3 py-2">Riwayat Transaksi</th>
                <th className="px-3 py-2">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td className="px-3 py-2" colSpan={5}>Tidak ada pelanggan</td></tr>
              ) : rows.map((r) => (
                <tr key={r.uuid} className="border-t">
                  <td className="px-3 py-2">
                    {editUuid === r.uuid ? (
                      <input className="neo-input w-full" value={editName} onChange={(e) => setEditName(e.target.value)} />
                    ) : (
                      r.name
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {editUuid === r.uuid ? (
                      <input className="neo-input w-full" value={editWhatsapp} onChange={(e) => setEditWhatsapp(e.target.value)} />
                    ) : (
                      <div className="space-y-0.5">
                        <div>{r.whatsapp}</div>
                        <div className="text-xs text-slate-500">Klik detail untuk melihat transaksi</div>
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {editUuid === r.uuid ? (
                      <input className="neo-input w-full" value={editAddress} onChange={(e) => setEditAddress(e.target.value)} />
                    ) : (
                      r.address || "—"
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="space-y-0.5">
                      <div>Jumlah transaksi: {r.tx_count}</div>
                      <div className="text-xs text-slate-500">Terakhir: {r.last_tx || "—"}</div>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    {editUuid === r.uuid ? (
                      <div className="flex gap-2 flex-wrap">
                        <button className="neo-button" onClick={saveEdit} disabled={editSaving}>{editSaving ? "Menyimpan..." : "Simpan"}</button>
                        <button className="neo-button ghost" onClick={cancelEdit} disabled={editSaving}>Batal</button>
                      </div>
                    ) : (
                      <div className="flex gap-2 flex-wrap">
                        <button className="neo-button ghost" onClick={() => startEdit(r)}>Edit</button>
                        <button className="neo-button ghost" onClick={() => deleteCustomer(r.uuid)}>Hapus</button>
                        <Link className="neo-button" href={`/customers/${r.uuid}`}>Detail</Link>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between mt-3">
          <div className="text-sm">Halaman {page} dari {totalPages}</div>
          <div className="flex gap-2">
            <button className="neo-button ghost" disabled={page <= 1 || loading} onClick={() => { setPage((p) => Math.max(1, p - 1)); fetchData(); }}>Prev</button>
            <button className="neo-button ghost" disabled={page >= totalPages || loading} onClick={() => { setPage((p) => Math.min(totalPages, p + 1)); fetchData(); }}>Next</button>
          </div>
        </div>
      </div>
    </div>
  );
}