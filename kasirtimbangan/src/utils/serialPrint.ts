// Util Web Serial untuk cetak ke printer Bluetooth Classic melalui COM port
// Catatan: Pastikan printer dipasangkan di OS dan memiliki COM port (SPP)

export type SerialOpenOptions = {
  baudRate?: number;
  dataBits?: 7 | 8;
  stopBits?: 1 | 2;
  parity?: "none" | "even" | "odd";
  flowControl?: "none" | "hardware";
};

// Minta user memilih port serial (COM) via Web Serial
export async function requestSerialPort(): Promise<any> {
  const n = navigator as Navigator & { serial?: any };
  if (!n.serial) throw new Error("Web Serial tidak didukung oleh browser");
  const port = await n.serial.requestPort();
  return port;
}

// Buka port dengan opsi umum printer thermal
export async function openSerialPort(port: any, options?: SerialOpenOptions) {
  const opt: SerialOpenOptions = {
    baudRate: options?.baudRate ?? 9600,
    dataBits: options?.dataBits ?? 8,
    stopBits: options?.stopBits ?? 1,
    parity: options?.parity ?? "none",
    flowControl: options?.flowControl ?? "none",
  };
  await port.open(opt);
}

// Tulis bytes ke port secara aman (dengan jeda kecil)
export async function writeSerial(port: any, data: Uint8Array) {
  if (!port?.writable) throw new Error("Port belum siap untuk menulis");
  const writer = port.writable.getWriter();
  try {
    // Banyak printer classic menerima stream langsung tanpa batasan 20 byte seperti BLE.
    // Namun, beberapa stack SPP lebih stabil jika diberi jeda kecil.
    await writer.write(data);
  } finally {
    writer.releaseLock();
  }
}

export async function closeSerialPort(port: any) {
  try { await port?.close?.(); } catch {}
}

// Cetak teks sederhana: inisialisasi ESC @ lalu kirim baris teks
export async function serialPrintText(port: any, text: string) {
  const init = new Uint8Array([0x1B, 0x40]);
  const enc = new TextEncoder();
  const payload = enc.encode(text + "\n\n");
  await writeSerial(port, init);
  await writeSerial(port, payload);
}

// Gabungkan alur: pilih port, buka, cetak, tutup
export async function serialConnectAndPrint(text: string, options?: SerialOpenOptions) {
  const port = await requestSerialPort();
  await openSerialPort(port, options);
  try {
    await serialPrintText(port, text);
  } finally {
    await closeSerialPort(port);
  }
}