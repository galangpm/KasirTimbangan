// Lightweight local cache untuk invoice dengan TTL 24 jam
// Menggunakan localStorage dan menyimpan timestamp per entry
// Struktur key: invoice:<id>

export interface InvoiceHeader { id: string; created_at: string; payment_method: string | null }
export interface InvoiceItemRow { id: string; fruit: string; weight_kg: number; price_per_kg: number; total_price: number; image_data_url?: string | null; full_image_data_url?: string | null }
export interface InvoiceDetail { invoice: InvoiceHeader; items: InvoiceItemRow[] }

const PREFIX = "invoice:";
const TTL_MS = 24 * 60 * 60 * 1000; // 24 jam

interface CacheEntry<T> { ts: number; data: T }

function now() { return Date.now(); }

function makeKey(id: string) { return `${PREFIX}${id}`; }

export function cacheSet(id: string, data: InvoiceDetail): void {
  try {
    const entry: CacheEntry<InvoiceDetail> = { ts: now(), data };
    localStorage.setItem(makeKey(id), JSON.stringify(entry));
  } catch {}
}

export function cacheGet(id: string): InvoiceDetail | null {
  try {
    const raw = localStorage.getItem(makeKey(id));
    if (!raw) return null;
    const entry = JSON.parse(raw) as CacheEntry<InvoiceDetail>;
    if (!entry?.ts || !entry?.data) { localStorage.removeItem(makeKey(id)); return null; }
    if (now() - entry.ts > TTL_MS) { localStorage.removeItem(makeKey(id)); return null; }
    return entry.data;
  } catch {
    return null;
  }
}

export function cacheUpdatePayment(id: string, payment_method: string | null): void {
  try {
    const raw = localStorage.getItem(makeKey(id));
    if (!raw) return;
    const entry = JSON.parse(raw) as CacheEntry<InvoiceDetail>;
    if (!entry?.data?.invoice) return;
    entry.data.invoice.payment_method = payment_method;
    entry.ts = now();
    localStorage.setItem(makeKey(id), JSON.stringify(entry));
  } catch {}
}

export function cachePurge(id: string): void {
  try { localStorage.removeItem(makeKey(id)); } catch {}
}

// Fingerprint store untuk seeding: simpan sidik perubahan selama 24 jam terakhir
const FP_KEY = "invoice:fingerprint:last24";
export function setLastFingerprint(fp: string): void {
  try { localStorage.setItem(FP_KEY, JSON.stringify({ ts: now(), fp })); } catch {}
}
export function getLastFingerprint(): string | null {
  try {
    const raw = localStorage.getItem(FP_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as { ts: number; fp: string };
    if (!o?.ts || !o?.fp) return null;
    // Fingerprint boleh lebih lama dari TTL cache item, tapi tetap batasi 24 jam agar tidak basi
    if (now() - o.ts > TTL_MS) return null;
    return o.fp;
  } catch { return null; }
}

// Util untuk membersihkan semua entry yang sudah kadaluarsa (opsional)
export function purgeExpired(): void {
  try {
    const keys: string[] = Object.keys(localStorage);
    const nowMs = now();
    for (const k of keys) {
      if (!k.startsWith(PREFIX)) continue;
      const raw = localStorage.getItem(k);
      if (!raw) continue;
      try {
        const entry = JSON.parse(raw) as CacheEntry<InvoiceDetail>;
        if (!entry?.ts || nowMs - entry.ts > TTL_MS) localStorage.removeItem(k);
      } catch { localStorage.removeItem(k); }
    }
  } catch {}
}