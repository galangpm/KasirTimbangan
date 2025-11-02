"use client";
import { useEffect, useMemo, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useFlashStore } from "@/store/flashStore";

type LogRow = {
  id: number;
  created_at: string;
  user_id: string;
  username: string;
  action: string;
  invoice_id: string | null;
  details: string | null;
};

type Summary = {
  total: number;
  byAction: Array<{ action: string; count: number }>;
  byUser: Array<{ username: string; count: number }>;
};

function getErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  try { return JSON.stringify(e); } catch { return String(e); }
}

export default function LogsPage() {
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);
  const [actions, setActions] = useState<string[]>([]);
  const [rows, setRows] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [summary, setSummary] = useState<Summary | null>(null);

  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [action, setAction] = useState<string>("");
  const [userId, setUserId] = useState<string>("");
  const [q, setQ] = useState<string>("");

  useEffect(() => {
    const check = async () => {
      try {
        const res = await fetch("/api/auth/me");
        const data = await res.json();
        if (!data?.user) { router.replace("/login"); return; }
        if (String(data.user.role || "") !== "superadmin") {
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
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    if (action) params.set("action", action);
    if (userId) params.set("userId", userId);
    if (q) params.set("q", q);
    return params.toString();
  }, [page, pageSize, dateFrom, dateTo, action, userId, q]);

  const loadActions = useCallback(async () => {
    try {
      const res = await fetch("/api/logs?meta=actions");
      const data = await res.json();
      if (!res.ok || data.ok === false) throw new Error(data?.error || "Gagal memuat aksi");
      setActions(Array.isArray(data.actions) ? data.actions : []);
    } catch (e: unknown) {
      useFlashStore.getState().show("error", getErrorMessage(e));
    }
  }, []);

  const fetchData = useCallback(async () => {
    if (!authChecked) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/logs?${queryString}`);
      const data = await res.json();
      if (!res.ok || data.ok === false) throw new Error(data?.error || "Gagal memuat log");
      setRows(Array.isArray(data.data) ? data.data : []);
      setPage(data.page || 1);
      setPageSize(data.pageSize || 20);
      setTotal(data.total || 0);
      setTotalPages(data.totalPages || 1);
    } catch (e: unknown) {
      useFlashStore.getState().show("error", getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [authChecked, queryString]);

  const fetchSummary = useCallback(async () => {
    if (!authChecked) return;
    try {
      const qs = new URLSearchParams();
      if (dateFrom) qs.set("dateFrom", dateFrom);
      if (dateTo) qs.set("dateTo", dateTo);
      if (action) qs.set("action", action);
      if (userId) qs.set("userId", userId);
      if (q) qs.set("q", q);
      qs.set("meta", "summary");
      const res = await fetch(`/api/logs?${qs.toString()}`);
      const data = await res.json();
      if (!res.ok || data.ok === false) throw new Error(data?.error || "Gagal memuat ringkasan");
      setSummary(data.summary || null);
    } catch (e: unknown) {
      useFlashStore.getState().show("error", getErrorMessage(e));
    }
  }, [authChecked, dateFrom, dateTo, action, userId, q]);

  useEffect(() => { if (authChecked) { loadActions(); fetchData(); fetchSummary(); } }, [authChecked, loadActions, fetchData, fetchSummary]);

  const applyFilters = () => { setPage(1); fetchData(); fetchSummary(); };

  const columns = ["Waktu", "Pengguna", "Aksi", "Invoice", "Detail"];

  return (
    <div className="container" style={{ maxWidth: 960, margin: "20px auto" }}>
      <div className="neo-card p-4 mb-4">
        <h2 className="text-lg font-semibold mb-3">Log Aktivitas</h2>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <div>
            <label className="block text-sm mb-1">Tanggal Dari</label>
            <input type="date" className="neo-input w-full" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </div>
          <div>
            <label className="block text-sm mb-1">Tanggal Sampai</label>
            <input type="date" className="neo-input w-full" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>
          <div>
            <label className="block text-sm mb-1">Jenis Aktivitas</label>
            <select className="neo-input w-full" value={action} onChange={(e) => setAction(e.target.value)}>
              <option value="">Semua</option>
              {actions.map((a) => (<option key={a} value={a}>{a}</option>))}
            </select>
          </div>
          <div>
            <label className="block text-sm mb-1">User ID</label>
            <input className="neo-input w-full" value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="ID pengguna" />
          </div>
          <div>
            <label className="block text-sm mb-1">Cari (detail/invoice)</label>
            <input className="neo-input w-full" value={q} onChange={(e) => setQ(e.target.value)} placeholder="kata kunci" />
          </div>
        </div>
        <div className="flex items-center gap-2 mt-3">
          <button className="neo-button" onClick={applyFilters} disabled={loading}>{loading ? "Memuat..." : "Terapkan"}</button>
          <button className="neo-button ghost" onClick={() => { setDateFrom(""); setDateTo(""); setAction(""); setUserId(""); setQ(""); setPage(1); fetchData(); fetchSummary(); }}>Reset</button>
        </div>
      </div>

      <div className="neo-card p-4 mb-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">Daftar Log</h3>
          <div className="flex items-center gap-2">
            <label className="text-sm">Per halaman</label>
            <select className="neo-input" value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); fetchData(); }}>
              {[10,20,50,100].map((n) => (<option key={n} value={n}>{n}</option>))}
            </select>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {columns.map((c) => (<th key={c} className="text-left border-b p-2">{c}</th>))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td className="p-3" colSpan={columns.length}>Tidak ada data</td></tr>
              ) : rows.map((r) => (
                <tr key={r.id}>
                  <td className="p-2 whitespace-nowrap">{new Date(r.created_at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })}</td>
                  <td className="p-2">{r.username || r.user_id}</td>
                  <td className="p-2">{r.action}</td>
                  <td className="p-2">{r.invoice_id ? (<Link href={`/invoices/${r.invoice_id}`}>{r.invoice_id}</Link>) : (<em>—</em>)}</td>
                  <td className="p-2"><code className="text-xs break-words">{r.details || ""}</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex items-center justify-between">
          <div className="text-sm text-slate-700">Total: {total} | Halaman {page} dari {totalPages}</div>
          <div className="flex items-center gap-2">
            <button className="neo-button ghost small" disabled={page <= 1} onClick={() => { setPage((p) => Math.max(1, p - 1)); fetchData(); }}>Sebelumnya</button>
            <button className="neo-button ghost small" disabled={page >= totalPages} onClick={() => { setPage((p) => Math.min(totalPages, p + 1)); fetchData(); }}>Berikutnya</button>
          </div>
        </div>
      </div>

      <div className="neo-card p-4">
        <h3 className="font-semibold mb-2">Ringkasan</h3>
        {!summary ? (
          <div className="text-sm text-slate-600">Tidak ada ringkasan</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <h4 className="font-semibold mb-2">Top Aksi</h4>
              <ul className="text-sm">
                {summary.byAction.map((r) => (
                  <li key={r.action} className="flex items-center justify-between"><span>{r.action}</span><span>{r.count}</span></li>
                ))}
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-2">Top Pengguna</h4>
              <ul className="text-sm">
                {summary.byUser.map((r, i) => (
                  <li key={`${r.username}-${i}`} className="flex items-center justify-between"><span>{r.username || "(unknown)"}</span><span>{Number(r.count) || 0}</span></li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}