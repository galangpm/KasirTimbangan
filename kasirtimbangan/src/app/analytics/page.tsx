"use client";
import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useFlashStore } from "@/store/flashStore";

type InvoiceSummary = {
  id: string;
  created_at: string;
  payment_method: string | null;
  grand_total: number;
  items_count: number;
};

type FruitAnalyticsRow = {
  fruit: string;
  total_kg: number;
  revenue: number;
  items_count: number;
  avg_price_per_kg: number;
};

function formatCurrency(n: number) {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(Math.round(n));
}

function formatDate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function fetchAllInvoices(params: { dateFrom?: string; dateTo?: string; q?: string }) {
  const pageSize = 100;
  let page = 1;
  let all: InvoiceSummary[] = [];
  let totalPages = 1;
  do {
    const qs = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (params.dateFrom) qs.set("dateFrom", params.dateFrom);
    if (params.dateTo) qs.set("dateTo", params.dateTo);
    if (params.q) qs.set("q", params.q);
    const res = await fetch(`/api/invoices?${qs.toString()}`, { cache: "no-store" });
    const json = await res.json();
    if (!res.ok || !json.ok) throw new Error(json?.error || "Gagal memuat data");
    const data: InvoiceSummary[] = (json.data || []).map((r: unknown) => {
      const row = r as Partial<InvoiceSummary & { payment_method: string; grand_total: number; items_count: number }> & { id?: unknown; created_at?: unknown };
      return {
        id: String(row.id ?? ""),
        created_at: String(row.created_at ?? ""),
        payment_method: row.payment_method == null ? null : String(row.payment_method),
        grand_total: Number(row.grand_total || 0),
        items_count: Number(row.items_count || 0),
      };
    });
    all = all.concat(data);
    totalPages = Number(json.totalPages || 1);
    page += 1;
  } while (page <= totalPages && page <= 50); // guard maksimal 50 halaman
  return all;
}

function LineChart({ points }: { points: Array<{ x: number; y: number }> }) {
  const width = 800;
  const height = 240;
  const padding = 32;
  const maxX = points.length ? Math.max(...points.map((p) => p.x)) : 1;
  const maxY = points.length ? Math.max(...points.map((p) => p.y)) : 1;
  const scaleX = (x: number) => padding + (x / Math.max(1, maxX)) * (width - 2 * padding);
  const scaleY = (y: number) => height - padding - (y / Math.max(1, maxY)) * (height - 2 * padding);
  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${scaleX(p.x)},${scaleY(p.y)}`)
    .join(" ");
  return (
    <svg width={width} height={height} className="bg-white rounded border">
      {/* Axes */}
      <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke="#cbd5e1" />
      <line x1={padding} y1={padding} x2={padding} y2={height - padding} stroke="#cbd5e1" />
      {/* Path */}
      <path d={path} fill="none" stroke="#0ea5e9" strokeWidth={2} />
      {/* Points */}
      {points.map((p, i) => (
        <circle key={i} cx={scaleX(p.x)} cy={scaleY(p.y)} r={3} fill="#0ea5e9" />
      ))}
    </svg>
  );
}

async function fetchFruitAnalytics(params: { dateFrom?: string; dateTo?: string; q?: string }) {
  const qs = new URLSearchParams();
  qs.set("groupBy", "fruit");
  if (params.dateFrom) qs.set("dateFrom", params.dateFrom);
  if (params.dateTo) qs.set("dateTo", params.dateTo);
  if (params.q) qs.set("q", params.q);
  const res = await fetch(`/api/invoices?${qs.toString()}`, { cache: "no-store" });
  const json = await res.json();
  if (!res.ok || !json.ok) throw new Error(json?.error || "Gagal memuat analitik buah");
  const data: FruitAnalyticsRow[] = (json.data || []).map((r: unknown) => {
    const row = r as Partial<FruitAnalyticsRow> & { fruit?: unknown; total_kg?: unknown; revenue?: unknown; items_count?: unknown; avg_price_per_kg?: unknown };
    return {
      fruit: String(row.fruit ?? ""),
      total_kg: Number(row.total_kg || 0),
      revenue: Number(row.revenue || 0),
      items_count: Number(row.items_count || 0),
      avg_price_per_kg: Number(row.avg_price_per_kg || 0),
    };
  });
  return data;
}

// Cache & seeding utilities
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 hari
const SEED_INTERVAL_MS = 15 * 60 * 1000; // 15 menit

type CacheEnvelope<T> = { ts: number; ttl: number; data: T };

function cacheSet<T>(key: string, data: T, ttlMs = CACHE_TTL_MS) {
  try {
    const env: CacheEnvelope<T> = { ts: Date.now(), ttl: ttlMs, data };
    window.localStorage.setItem(key, JSON.stringify(env));
  } catch {}
}

function cacheGet<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const env = JSON.parse(raw) as CacheEnvelope<T>;
    if (!env || typeof env.ts !== "number" || typeof env.ttl !== "number") {
      window.localStorage.removeItem(key);
      return null;
    }
    if (Date.now() - env.ts > env.ttl) {
      window.localStorage.removeItem(key);
      return null;
    }
    return env.data as T;
  } catch {
    return null;
  }
}

function cachePurge(keys: string[]) {
  for (const k of keys) {
    try {
      const raw = window.localStorage.getItem(k);
      if (!raw) continue;
      const env = JSON.parse(raw) as CacheEnvelope<unknown>;
      if (!env || Date.now() - env.ts > env.ttl) {
        window.localStorage.removeItem(k);
      }
    } catch {
      try { window.localStorage.removeItem(k); } catch {}
    }
  }
}

function getLast30Range() {
  const to = new Date();
  const from = new Date();
  from.setDate(to.getDate() - 30);
  return { from: formatDate(from), to: formatDate(to) };
}

function shouldSeed(lastSeedTs: number | null) {
  if (!lastSeedTs) return true;
  return Date.now() - lastSeedTs >= SEED_INTERVAL_MS;
}

function getLastSeed(): number | null {
  const raw = window.localStorage.getItem("analytics.lastSeed");
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function setLastSeed(ts: number) {
  try { window.localStorage.setItem("analytics.lastSeed", String(ts)); } catch {}
}

function scheduleIdle(fn: () => void) {
  type RequestIdleCallbackHandle = number;
  type RequestIdleCallbackOptions = { timeout?: number };
  type RequestIdleCallbackDeadline = { readonly didTimeout: boolean; timeRemaining: () => number };
  type RequestIdleCallback = (
    cb: (deadline: RequestIdleCallbackDeadline) => void,
    opts?: RequestIdleCallbackOptions
  ) => RequestIdleCallbackHandle;

  const maybeRIC: RequestIdleCallback | undefined = (
    globalThis as unknown as { requestIdleCallback?: RequestIdleCallback }
  ).requestIdleCallback;

  if (typeof maybeRIC === "function") {
    maybeRIC(() => fn(), { timeout: 2000 });
  } else {
    setTimeout(fn, 1000);
  }
}

function BarChart({ data }: { data: Array<{ label: string; value: number; avgWeightKg?: number }> }) {
  const width = 480;
  const height = 240;
  const padding = 32;
  const bottomMargin = 40; // ruang ekstra di bawah chart untuk label agar tidak mepet dengan tepi card
  const axisBaselineY = height - padding - bottomMargin;
  const maxV = data.length ? Math.max(...data.map((d) => d.value)) : 1;
  const barWidth = Math.max(20, (width - 2 * padding) / Math.max(1, data.length) - 10);
  return (
    <svg width={width} height={height} className="bg-white rounded border">
      <line x1={padding} y1={axisBaselineY} x2={width - padding} y2={axisBaselineY} stroke="#cbd5e1" />
      {data.map((d, i) => {
        const x = padding + i * (barWidth + 10);
        const h = (d.value / Math.max(1, maxV)) * (height - 2 * padding - bottomMargin);
        const y = axisBaselineY - h;
        return (
          <g key={d.label}>
            <rect x={x} y={y} width={barWidth} height={h} fill="#10b981" />
            {/* Nilai pendapatan di atas bar */}
            <text x={x + barWidth / 2} y={Math.max(y - 4, 12)} textAnchor="middle" fontSize={11} fill="#0f172a">
              {formatCurrency(d.value)}
            </text>
            {/* Label buah */}
            <text x={x + barWidth / 2} y={axisBaselineY + 16} textAnchor="middle" fontSize={12} fill="#334155">
              {d.label}
            </text>
            {/* Berat rata-rata per buah di bawah label */}
            <text x={x + barWidth / 2} y={axisBaselineY + 32} textAnchor="middle" fontSize={11} fill="#64748b">
              {(d.avgWeightKg ?? 0).toFixed(2)} kg rata-rata
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export default function AnalyticsPage() {
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState<boolean>(false);
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [q, setQ] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [invoices, setInvoices] = useState<InvoiceSummary[]>([]);
  const [fruitRows, setFruitRows] = useState<FruitAnalyticsRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Purge caches that exceed TTL on start
  useEffect(() => {
    // Purge caches that exceed TTL on start
    scheduleIdle(() => {
      cachePurge([
        "analytics.invoices.last30",
        "analytics.fruit.last30",
      ]);
    });
  }, []);

  // Inisialisasi tanggal default 30 hari terakhir sekali saat mount
  useEffect(() => {
    const toDate = new Date();
    const fromDate = new Date();
    fromDate.setDate(toDate.getDate() - 30);
    setDateFrom(formatDate(fromDate));
    setDateTo(formatDate(toDate));
  }, []);
  useEffect(() => {
    // On first mount, try hydrate UI from cache for default snapshot (non-filtered) to speed initial render
    const defaultRange = getLast30Range();
    const isDefault = dateFrom === defaultRange.from && dateTo === defaultRange.to && !q;
    if (isDefault) {
      const cachedInv = cacheGet<InvoiceSummary[]>("analytics.invoices.last30");
      const cachedFruit = cacheGet<FruitAnalyticsRow[]>("analytics.fruit.last30");
      if (cachedInv && cachedFruit) {
        setInvoices(cachedInv);
        setFruitRows(cachedFruit);
      }
    }
  }, [dateFrom, dateTo, q]);

  // Access protection: superadmin only
  useEffect(() => {
    const check = async () => {
      try {
        const res = await fetch("/api/auth/me");
        const data = await res.json();
        if (!data?.user) {
          router.replace("/login");
          return;
        }
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
  // Penjadwalan seeding background setiap 15 menit (idle-friendly)
  // Letakkan hooks di atas gating dan guard eksekusi di dalam callback
  useEffect(() => {
    if (!authChecked) return;
    const runIdle = () => scheduleIdle(seed);
    runIdle();
    const id = setInterval(runIdle, SEED_INTERVAL_MS);
    return () => clearInterval(id);
  }, [authChecked]);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [dataInv, dataFruit] = await Promise.all([
        fetchAllInvoices({ dateFrom, dateTo, q }),
        fetchFruitAnalytics({ dateFrom, dateTo, q }),
      ]);
      setInvoices(dataInv);
      setFruitRows(dataFruit);

      // Cache only the default last-30-days snapshot with empty search for fast access
      const defaultRange = getLast30Range();
      const isDefault = dateFrom === defaultRange.from && dateTo === defaultRange.to && !q;
      if (isDefault) {
        scheduleIdle(() => {
          cacheSet("analytics.invoices.last30", dataInv);
          cacheSet("analytics.fruit.last30", dataFruit);
        });
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // auto load setelah tanggal diinisialisasi
    if (dateFrom && dateTo) {
      load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo]);

  const metrics = useMemo(() => {
    const totalInvoices = invoices.length;
    const totalRevenue = invoices.reduce((sum, r) => sum + (r.grand_total || 0), 0);
    const avgInvoice = totalInvoices ? totalRevenue / totalInvoices : 0;
    const totalItems = invoices.reduce((sum, r) => sum + (r.items_count || 0), 0);
    return { totalInvoices, totalRevenue, avgInvoice, totalItems };
  }, [invoices]);

  /* Melon metrics removed */

  const fruitBars = useMemo(() => {
    const top = fruitRows.slice(0, 10);
    return top.map((r) => ({ label: r.fruit, value: Math.round(r.revenue), avgWeightKg: r.items_count > 0 ? r.total_kg / r.items_count : 0 }));
  }, [fruitRows]);

  // Render skeleton setelah semua hooks dideklarasikan
  if (!authChecked) return <div className="neo-card p-4">Memeriksa akses...</div>;

  return (
    <div className="p-4 space-y-4">
      <div className="neo-card p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Analitik Jenis Buah</h2>
          <button className="neo-button primary" onClick={load} disabled={loading}>
            {loading ? "Memuat..." : "Terapkan Filter"}
          </button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 mt-4">
          <div>
            <label className="text-sm">Dari Tanggal</label>
            <input type="date" className="neo-input w-full" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </div>
          <div>
            <label className="text-sm">Sampai Tanggal</label>
            <input type="date" className="neo-input w-full" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <label className="text-sm">Cari (ID, Metode, atau Buah)</label>
            <input type="text" className="neo-input w-full" placeholder="misal: melon" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
        {error && <div className="text-red-600 mt-2">{error}</div>}
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <div className="neo-card p-4">
          <div className="text-xs text-slate-500">Total Nota</div>
          <div className="text-2xl font-semibold">{metrics.totalInvoices}</div>
        </div>
        <div className="neo-card p-4">
          <div className="text-xs text-slate-500">Total Pendapatan</div>
          <div className="text-2xl font-semibold">{formatCurrency(metrics.totalRevenue)}</div>
        </div>
        <div className="neo-card p-4">
          <div className="text-xs text-slate-500">Rata-rata per Nota</div>
          <div className="text-2xl font-semibold">{formatCurrency(metrics.avgInvoice)}</div>
        </div>
        <div className="neo-card p-4">
          <div className="text-xs text-slate-500">Total Item</div>
          <div className="text-2xl font-semibold">{metrics.totalItems}</div>
        </div>
      </div>

      {/* Fruit charts & table */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className="neo-card p-4 lg:col-span-2">
          <div className="flex items-center justify-between mb-2">
            <div className="font-semibold">Top Buah per Pendapatan</div>
            <div className="text-xs text-slate-500">Periode: {dateFrom} s/d {dateTo}</div>
          </div>
          <div className="overflow-x-auto hscroll-touch">
            <BarChart data={fruitBars} />
          </div>
        </div>
        {/* Performa Produk: Melon dihapus */}
      </div>

      <div className="neo-card p-4">
        <div className="font-semibold mb-2">Ringkasan per Buah</div>
        <div className="overflow-x-auto hscroll-touch">
          <table className="neo-table md:w-full md:min-w-0">
            <thead>
              <tr>
                <th className="text-left">Buah</th>
                <th className="text-right">Total Kg</th>
                <th className="text-right">Pendapatan</th>
                <th className="text-right">Rata-rata Harga/Kg</th>
                <th className="text-right">Jumlah Item</th>
              </tr>
            </thead>
            <tbody>
              {fruitRows.map((r) => (
                <tr key={r.fruit}>
                  <td>{r.fruit}</td>
                  <td className="text-right">{r.total_kg.toFixed(2)} kg</td>
                  <td className="text-right">{formatCurrency(r.revenue)}</td>
                  <td className="text-right">{formatCurrency(r.avg_price_per_kg)}</td>
                  <td className="text-right">{r.items_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>


      {/* Insight */}
      <div className="neo-card p-4">
        <div className="font-semibold mb-2">Insight</div>
        <ul className="list-disc pl-5 space-y-1 text-sm">
          <li>Fokus pada performa buah (kg terjual, pendapatan, harga rata-rata) untuk pengambilan keputusan stok.</li>
          <li>Sesuaikan strategi harga per kg berdasarkan tren performa per buah.</li>
        </ul>
      </div>
    </div>
  );
}


// Background seeding every 15 minutes (asynchronous, idle-friendly)
const seed = () => {
  try {
    const lastTs = getLastSeed();
    if (!shouldSeed(lastTs)) return;
    const { from, to } = getLast30Range();
    // Seed from API to ensure fresh data; do not use cache for filters
    Promise.all([
      fetchAllInvoices({ dateFrom: from, dateTo: to }),
      fetchFruitAnalytics({ dateFrom: from, dateTo: to }),
    ])
      .then(([inv, fruit]) => {
        scheduleIdle(() => {
          cacheSet("analytics.invoices.last30", inv);
          cacheSet("analytics.fruit.last30", fruit);
          setLastSeed(Date.now());
        });
      })
      .catch(() => {/* ignore seeding errors */});
  } catch {/* ignore */}
};
// (dipindahkan ke dalam komponen)
// Run immediately once on idle, then schedule interval
// (dipindahkan ke dalam useEffect pada komponen)
// const runIdle = () => scheduleIdle(seed);
// runIdle();
// const id = setInterval(runIdle, SEED_INTERVAL_MS);
// return () => clearInterval(id);
// }