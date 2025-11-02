"use client";
import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useFlashStore } from "@/store/flashStore";

type UploadRow = {
  id: number;
  invoice_id: string;
  invoice_item_id: number | null;
  item_index: number | null;
  kind: string;
  status: string;
  progress: number;
  filename: string | null;
  data_url: string | null;
  attempts: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

function getErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  try { return JSON.stringify(e); } catch { return String(e); }
}

export default function UploadsPage() {
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);
  const [rows, setRows] = useState<UploadRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("queued");
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    const check = async () => {
      try {
        const res = await fetch("/api/auth/me");
        const data = await res.json();
        if (!data?.user) { router.replace("/login"); return; }
        const role = String(data.user.role || "");
        if (role !== "kasir" && role !== "superadmin") {
          useFlashStore.getState().show("warning", "Akses ditolak: hanya untuk kasir/superadmin");
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

  const fetchData = useCallback(async () => {
    if (!authChecked) return;
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (statusFilter) qs.set("status", statusFilter);
      qs.set("limit", "50");
      const res = await fetch(`/api/uploads?${qs.toString()}`);
      const data = await res.json();
      if (!res.ok || data.ok === false) throw new Error(data?.error || "Gagal memuat status uploads");
      setRows(Array.isArray(data.items) ? data.items : []);
    } catch (e: unknown) {
      useFlashStore.getState().show("error", getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [authChecked, statusFilter]);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => {
    if (!autoRefresh) return;
    const t = setInterval(() => fetchData(), 2000);
    return () => clearInterval(t);
  }, [autoRefresh, fetchData]);

  const sync = async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/uploads/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 10 })
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) throw new Error(data?.error || "Gagal sinkronisasi");
      useFlashStore.getState().show("success", `Memproses ${data.processed || 0} upload`);
      fetchData();
    } catch (e: unknown) {
      useFlashStore.getState().show("error", getErrorMessage(e));
    } finally {
      setSyncing(false);
    }
  };

  const retry = async (id: number) => {
    try {
      const res = await fetch(`/api/uploads/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "retry" })
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) throw new Error(data?.error || "Gagal retry upload");
      useFlashStore.getState().show("success", `Upload #${id} diulang`);
      fetchData();
    } catch (e: unknown) {
      useFlashStore.getState().show("error", getErrorMessage(e));
    }
  };

  const columns = ["ID", "Tanggal", "Invoice", "Item", "Jenis", "Preview", "Progress", "Status", "File", "Kesalahan", "Aksi"];

  return (
    <div className="p-4 space-y-4">
      <div className="neo-card p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Upload Gambar (Manual Sync)</h2>
          <div className="flex items-center gap-2">
            <label className="text-sm">Status</label>
            <select className="neo-input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">Semua</option>
              <option value="queued">Queued</option>
              <option value="uploading">Uploading</option>
              <option value="success">Success</option>
              <option value="error">Error</option>
            </select>
            <button className="neo-button small" onClick={() => fetchData()} disabled={loading}>Refresh</button>
            <button className="neo-button primary small" onClick={sync} disabled={loading || syncing}>{syncing ? "Syncing..." : "Sync"}</button>
            <label className="text-sm flex items-center gap-1 ml-2">
              <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} /> Auto Refresh
            </label>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c} className="text-left border-b px-3 py-2 text-sm text-slate-600">{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={columns.length} className="px-3 py-3 text-sm">Tidak ada data</td></tr>
              ) : rows.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="px-3 py-2 whitespace-nowrap">#{r.id}</td>
                  <td className="px-3 py-2 whitespace-nowrap" suppressHydrationWarning>{new Date(r.created_at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })}</td>
                  <td className="px-3 py-2 font-mono text-xs"><a className="text-blue-600 hover:underline" href={`/invoices/${r.invoice_id}`} target="_blank" rel="noreferrer">{r.invoice_id}</a></td>
                  <td className="px-3 py-2">{r.invoice_item_id ?? r.item_index ?? "-"}</td>
                  <td className="px-3 py-2">{r.kind}</td>
                  <td className="px-3 py-2">
                    {r.status === "queued" && r.data_url ? (
                      <img src={r.data_url} alt={`inv ${r.invoice_id}`} style={{ width: 80, height: 80, objectFit: "cover", borderRadius: 4, border: "1px solid #e2e8f0" }} />
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <div className="w-40 h-2 bg-slate-200 rounded overflow-hidden">
                        <div className={`${r.status === "error" ? "bg-red-500" : r.status === "success" ? "bg-green-500" : "bg-blue-500"}`} style={{ width: `${Math.max(0, Math.min(100, r.progress))}%`, height: 8 }} />
                      </div>
                      <span className="text-xs">{r.progress}%</span>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <span className={`px-2 py-1 rounded text-xs ${r.status === "error" ? "bg-red-100 text-red-700" : r.status === "success" ? "bg-green-100 text-green-700" : r.status === "uploading" ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-700"}`}>{r.status}</span>
                  </td>
                  <td className="px-3 py-2">
                    {r.filename ? <a className="text-blue-600 hover:underline" href={r.filename} target="_blank" rel="noreferrer">{r.filename}</a> : <span className="text-slate-400">—</span>}
                  </td>
                  <td className={`px-3 py-2 text-xs ${r.status === "error" ? "text-red-700" : "text-slate-600"}`}>{r.last_error || ""}</td>
                  <td className="px-3 py-2">
                    {r.status === "error" ? (
                      <button className="neo-button secondary small" onClick={() => retry(r.id)}>Retry</button>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}