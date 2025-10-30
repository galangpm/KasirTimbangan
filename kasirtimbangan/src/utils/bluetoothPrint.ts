interface WebBluetooth {
  requestDevice(options: { acceptAllDevices: boolean; optionalServices?: Array<number | string> }): Promise<BluetoothDevice>;
}
interface BluetoothDevice {
  gatt: BluetoothGATTServer | null;
}
interface BluetoothGATTServer {
  connect(): Promise<BluetoothGATTServer>;
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

export async function connectAndPrint(text: string) {
  const n = navigator as Navigator & { bluetooth?: WebBluetooth };
  if (!n.bluetooth) throw new Error("Web Bluetooth tidak didukung");
  const COMMON_BLE_PRINTER_SERVICES = [
    "battery_service",
    "device_information",
    // Vendor-specific UUIDs yang umum pada printer BLE murah
    "0000ffe0-0000-1000-8000-00805f9b34fb",
    "0000ffe1-0000-1000-8000-00805f9b34fb",
    "0000ffe5-0000-1000-8000-00805f9b34fb",
    "000018f0-0000-1000-8000-00805f9b34fb",
    // Tambahan umum untuk UART transparan
    "0000fff0-0000-1000-8000-00805f9b34fb",
    "0000fff1-0000-1000-8000-00805f9b34fb",
  ];
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
  // Cari characteristic writable pertama
  for (const svc of services) {
    const chars = await svc.getCharacteristics();
    for (const ch of chars) {
      try {
        const props = ch.properties;
        if (props.write || props.writeWithoutResponse) {
          const encoder = new TextEncoder();
          const init = new Uint8Array([0x1B, 0x40]); // ESC @ init
          // tulis init dengan metode yang didukung
          if (props.writeWithoutResponse && typeof ch.writeValueWithoutResponse === "function") await ch.writeValueWithoutResponse(init);
          else await ch.writeValue(init);

          const payload = encoder.encode(text + "\n\n");
          // Gunakan write tanpa response jika tersedia untuk kompatibilitas
          if (props.writeWithoutResponse && typeof ch.writeValueWithoutResponse === "function") await ch.writeValueWithoutResponse(payload);
          else await ch.writeValue(payload);
          return;
        }
      } catch {
        // lanjutkan jika characteristic gagal ditulis
      }
    }
  }
  throw new Error("Tidak menemukan characteristic BLE yang dapat ditulis untuk printer");
}

// Helper: temukan characteristic BLE yang bisa ditulis
async function findWritableCharacteristic(): Promise<BluetoothRemoteGATTCharacteristic> {
  const n = navigator as Navigator & { bluetooth?: WebBluetooth };
  if (!n.bluetooth) throw new Error("Web Bluetooth tidak didukung");
  const COMMON_BLE_PRINTER_SERVICES = [
    "battery_service",
    "device_information",
    // Vendor-specific UUIDs yang umum pada printer BLE murah
    "0000ffe0-0000-1000-8000-00805f9b34fb",
    "0000ffe1-0000-1000-8000-00805f9b34fb",
    "0000ffe5-0000-1000-8000-00805f9b34fb",
    "000018f0-0000-1000-8000-00805f9b34fb",
    "0000fff0-0000-1000-8000-00805f9b34fb",
    "0000fff1-0000-1000-8000-00805f9b34fb",
  ];
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
  for (const svc of services) {
    const chars = await svc.getCharacteristics();
    for (const ch of chars) {
      const props = ch.properties;
      if (props.write || props.writeWithoutResponse) {
        return ch;
      }
    }
  }
  throw new Error("Tidak menemukan characteristic BLE yang dapat ditulis untuk printer");
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