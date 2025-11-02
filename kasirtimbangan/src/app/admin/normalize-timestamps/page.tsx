"use client";
import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useFlashStore } from "@/store/flashStore";

type Result = {
  ok: boolean;
  error?: string;
  dryRun?: boolean;
  table?: string;
  column?: string;
  shiftHours?: number;
  count?: number;
  minTs?: string;
  maxTs?: string;
  samples?: string[];
};

export default function NormalizeTimestampsPage() {
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);

  // Form state
  const [table, setTable] = useState("invoices");
  const [column, setColumn] = useState("created_at");
  const [shiftHours, setShiftHours] = useState<number>(7);
  const [dateFrom, setDateFrom] = useState(""); // YYYY-MM-DD
  const [dateTo, setDateTo] = useState("");   // YYYY-MM-DD
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  // Proteksi akses: hanya superadmin
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

  const getErrorMessage = (e: unknown): string => {
    if (e instanceof Error) return e.message;
    if (typeof e === "string") return e;
    try { return JSON.stringify(e); } catch { return String(e); }
  };

  const validate = (): boolean => {
    if (!table.match(/^[a-zA-Z0-9_]+$/)) { useFlashStore.getState().show("warning", "Nama tabel tidak valid"); return false; }
    if (!column.match(/^[a-zA-Z0-9_]+$/)) { useFlashStore.getState().show("warning", "Nama kolom tidak valid"); return false; }
    if (!Number.isFinite(Number(shiftHours))) { useFlashStore.getState().show("warning", "Perubahan jam tidak valid"); return false; }
    if (dateFrom && !dateFrom.match(/^\d{4}-\d{2}-\d{2}$/)) { useFlashStore.getState().show("warning", "Format tanggal awal harus YYYY-MM-DD"); return false; }
    if (dateTo && !dateTo.match(/^\d{4}-\d{2}-\d{2}$/)) { useFlashStore.getState().show("warning", "Format tanggal akhir harus YYYY-MM-DD"); return false; }
    return true;
  };

  const doPreview = useCallback(async () => {
    if (!validate()) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/normalize-timestamps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ table, column, shiftHours: Number(shiftHours), dateFrom, dateTo, dryRun: true }),
      });
      const data: Result = await res.json();
      if (!res.ok || !data.ok) throw new Error(data?.error || "Gagal melakukan preview");
      setResult(data);
      useFlashStore.getState().show("info", `Preview berhasil: ${data.count || 0} baris terpengaruh`);
    } catch (e: unknown) {
      useFlashStore.getState().show("error", getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [table, column, shiftHours, dateFrom, dateTo]);

  const doRun = useCallback(async () => {
    if (!validate()) return;
    if (!confirm("Jalankan normalisasi? Operasi akan mengubah data secara permanen.")) return;
    setRunning(true);
    try {
      const res = await fetch("/api/admin/normalize-timestamps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ table, column, shiftHours: Number(shiftHours), dateFrom, dateTo, dryRun: false }),
      });
      const data: Result = await res.json();
      if (!res.ok || !data.ok) throw new Error(data?.error || "Gagal menjalankan normalisasi");
      setResult(data);
      useFlashStore.getState().show("success", `Normalisasi selesai: ${data.count || 0} baris diubah`);
    } catch (e: unknown) {
      useFlashStore.getState().show("error", getErrorMessage(e));
    } finally {
      setRunning(false);
    }
  }, [table, column, shiftHours, dateFrom, dateTo]);

  if (!authChecked) return <div className="neo-card p-4">Memeriksa akses...</div>;

  return (
    <div className="p-4 space-y-6">
      <div className="neo-card p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Normalisasi Timestamp</h2>
          <div className="text-xs text-slate-500">Zona waktu: Asia/Jakarta (GMT+7)</div>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm mb-1">Tabel</label>
              <select className="neo-input w-full" value={table} onChange={(e) => setTable(e.target.value)}>
                <option value="invoices">invoices</option>
              </select>
            </div>
            <div>
              <label className="block text-sm mb-1">Kolom Timestamp</label>
              <input className="neo-input w-full" value={column} onChange={(e) => setColumn(e.target.value)} />
            </div>
            <div>
              <label className="block text-sm mb-1">Geser Jam</label>
              <input type="number" className="neo-input w-full" value={shiftHours} onChange={(e) => setShiftHours(Number(e.target.value))} />
              <div className="text-xs text-slate-500 mt-1">Contoh: 7 untuk memajukan 7 jam (UTC → WIB)</div>
            </div>
            <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm mb-1">Tanggal Awal (opsional)</label>
                <input type="date" className="neo-input w-full" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
              </div>
              <div>
                <label className="block text-sm mb-1">Tanggal Akhir (opsional)</label>
                <input type="date" className="neo-input w-full" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
              </div>
            </div>
          </div>

          <div className="flex gap-2">
            <button className="neo-button secondary" onClick={doPreview} disabled={loading || running}>
              {loading ? "Preview..." : "Preview (Dry Run)"}
            </button>
            <button className="neo-button danger" onClick={doRun} disabled={loading || running}>
              {running ? "Memproses..." : "Jalankan Normalisasi"}
            </button>
          </div>

          <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
            PERINGATAN: Operasi ini akan mengubah data secara permanen. Lakukan <b>Preview</b> terlebih dahulu untuk memastikan rentang tanggal dan jumlah baris sudah sesuai.
          </div>
        </div>
      </div>

      <div className="neo-card p-4">
        <h3 className="text-base font-semibold mb-2">Hasil</h3>
        {!result ? (
          <div className="text-sm text-slate-600">Belum ada hasil. Lakukan Preview atau Normalisasi.</div>
        ) : (
          <div className="space-y-2">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
              <div><span className="text-slate-500">Tabel:</span> {result.table}</div>
              <div><span className="text-slate-500">Kolom:</span> {result.column}</div>
              <div><span className="text-slate-500">Geser Jam:</span> {result.shiftHours}</div>
              <div><span className="text-slate-500">Jumlah Baris:</span> {result.count}</div>
              <div><span className="text-slate-500">Rentang Minimal:</span> {result.minTs || "-"}</div>
              <div><span className="text-slate-500">Rentang Maksimal:</span> {result.maxTs || "-"}</div>
            </div>

            <div className="mt-2">
              <div className="text-sm font-medium mb-1">Contoh Sampel</div>
              {!result.samples || result.samples.length === 0 ? (
                <div className="text-sm text-slate-600">Tidak ada sampel tersedia.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm neo-table">
                    <thead>
                      <tr className="bg-slate-100 text-left">
                        <th className="px-3 py-2">Timestamp</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.samples.map((s, idx) => (
                        <tr key={idx} className="border-t">
                          <td className="px-3 py-2 whitespace-nowrap">{s}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {result.dryRun ? (
              <div className="text-xs text-slate-500">Mode: Preview (dry run)</div>
            ) : (
              <div className="text-xs text-green-700">Normalisasi selesai. Perubahan telah diterapkan.</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}