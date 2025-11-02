interface WebBluetooth {
  requestDevice(options: { acceptAllDevices: boolean; optionalServices?: Array<number | string> }): Promise<BluetoothDevice>;
}
interface BluetoothDevice {
  gatt: BluetoothGATTServer | null;
}
interface BluetoothGATTServer {
  connect(): Promise<BluetoothGATTServer>;
  getPrimaryService(uuid: any): Promise<BluetoothRemoteGATTService>;
  getPrimaryServices(): Promise<BluetoothRemoteGATTService[]>;
}
interface BluetoothRemoteGATTService {
  getCharacteristics(): Promise<BluetoothRemoteGATTCharacteristic[]>;
}
interface BluetoothRemoteGATTCharacteristic {
  properties: { write?: boolean; writeWithoutResponse?: boolean };
  writeValue(data: BufferSource): Promise<void>;
  // Beberapa perangkat hanya mendukung write tanpa response
  writeValueWithoutResponse?(data: BufferSource): Promise<void>;
}

// Layanan BLE umum untuk printer thermal (vendor transparan UART, NUS, FFE0/FFE1)
const COMMON_BLE_PRINTER_SERVICES: string[] = [
  "battery_service",
  "device_information",
  // Vendor-specific UUIDs umum pada printer BLE murah
  "0000ffe0-0000-1000-8000-00805f9b34fb",
  "0000ffe1-0000-1000-8000-00805f9b34fb",
  "0000ffe5-0000-1000-8000-00805f9b34fb",
  "000018f0-0000-1000-8000-00805f9b34fb",
  "0000fff0-0000-1000-8000-00805f9b34fb",
  "0000fff1-0000-1000-8000-00805f9b34fb",
  // Nordic UART Service
  "6e400001-b5a3-f393-e0a9-e50e24dcca9e",
  // ISSC Transparent UART (yang Anda temukan: 49535343-fe7d-...)
  "49535343-fe7d-4ae5-8fa9-9fafd205e455",
  // Varian lain (AE00/AE10)
  "0000ae00-0000-1000-8000-00805f9b34fb",
  "0000ae10-0000-1000-8000-00805f9b34fb",
];

export async function connectAndPrint(text: string) {
  const n = navigator as Navigator & { bluetooth?: WebBluetooth };
  if (!n.bluetooth) throw new Error("Web Bluetooth tidak didukung");
  const device = await n.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: COMMON_BLE_PRINTER_SERVICES });
  const server = await device.gatt!.connect();
  let services: BluetoothRemoteGATTService[] = [];
  try {
    services = await server.getPrimaryServices();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("optionalServices") || msg.includes("web-bluetooth")) {
      throw new Error("Akses layanan BLE dibatasi oleh browser. Coba pilih perangkat lagi. Jika masih gagal, pastikan UUID layanan printer terdaftar pada optionalServices.");
    }
    throw e;
  }
  // Fallback: jika enumerasi layanan kosong, coba ambil layanan berdasarkan UUID yang umum
  if (!services || services.length === 0) {
    const tmp: BluetoothRemoteGATTService[] = [];
    for (const id of COMMON_BLE_PRINTER_SERVICES) {
      try {
        const s = await server.getPrimaryService(id as any);
        if (s) tmp.push(s);
      } catch {}
    }
    services = tmp;
  }
  // Kumpulkan kandidat characteristic lalu prioritaskan yang paling kompatibel
  type Cand = { ch: BluetoothRemoteGATTCharacteristic; uuid: string; score: number };
  const candidates: Cand[] = [];
  for (const svc of services) {
    const chars = await svc.getCharacteristics();
    for (const ch of chars) {
      const props = ch.properties;
      const uuid = (ch as any).uuid?.toLowerCase?.() || "";
      const canWrite = props.write || props.writeWithoutResponse;
      if (!canWrite) continue;
      let score = props.writeWithoutResponse ? 10 : 5;
      if (uuid.includes("6daa")) score += 5; // ISSC TX
      if (uuid.includes("8841")) score += 3;
      if (uuid.includes("aca3")) score += 2;
      candidates.push({ ch, uuid, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  for (const cand of candidates) {
    try {
      const enc = new TextEncoder();
      const init = new Uint8Array([0x1B, 0x40]); // ESC @ init
      await writeChunks(cand.ch, init);
      const payload = enc.encode(text + "\n\n");
      await writeChunks(cand.ch, payload);
      return;
    } catch {
      // coba kandidat berikutnya
    }
  }
  throw new Error("Tidak menemukan characteristic BLE yang dapat ditulis untuk printer");
}

// Helper: temukan characteristic BLE yang bisa ditulis
async function findWritableCharacteristic(): Promise<BluetoothRemoteGATTCharacteristic> {
  const n = navigator as Navigator & { bluetooth?: WebBluetooth };
  if (!n.bluetooth) throw new Error("Web Bluetooth tidak didukung");
  const device = await n.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: COMMON_BLE_PRINTER_SERVICES });
  const server = await device.gatt!.connect();
  let services: BluetoothRemoteGATTService[] = [];
  try {
    services = await server.getPrimaryServices();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("optionalServices") || msg.includes("web-bluetooth")) {
      throw new Error("Akses layanan BLE dibatasi oleh browser. Tambahkan UUID layanan printer ke optionalServices atau pilih ulang perangkat.");
    }
    throw e;
  }
  // Fallback: ambil layanan secara langsung bila enumerasi kosong
  if (!services || services.length === 0) {
    const tmp: BluetoothRemoteGATTService[] = [];
    for (const id of COMMON_BLE_PRINTER_SERVICES) {
      try {
        const s = await server.getPrimaryService(id as any);
        if (s) tmp.push(s);
      } catch {}
    }
    services = tmp;
  }
  type Cand = { ch: BluetoothRemoteGATTCharacteristic; uuid: string; score: number };
  const candidates: Cand[] = [];
  for (const svc of services) {
    const chars = await svc.getCharacteristics();
    for (const ch of chars) {
      const props = ch.properties;
      const uuid = (ch as any).uuid?.toLowerCase?.() || "";
      const canWrite = props.write || props.writeWithoutResponse;
      if (!canWrite) continue;
      let score = props.writeWithoutResponse ? 10 : 5;
      if (uuid.includes("6daa")) score += 5;
      if (uuid.includes("8841")) score += 3;
      if (uuid.includes("aca3")) score += 2;
      candidates.push({ ch, uuid, score });
    }
  }
  if (candidates.length === 0) throw new Error("Tidak menemukan characteristic BLE yang dapat ditulis untuk printer");
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0].ch;
}

// Helper: tulis data besar dalam beberapa chunk agar aman untuk BLE
async function writeChunks(ch: BluetoothRemoteGATTCharacteristic, data: Uint8Array, chunkSize = 20) {
  for (let i = 0; i < data.length; i += chunkSize) {
    const slice = data.slice(i, Math.min(i + chunkSize, data.length));
    // Prefer write tanpa response bila didukung
    if (ch.properties.writeWithoutResponse && typeof ch.writeValueWithoutResponse === "function") {
      await ch.writeValueWithoutResponse(slice);
    } else {
      await ch.writeValue(slice);
    }
    // beri jeda kecil agar perangkat tidak kewalahan
    await new Promise((r) => setTimeout(r, 5));
  }
}

function buildEscPosQrBytes(payload: string, size = 6, ecc: "L" | "M" | "Q" | "H" = "M"): Uint8Array {
  const enc = new TextEncoder();
  const dataBytes = enc.encode(payload);
  const modelCmd = new Uint8Array([0x1D, 0x28, 0x6B, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00]); // Model 2
  const sizeCmd = new Uint8Array([0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x43, Math.max(1, Math.min(16, size))]);
  const eccMap = { L: 48, M: 49, Q: 50, H: 51 } as const;
  const eccCmd = new Uint8Array([0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x45, eccMap[ecc]]);
  const storeLen = dataBytes.length + 3;
  const pL = storeLen & 0xff;
  const pH = (storeLen >> 8) & 0xff;
  const storeHeader = new Uint8Array([0x1D, 0x28, 0x6B, pL, pH, 0x31, 0x50, 0x30]);
  const printCmd = new Uint8Array([0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x51, 0x30]);
  const alignCenter = new Uint8Array([0x1B, 0x61, 0x01]);
  const alignLeft = new Uint8Array([0x1B, 0x61, 0x00]);
  // Gabungkan semua bagian
  const totalLen = alignCenter.length + modelCmd.length + sizeCmd.length + eccCmd.length + storeHeader.length + dataBytes.length + printCmd.length + alignLeft.length;
  const out = new Uint8Array(totalLen);
  let off = 0;
  const push = (arr: Uint8Array) => { out.set(arr, off); off += arr.length; };
  push(alignCenter);
  push(modelCmd);
  push(sizeCmd);
  push(eccCmd);
  push(storeHeader);
  push(dataBytes);
  push(printCmd);
  push(alignLeft);
  return out;
}

// Cetak nota (teks) lalu QR UUID dengan ukuran yang jelas agar mudah dipindai
export async function connectAndPrintTextAndQR(text: string, qrUuid: string) {
  const ch = await findWritableCharacteristic();
  const enc = new TextEncoder();
  // Inisialisasi printer
  await writeChunks(ch, new Uint8Array([0x1B, 0x40]));
  const textBytes = enc.encode(text + "\n\n");
  await writeChunks(ch, textBytes);
  const qrBytes = buildEscPosQrBytes(qrUuid, 6, "M"); // ukuran modul 6, ECC M
  await writeChunks(ch, qrBytes);
  const tail = enc.encode("\n\n");
  await writeChunks(ch, tail);
}

// Versi dengan cache characteristic dan penanganan error yang lebih informatif.
// Gunakan ini untuk cetak otomatis setelah memilih pembayaran agar lebih stabil.
let _cachedCharacteristic: BluetoothRemoteGATTCharacteristic | null = null;
export function resetPrinterCache() { _cachedCharacteristic = null; }
export function hasPrinterCache() { return !!_cachedCharacteristic; }
export async function printReceiptWithBluetooth(text: string, qrUuid: string) {
  const enc = new TextEncoder();
  let ch = _cachedCharacteristic;
  if (!ch) {
    try {
      ch = await findWritableCharacteristic();
      _cachedCharacteristic = ch;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      const name = (e as any)?.name || "";
      if (name === "NotAllowedError" || msg.toLowerCase().includes("user gesture")) {
        throw new Error("Izin Bluetooth diperlukan. Klik tombol 'Cetak Nota' secara manual untuk menyambungkan printer, lalu coba lagi.");
      }
      if (name === "NotFoundError" || msg.toLowerCase().includes("no devices found")) {
        throw new Error("Perangkat printer BLE tidak ditemukan. Pastikan printer menyala dan dalam mode pairing.");
      }
      throw e as any;
    }
  }
  // Inisialisasi printer
  await writeChunks(ch, new Uint8Array([0x1B, 0x40]));
  const textBytes = enc.encode(text + "\n\n");
  await writeChunks(ch, textBytes);
  const qrBytes = buildEscPosQrBytes(qrUuid, 6, "M");
  await writeChunks(ch, qrBytes);
  const tail = enc.encode("\n\n");
  await writeChunks(ch, tail);
}