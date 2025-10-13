"use client";
import { useEffect, useState, useCallback } from "react";

export default function SettingsPage() {
  // Hapus penggunaan store lokal, gunakan state lokal yang diambil dari DB
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [receiptFooter, setReceiptFooter] = useState("");
  const [sLoading, setSLoading] = useState(false);
  const [sSaving, setSSaving] = useState(false);
  const [errors, setErrors] = useState<{ name?: string; address?: string; phone?: string; receiptFooter?: string }>({});

  // Helper untuk mengekstrak pesan error secara aman
  const getErrorMessage = (e: unknown): string => {
    if (e instanceof Error) return e.message;
    if (typeof e === "string") return e;
    try { return JSON.stringify(e); } catch { return String(e); }
  };

  // Kelola Harga (CRUD)
  type PriceRow = { id?: string; fruit: string; price: number };
  const [prices, setPrices] = useState<PriceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newFruit, setNewFruit] = useState("");
  const [newPrice, setNewPrice] = useState("");

  const validateSettings = () => {
    const errs: { name?: string; address?: string; phone?: string; receiptFooter?: string } = {};
    if (!name || name.trim().length < 2) errs.name = "Nama usaha wajib diisi (min 2 karakter)";
    if (!address || address.trim().length < 5) errs.address = "Alamat wajib diisi (min 5 karakter)";
    if (!phone) {
      errs.phone = "Nomor telepon wajib diisi";
    } else {
      const phoneClean = phone.trim();
      const digitCount = (phoneClean.match(/\d/g) || []).length;
      if (digitCount < 7 || digitCount > 20) errs.phone = "Nomor telepon harus 7-20 digit";
      const allowed = /^[+\-()\s\d]+$/;
      if (!allowed.test(phoneClean)) errs.phone = "Format nomor telepon tidak valid";
    }
    if (!receiptFooter || receiptFooter.trim().length < 2) errs.receiptFooter = "Footer nota wajib diisi (min 2 karakter)";
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const loadSettings = useCallback(async () => {
    setSLoading(true);
    try {
      const res = await fetch("/api/settings");
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Gagal memuat pengaturan usaha");
      const s = data?.settings;
      if (s) {
        setName(String(s.name || ""));
        setAddress(String(s.address || ""));
        setPhone(String(s.phone || ""));
        setReceiptFooter(String(s.receiptFooter || ""));
      }
    } catch (e: unknown) {
      alert(getErrorMessage(e));
    } finally {
      setSLoading(false);
    }
  }, []);

  useEffect(() => { loadSettings(); }, [loadSettings]);

  const saveSettings = async () => {
    if (!validateSettings()) return;
    setSSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, address, phone, receiptFooter }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error((data?.errors && data.errors.join(", ")) || data?.error || "Gagal menyimpan pengaturan usaha");
      alert("Pengaturan usaha berhasil disimpan");
      await loadSettings();
    } catch (e: unknown) {
      alert(getErrorMessage(e));
    } finally {
      setSSaving(false);
    }
  };

  const loadPrices = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/prices");
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Gagal memuat harga");
      const entries = Object.entries((data?.prices ?? {}) as Record<string, number>);
      const list = entries.map(([fruit, price]) => ({ fruit, price: Number(price) || 0 }));
      setPrices(list);
    } catch (e: unknown) {
      alert(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadPrices(); }, [loadPrices]);

  const saveAll = async () => {
    setSaving(true);
    try {
      const res0 = await fetch("/api/prices");
      const data0 = await res0.json();
      const originalKeys = Object.keys((data0?.prices ?? {}) as Record<string, number>);
      const currentKeys = prices.map((p) => p.fruit);
      const remove = originalKeys.filter((k) => !currentKeys.includes(k));
      const pricesObj: Record<string, number> = {};
      for (const p of prices) pricesObj[p.fruit] = Math.max(0, Math.floor(Number(p.price) || 0));
      const res = await fetch("/api/prices", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prices: pricesObj, remove }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Gagal menyimpan harga");
      alert(`Harga berhasil disimpan (upserted: ${data.upserted}, removed: ${data.removed}).`);
      await loadPrices();
    } catch (e: unknown) {
      alert(getErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const addRow = () => {
    const fruit = newFruit.trim();
    const price = Math.max(0, Math.floor(Number(newPrice) || 0));
    if (!fruit) return alert("Nama buah wajib diisi");
    if (prices.some((p) => p.fruit === fruit)) return alert("Buah sudah ada");
    setPrices((list) => [...list, { fruit, price }]);
    setNewFruit("");
    setNewPrice("");
  };

  const removeRow = (fruit: string) => {
    setPrices((list) => list.filter((p) => p.fruit !== fruit));
  };

  return (
    <div className="p-4 space-y-6">
      <div className="neo-card p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Profil Usaha</h2>
          <div className="flex gap-2">
            <button className="neo-button secondary" onClick={saveSettings} disabled={sSaving}>{sSaving ? "Menyimpan..." : "Simpan ke DB"}</button>
            <button className="neo-button ghost" onClick={loadSettings} disabled={sLoading}>{sLoading ? "Memuat..." : "Muat Ulang"}</button>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm mb-1">Nama Usaha</label>
            <input className="neo-input w-full" value={name} onChange={(e) => setName(e.target.value)} placeholder="Kasir Timbangan" />
            {errors.name && <div className="text-xs text-red-600 mt-1">{errors.name}</div>}
          </div>
          <div>
            <label className="block text-sm mb-1">Nomor Telepon</label>
            <input className="neo-input w-full" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="08xxxx" />
            {errors.phone && <div className="text-xs text-red-600 mt-1">{errors.phone}</div>}
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm mb-1">Alamat Lengkap</label>
            <textarea className="neo-input w-full" rows={3} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Jl. Contoh No. 123, Kota, Provinsi" />
            {errors.address && <div className="text-xs text-red-600 mt-1">{errors.address}</div>}
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm mb-1">Footer Nota (ucapan/terima kasih)</label>
            <input className="neo-input w-full" value={receiptFooter} onChange={(e) => setReceiptFooter(e.target.value)} placeholder="Terima kasih telah berbelanja!" />
            {errors.receiptFooter && <div className="text-xs text-red-600 mt-1">{errors.receiptFooter}</div>}
          </div>
        </div>
      </div>

      <div className="neo-card p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Kelola Harga</h2>
          <div className="flex gap-2">
            <button className="neo-button secondary" onClick={saveAll} disabled={saving}>{saving ? "Menyimpan..." : "Simpan ke DB"}</button>
            <button className="neo-button ghost" onClick={loadPrices}>Muat Ulang</button>
          </div>
        </div>

        {loading ? (
          <div>Memuat harga dari database...</div>
        ) : (
          <div className="space-y-3">
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm neo-table">
                <thead>
                  <tr className="bg-slate-100 text-left">
                    <th className="px-3 py-2">Buah</th>
                    <th className="px-3 py-2">Harga/kg</th>
                    <th className="px-3 py-2">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {prices.length === 0 ? (
                    <tr><td className="px-3 py-2" colSpan={3}>Tidak ada data harga</td></tr>
                  ) : prices.map((p) => (
                    <tr key={p.fruit} className="border-t">
                      <td className="px-3 py-2 whitespace-nowrap">{p.fruit}</td>
                      <td className="px-3 py-2">
                        <input type="number" className="neo-input w-32" value={p.price} onChange={(e) => {
                          const v = Math.max(0, Math.floor(Number(e.target.value) || 0));
                          setPrices((list) => list.map((x) => x.fruit === p.fruit ? { ...x, price: v } : x));
                        }} />
                      </td>
                      <td className="px-3 py-2">
                        <button className="neo-button danger small" onClick={() => removeRow(p.fruit)}>Hapus</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center gap-2 pt-2">
              <input className="neo-input flex-1" placeholder="Nama buah" value={newFruit} onChange={(e) => setNewFruit(e.target.value)} />
              <input type="number" className="neo-input w-32" placeholder="Harga/kg" value={newPrice} onChange={(e) => setNewPrice(e.target.value)} />
              <button className="neo-button secondary" onClick={addRow}>Tambah</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}