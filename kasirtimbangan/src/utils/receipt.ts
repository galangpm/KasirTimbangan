// Shared receipt builder for 58mm text output
const RECEIPT_WIDTH = 32;
function padRight(str: string, len: number) {
  if (str.length >= len) return str.slice(0, len);
  return str + " ".repeat(len - str.length);
}
function center(str: string, width = RECEIPT_WIDTH) {
  const s = str.slice(0, width);
  const space = Math.max(0, Math.floor((width - s.length) / 2));
  return " ".repeat(space) + s;
}
// Wrap text to specified width, preserving words and handling very long tokens
function wrapText(input: string, width = RECEIPT_WIDTH): string[] {
  const src = String(input || "");
  const paragraphs = src.split(/\r?\n/);
  const out: string[] = [];
  for (const p of paragraphs) {
    const words = p.split(/\s+/).filter(Boolean);
    let line = "";
    for (const w of words) {
      if (w.length > width) {
        if (line) { out.push(line); line = ""; }
        for (let i = 0; i < w.length; i += width) {
          out.push(w.slice(i, i + width));
        }
        continue;
      }
      const nextLen = (line ? line.length + 1 : 0) + w.length;
      if (nextLen > width) { out.push(line); line = w; }
      else { line = line ? `${line} ${w}` : w; }
    }
    if (line) out.push(line);
  }
  return out.length ? out : [src.slice(0, width)];
}
function sep(width = RECEIPT_WIDTH) { return "-".repeat(width); }
function formatCurrencyIDR(n: number) { return `Rp ${Number(n || 0).toLocaleString("id-ID")}`; }
function formatWeight3(n: number) { return Number(n || 0).toLocaleString("id-ID", { minimumFractionDigits: 3 }); }

export interface InvoiceHeader { id: string; created_at: string; payment_method: string | null; notes?: string | null }
export interface InvoiceItemRow { id: string; fruit: string; weight_kg: number; price_per_kg: number; total_price: number; quantity?: number; }

export function buildReceipt58(
  data: { invoice: InvoiceHeader; items: InvoiceItemRow[] } | null,
  settings: { name: string; address: string; phone: string; receiptFooter: string } | null,
  cashierName?: string,
  customerName?: string,
  options?: { escPosFormatting?: boolean }
): string {
  if (!data) return "Nota kosong";
  const name = settings?.name || "Kasir Timbangan";
  const address = settings?.address || "";
  const phone = settings?.phone || "";
  const invId = String(data.invoice.id);
  const tanggal = new Date(data.invoice.created_at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });
  const metode = data.invoice.payment_method ?? "-";
  const kasir = (cashierName || "").trim();
  const pelanggan = (customerName || "").trim();

  const lines: string[] = [];
  if (options?.escPosFormatting) {
    const alignCenter = "\x1B\x61\x01"; // ESC a 1
    const alignLeft = "\x1B\x61\x00";  // ESC a 0
    const doubleSize = "\x1D\x21\x11"; // GS ! 0x11 (double width + height)
    const normalSize = "\x1D\x21\x00"; // GS ! 0
    const boldOn = "\x1B\x45\x01";     // ESC E 1
    const boldOff = "\x1B\x45\x00";    // ESC E 0
    lines.push(alignCenter + doubleSize + boldOn + center(name) + boldOff + normalSize + alignLeft);
  } else {
    lines.push(center(name));
  }
  if (address) {
    for (const l of wrapText(address)) lines.push(center(l));
  }
  if (phone) lines.push(center(`Telp: ${phone}`));
  lines.push(sep());
  lines.push(padRight(`ID: ${invId}`, RECEIPT_WIDTH));
  lines.push(padRight(`Tanggal: ${tanggal}`, RECEIPT_WIDTH));
  lines.push(padRight(`Metode: ${metode}`, RECEIPT_WIDTH));
  if (kasir) lines.push(padRight(`Kasir: ${kasir}`, RECEIPT_WIDTH));
  if (pelanggan) lines.push(padRight(`Pelanggan: ${pelanggan}`, RECEIPT_WIDTH));
  if (data.invoice.notes && (data.invoice.payment_method === "tester" || data.invoice.payment_method === "gift")) {
    lines.push(padRight(`Catatan: ${data.invoice.notes}`, RECEIPT_WIDTH));
  }
  lines.push(sep());
  for (const it of (data.items || [])) {
    const fruit = String(it.fruit);
    const totalStr = formatCurrencyIDR(Number(it.total_price));
    const left = fruit.length > 18 ? fruit.slice(0, 18) : fruit;
    const line1 = (() => {
      const l = left;
      const r = totalStr;
      const spaces = Math.max(0, RECEIPT_WIDTH - l.length - r.length);
      return l + " ".repeat(spaces) + r;
    })();
    const qtyStr = `Qty ${Number(it.quantity || 1)}`;
    const weightStr = `${formatWeight3(Number(it.weight_kg))} kg`;
    const priceStr = `${formatCurrencyIDR(Number(it.price_per_kg))}/kg`;
    const line2 = padRight(`  ${qtyStr} | ${weightStr} x ${priceStr}`, RECEIPT_WIDTH);
    lines.push(line1);
    lines.push(line2);
  }
  lines.push(sep());
  const totalQty = (data.items || []).reduce((acc: number, it: InvoiceItemRow) => acc + Number(it.quantity || 1), 0);
  const totalWeight = (data.items || []).reduce((acc: number, it: InvoiceItemRow) => acc + Number(it.weight_kg || 0), 0);
  const totalVal = (data.items || []).reduce((acc: number, it: InvoiceItemRow) => acc + Number(it.total_price || 0), 0);
  const totalQtyLine = (() => {
    const label = "TOTAL QTY";
    const value = String(totalQty);
    const spaces = Math.max(0, RECEIPT_WIDTH - label.length - value.length);
    return label + " ".repeat(spaces) + value;
  })();
  const totalWeightLine = (() => {
    const label = "TOTAL BERAT";
    const value = `${formatWeight3(totalWeight)} kg`;
    const spaces = Math.max(0, RECEIPT_WIDTH - label.length - value.length);
    return label + " ".repeat(spaces) + value;
  })();
  const totalLine = (() => {
    const label = "TOTAL";
    const value = formatCurrencyIDR(totalVal);
    const spaces = Math.max(0, RECEIPT_WIDTH - label.length - value.length);
    return label + " ".repeat(spaces) + value;
  })();
  lines.push(totalQtyLine);
  lines.push(totalWeightLine);
  lines.push(totalLine);
  lines.push(sep());
  const footer = settings?.receiptFooter || "Terima kasih!";
  const footerLines = footer.split(/\r?\n/);
  for (const fl of footerLines) lines.push(center(fl));
  lines.push("");
  lines.push("");
  return lines.join("\n");
}