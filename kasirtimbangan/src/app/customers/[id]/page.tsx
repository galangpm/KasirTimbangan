"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useFlashStore } from "@/store/flashStore";

type TxRow = { id: string; created_at: string; payment_method: string | null; items_count: number; grand_total: number };

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

export default function CustomerDetailPage() {
  const router = useRouter();
  const params = useParams();
  const id = useMemo(() => String((params as any)?.id || ""), [params]);
  const [authChecked, setAuthChecked] = useState(false);

  const [loading, setLoading] = useState(false);
  const [customer, setCustomer] = useState<{ uuid: string; name: string; whatsapp: string; address: string | null } | null>(null);
  const [txs, setTxs] = useState<TxRow[]>([]);

  const [editMode, setEditMode] = useState(false);
  const [name, setName] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [address, setAddress] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const check = async () => {
      try {
        const res = await fetch("/api/auth/me");
        const data = await res.json();
        if (!data?.user) { router.replace("/login"); return; }
        if (data.user.role !== "superadmin") {
          useFlashStore.getState().show("warning", "Akses ditolak: hanya untuk superadmin");
          router.replace("/");
          return;
        }
        setAuthChecked(true);
      } catch { router.replace("/login"); }
    };
    check();
  }, [router]);

  useEffect(() => {
    const load = async () => {
      if (!id) return;
      setLoading(true);
      try {
        const res = await fetch(`/api/customers/${id}`);
        const data = await res.json();
        if (!res.ok || data.ok === false) throw new Error(data?.error || "Gagal memuat detail pelanggan");
        setCustomer(data.customer || null);
        setTxs(data.transactions || []);
        if (data.customer) {
          setName(String(data.customer.name || ""));
          setWhatsapp(String(data.customer.whatsapp || ""));
          setAddress(data.customer.address ? String(data.customer.address) : "");
        }
      } catch (e: unknown) {
        useFlashStore.getState().show("error", getErrorMessage(e));
      } finally { setLoading(false); }
    };
    if (authChecked) load();
  }, [authChecked, id]);

  const save = async () => {
    if (!customer) return;
    const nameVal = name.trim();
    const waNorm = normalizeWhatsapp(whatsapp.trim());
    if (!nameVal) { useFlashStore.getState().show("warning", "Nama wajib diisi"); return; }
    if (!waNorm || !isValidWhatsapp(waNorm)) { useFlashStore.getState().show("warning", "Nomor WhatsApp tidak valid"); return; }
    setSaving(true);
    try {
      const res = await fetch(`/api/customers/${customer.uuid}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: nameVal, whatsapp: waNorm, address: address.trim() || null }) });
      const data = await res.json();
      if (!res.ok || data.ok === false) throw new Error(data?.error || "Gagal memperbarui pelanggan");
      useFlashStore.getState().show("success", "Data pelanggan diperbarui");
      setEditMode(false);
      // refresh
      const res2 = await fetch(`/api/customers/${id}`);
      const d2 = await res2.json();
      if (res2.ok && d2.ok) { setCustomer(d2.customer || null); setTxs(d2.transactions || []); }
    } catch (e: unknown) {
      useFlashStore.getState().show("error", getErrorMessage(e));
    } finally { setSaving(false); }
  };

  const del = async () => {
    if (!customer) return;
    const ok = window.confirm("Hapus pelanggan ini?");
    if (!ok) return;
    try {
      const res = await fetch(`/api/customers/${customer.uuid}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok || data.ok === false) throw new Error(data?.error || "Gagal menghapus pelanggan");
      useFlashStore.getState().show("success", "Pelanggan dihapus");
      router.replace("/customers");
    } catch (e: unknown) {
      useFlashStore.getState().show("error", getErrorMessage(e));
    }
  };

  if (!authChecked) return <div className="p-4">Memeriksa akses...</div>;

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-lg font-semibold">Detail Pelanggan</div>
        <div className="flex gap-2">
          <Link className="neo-button ghost" href="/customers">Kembali</Link>
          {customer && !editMode ? <button className="neo-button ghost" onClick={() => setEditMode(true)}>Edit</button> : null}
          {customer ? <button className="neo-button ghost" onClick={del}>Hapus</button> : null}
        </div>
      </div>

      {/* Profile */}
      <div className="neo-card p-4">
        {!customer ? (
          <div>{loading ? "Memuat..." : "Customer tidak ditemukan"}</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-sm">Nama</label>
              {editMode ? (
                <input className="mt-1 neo-input w-full" value={name} onChange={(e) => setName(e.target.value)} />
              ) : (
                <div className="mt-1">{customer.name}</div>
              )}
            </div>
            <div>
              <label className="text-sm">WhatsApp</label>
              {editMode ? (
                <input className="mt-1 neo-input w-full" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} />
              ) : (
                <div className="mt-1">{customer.whatsapp}</div>
              )}
            </div>
            <div className="md:col-span-2">
              <label className="text-sm">Alamat</label>
              {editMode ? (
                <input className="mt-1 neo-input w-full" value={address} onChange={(e) => setAddress(e.target.value)} />
              ) : (
                <div className="mt-1">{customer.address || "—"}</div>
              )}
            </div>
            {editMode ? (
              <div className="md:col-span-2">
                <div className="flex gap-2">
                  <button className="neo-button" onClick={save} disabled={saving}>{saving ? "Menyimpan..." : "Simpan Perubahan"}</button>
                  <button className="neo-button ghost" onClick={() => setEditMode(false)} disabled={saving}>Batal</button>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>

      {/* Transactions */}
      <div className="neo-card p-4">
        <div className="font-semibold mb-2">Riwayat Transaksi</div>
        <div className="overflow-x-auto hscroll-touch">
          <table className="min-w-[720px] md:min-w-0 md:w-full text-sm neo-table">
            <thead>
              <tr>
                <th className="text-left px-3 py-2">ID Nota</th>
                <th className="text-left px-3 py-2">Tanggal</th>
                <th className="text-left px-3 py-2">Metode</th>
                <th className="text-right px-3 py-2">Jumlah Item</th>
                <th className="text-right px-3 py-2">Total</th>
                <th className="text-left px-3 py-2">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {txs.length === 0 ? (
                <tr><td className="px-3 py-2" colSpan={6}>{loading ? "Memuat..." : "Belum ada transaksi"}</td></tr>
              ) : txs.map((t) => (
                <tr key={t.id} className="border-t">
                  <td className="px-3 py-2">{t.id}</td>
                  <td className="px-3 py-2">{t.created_at}</td>
                  <td className="px-3 py-2">{t.payment_method || "—"}</td>
                  <td className="px-3 py-2 text-right">{t.items_count}</td>
                  <td className="px-3 py-2 text-right">{formatCurrency(t.grand_total)}</td>
                  <td className="px-3 py-2"><Link className="neo-button ghost" href={`/invoices/${t.id}`}>Detail Nota</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}