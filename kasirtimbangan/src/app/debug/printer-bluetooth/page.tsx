"use client";

import React, { useCallback, useEffect, useState } from "react";

// Stub tipe Web Bluetooth lokal agar TypeScript build tidak error
// (Beberapa lingkungan tidak menyertakan lib.dom Web Bluetooth secara default)
type BluetoothCharacteristicProperties = {
  read?: boolean;
  write?: boolean;
  writeWithoutResponse?: boolean;
  notify?: boolean;
  indicate?: boolean;
};
type BluetoothRemoteGATTCharacteristic = {
  uuid: string;
  properties?: BluetoothCharacteristicProperties;
  writeValue?: (data: BufferSource) => Promise<void>;
  writeValueWithoutResponse?: (data: BufferSource) => Promise<void>;
  startNotifications?: () => Promise<void>;
  addEventListener?: (type: string, listener: any) => void;
};
type BluetoothRemoteGATTService = {
  uuid: string;
  getCharacteristic?: (uuid: any) => Promise<BluetoothRemoteGATTCharacteristic>;
  getCharacteristics: () => Promise<BluetoothRemoteGATTCharacteristic[]>;
};
type BluetoothRemoteGATTServer = {
  connected?: boolean;
  disconnect?: () => void;
  connect: () => Promise<BluetoothRemoteGATTServer>;
  getPrimaryService: (uuid: any) => Promise<BluetoothRemoteGATTService>;
  getPrimaryServices: () => Promise<BluetoothRemoteGATTService[]>;
};
type BluetoothDevice = {
  id?: string;
  name?: string;
  gatt: BluetoothRemoteGATTServer | null;
};

type AnyDevice = BluetoothDevice & { id?: string; name?: string };

const COMMON_BLE_PRINTER_SERVICES = [
  "battery_service",
  "device_information",
  // Vendor-specific UUIDs umum pada printer BLE murah
  "0000ffe0-0000-1000-8000-00805f9b34fb",
  "0000ffe1-0000-1000-8000-00805f9b34fb",
  "0000ffe5-0000-1000-8000-00805f9b34fb",
  "000018f0-0000-1000-8000-00805f9b34fb",
  "0000fff0-0000-1000-8000-00805f9b34fb",
  "0000fff1-0000-1000-8000-00805f9b34fb",
  // Tambahan umum untuk UART/NUS dan layanan transparan
  "6e400001-b5a3-f393-e0a9-e50e24dcca9e",
  "6e400002-b5a3-f393-e0a9-e50e24dcca9e",
  "6e400003-b5a3-f393-e0a9-e50e24dcca9e",
  "49535343-fe7d-4ae5-8fa9-9fafd205e455",
  "0000ae00-0000-1000-8000-00805f9b34fb",
  "0000ae01-0000-1000-8000-00805f9b34fb",
  "0000ae02-0000-1000-8000-00805f9b34fb",
  "0000ae03-0000-1000-8000-00805f9b34fb",
  "0000ae10-0000-1000-8000-00805f9b34fb",
  "0000ae11-0000-1000-8000-00805f9b34fb",
];

function propsToList(p: BluetoothCharacteristicProperties | undefined) {
  if (!p) return [] as string[];
  const out: string[] = [];
  if ((p as any).read) out.push("read");
  if ((p as any).write) out.push("write");
  if ((p as any).writeWithoutResponse) out.push("writeWithoutResponse");
  if ((p as any).notify) out.push("notify");
  if ((p as any).indicate) out.push("indicate");
  return out;
}

// Skor characteristic untuk menentukan prioritas penulisan
function scoreCharacteristic(ch: BluetoothRemoteGATTCharacteristic): number {
  const p: any = (ch as any).properties || {};
  const uuid = String((ch as any).uuid || "").toLowerCase();
  let score = 0;
  if (p.writeWithoutResponse) score += 10;
  if (p.write) score += 5;
  if (uuid.includes("6daa")) score += 5;
  if (uuid.includes("8841")) score += 3;
  if (uuid.includes("aca3")) score += 2;
  return score;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Tulis data dalam chunk untuk stabilitas BLE (khusus Android)
async function writeChunksBLE(ch: BluetoothRemoteGATTCharacteristic, data: Uint8Array, chunkSize = 20) {
  for (let i = 0; i < data.length; i += chunkSize) {
    const slice = data.slice(i, Math.min(i + chunkSize, data.length));
    const props: any = (ch as any).properties || {};
    if (props.writeWithoutResponse && typeof (ch as any).writeValueWithoutResponse === "function") {
      await (ch as any).writeValueWithoutResponse(slice);
    } else {
      await (ch as any).writeValue(slice);
    }
    await sleep(5);
  }
}

export default function PrinterBluetoothDebugPage() {
  const [device, setDevice] = useState<AnyDevice | null>(null);
  const [server, setServer] = useState<BluetoothRemoteGATTServer | null>(null);
  const [services, setServices] = useState<BluetoothRemoteGATTService[]>([]);
  const [svcMeta, setSvcMeta] = useState<Record<string, { uuid: string; props: string[] }[]>>({});
  const [writableChar, setWritableChar] = useState<BluetoothRemoteGATTCharacteristic | null>(null);
  const [batteryLevel, setBatteryLevel] = useState<number | null>(null);
  const [disInfo, setDisInfo] = useState<Record<string, string | undefined>>({});
  const [error, setError] = useState<string | null>(null);
  const [expectedId, setExpectedId] = useState<string>("");
  const [useISSCFilter, setUseISSCFilter] = useState<boolean>(true);
  const [selectedCharUuid, setSelectedCharUuid] = useState<string>("");
  const [notifStatus, setNotifStatus] = useState<Record<string, boolean>>({});

  const [isSupported, setIsSupported] = useState<boolean | null>(null);
  useEffect(() => {
    setIsSupported(!!(navigator as any)?.bluetooth);
    // muat identifier target dari localStorage jika ada
    try {
      const saved = localStorage.getItem("preferred_printer_identifier");
      if (saved) setExpectedId(saved);
    } catch {}
  }, []);

  const connect = useCallback(async () => {
    setError(null);
    try {
      const n = navigator as Navigator & { bluetooth?: any };
      if (!n.bluetooth) throw new Error("Web Bluetooth tidak didukung oleh browser");
      const reqOpts = useISSCFilter
        ? { filters: [{ services: ["49535343-fe7d-4ae5-8fa9-9fafd205e455"] }], optionalServices: COMMON_BLE_PRINTER_SERVICES }
        : { acceptAllDevices: true, optionalServices: COMMON_BLE_PRINTER_SERVICES };
      const dev: AnyDevice = await n.bluetooth.requestDevice(reqOpts as any);
      const srv = await dev.gatt!.connect();
      let svcs: BluetoothRemoteGATTService[] = [];
      try {
        svcs = await srv.getPrimaryServices();
      } catch (e: any) {
        const msg = e?.message ?? String(e);
        if (msg.includes("optionalServices") || msg.includes("web-bluetooth")) {
          throw new Error("Akses layanan BLE dibatasi. Pastikan UUID layanan printer ada di optionalServices.");
        }
        throw e;
      }
      // Fallback: jika enumerasi layanan kosong, coba ambil layanan spesifik berdasarkan UUID yang umum
      if (!svcs || svcs.length === 0) {
        const tmp: BluetoothRemoteGATTService[] = [];
        for (const id of COMMON_BLE_PRINTER_SERVICES) {
          try {
            const s = await srv.getPrimaryService(id as any);
            if (s) tmp.push(s);
          } catch {}
        }
        svcs = tmp;
        if (svcs.length === 0) {
          throw new Error(
            "Tidak ada layanan BLE terdeteksi pada perangkat. Kemungkinan perangkat Bluetooth Classic (bukan BLE) atau UUID layanan belum ditambahkan. Coba: matikan/nyalakan perangkat, hapus pairing dari pengaturan OS, lalu pilih ulang."
          );
        }
      }
      // Kumpulkan semua characteristic lalu pilih yang paling kompatibel
      let writable: BluetoothRemoteGATTCharacteristic | null = null;
      const candidates: BluetoothRemoteGATTCharacteristic[] = [];
      const meta: Record<string, { uuid: string; props: string[] }[]> = {};
      for (const svc of svcs) {
        const chars = await svc.getCharacteristics();
        meta[svc.uuid] = chars.map((ch) => ({ uuid: ch.uuid, props: propsToList((ch as any).properties) }));
        for (const ch of chars) {
          const p = (ch as any).properties || {};
          if (p.write || p.writeWithoutResponse) candidates.push(ch);
        }
      }
      candidates.sort((a, b) => scoreCharacteristic(b) - scoreCharacteristic(a));
      writable = candidates[0] || null;

      // Baca Serial Number dari Device Information secara otomatis saat pairing
      try {
        let disSvc: BluetoothRemoteGATTService | null = null;
        try { disSvc = await srv.getPrimaryService("device_information"); } catch {}
        if (!disSvc) {
          const found = svcs.find((s) => s.uuid.toLowerCase().includes("180a") || s.uuid.toLowerCase().includes("device_information"));
          if (found) disSvc = found;
        }
        if (disSvc) {
          let ch: BluetoothRemoteGATTCharacteristic | null = null;
          // Coba akses via alias string
          try { ch = await (disSvc as any).getCharacteristic?.("serial_number_string"); } catch {}
          if (!ch) {
            // Fallback: cari characteristic dengan UUID 0x2A25
            try {
              const chars = await disSvc.getCharacteristics();
              ch = chars.find((c) => c.uuid.toLowerCase().includes("2a25")) ?? null;
            } catch {}
          }
          if (ch && (ch as any).readValue) {
            try {
              const dv: DataView = await (ch as any).readValue();
              const dec = new TextDecoder("utf-8");
              const sn = dec.decode(dv.buffer).replace(/\0+$/, "");
              setDisInfo((prev) => ({ ...prev, serialNumber: sn }));
            } catch {}
          }
        }
      } catch {}

      setDevice(dev);
      setServer(srv);
      setServices(svcs);
      setSvcMeta(meta);
      setWritableChar(writable);
      setSelectedCharUuid(writable?.uuid || "");
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  }, []);

  const disconnect = useCallback(() => {
    try {
      server?.disconnect?.();
    } catch {}
    setWritableChar(null);
    setServices([]);
    setServer(null);
  }, [server]);

  const readBattery = useCallback(async () => {
    setError(null);
    try {
      if (!server) throw new Error("Belum terhubung ke perangkat");
      const batt = await server.getPrimaryService("battery_service");
      const lvlChar = await (batt as any).getCharacteristic?.("battery_level");
      if (!lvlChar || !(lvlChar as any).readValue) throw new Error("Karakteristik battery_level tidak tersedia");
      const dv: DataView = await (lvlChar as any).readValue();
      const lvl = dv.getUint8(0);
      setBatteryLevel(lvl);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  }, [server]);

  const readDIS = useCallback(async () => {
    setError(null);
    try {
      if (!server) throw new Error("Belum terhubung ke perangkat");
      let disSvc: BluetoothRemoteGATTService | null = null;
      try { disSvc = await server.getPrimaryService("device_information"); } catch {}
      if (!disSvc) {
        const found = services.find((s) => s.uuid.toLowerCase().includes("180a") || s.uuid.toLowerCase().includes("device_information"));
        if (found) disSvc = found;
      }
      if (!disSvc) throw new Error("Layanan Device Information (0x180A) tidak ditemukan");
      const readStr = async (uuidOrAlias: string) => {
        try {
          const ch = await (disSvc as any).getCharacteristic(uuidOrAlias);
          const dv: DataView = await (ch as any).readValue();
          const bytes = new Uint8Array(dv.buffer);
          const text = new TextDecoder("utf-8").decode(bytes).replace(/\0/g, "");
          return text;
        } catch { return undefined; }
      };
      const info = {
        manufacturer: await readStr("manufacturer_name_string"),
        model: await readStr("model_number_string"),
        serialNumber: await readStr("serial_number_string"),
        hardwareRevision: await readStr("hardware_revision_string"),
        firmwareRevision: await readStr("firmware_revision_string"),
        softwareRevision: await readStr("software_revision_string"),
      };
      setDisInfo(info);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  }, [server, services]);

  const testPrint = useCallback(async () => {
    setError(null);
    try {
      if (!writableChar) throw new Error("Tidak ada characteristic writable untuk tes cetak");
      const init = new Uint8Array([0x1B, 0x40]);
      const enc = new TextEncoder();
      const text = enc.encode("Tes Cetak dari Halaman Debug\n\n");
      await writeChunksBLE(writableChar, init);
      await writeChunksBLE(writableChar, text);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  }, [writableChar]);

  const useCharacteristic = useCallback(async (uuid: string) => {
    try {
      // Cari characteristic dengan UUID yang dipilih
      for (const svc of services) {
        const chars = await svc.getCharacteristics();
        const found = chars.find((c) => c.uuid === uuid);
        if (found) {
          setWritableChar(found);
          setSelectedCharUuid(uuid);
          return;
        }
      }
    } catch {}
  }, [services]);

  const startNotify = useCallback(async (uuid: string) => {
    try {
      if (!server) throw new Error("Belum terhubung");
      // Temukan characteristic dengan UUID dan aktifkan notifikasi
      for (const svc of services) {
        const chars = await svc.getCharacteristics();
        const ch = chars.find((c) => c.uuid === uuid);
        if (ch) {
          await (ch as any).startNotifications?.();
          (ch as any).addEventListener?.("characteristicvaluechanged", (ev: any) => {
            const dv: DataView = ev.target?.value || ev.detail?.value;
            if (!dv) return;
            const bytes = new Uint8Array(dv.buffer);
            console.log("Notif[", uuid, "]:", bytes);
          });
          setNotifStatus((prev) => ({ ...prev, [uuid]: true }));
          return;
        }
      }
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  }, [services, server]);

  return (
    <div>
      <h1 className="text-xl font-bold">Debug Printer Bluetooth</h1>
      {isSupported === false && (
        <p className="text-red-600">Browser tidak mendukung Web Bluetooth. Coba Chrome/Edge di Android/desktop.</p>
      )}
      {error && <p className="text-red-600">Error: {error}</p>}

      <div className="flex flex-wrap gap-2 my-3 items-center">
        <button onClick={connect} className="neo-button">🔌 Pilih & Hubungkan</button>
        <button onClick={disconnect} className={`neo-button danger ${!server ? "opacity-50 cursor-not-allowed" : ""}`} disabled={!server}>❌ Putuskan</button>
        <button onClick={readDIS} className={`neo-button ghost ${!server ? "opacity-50 cursor-not-allowed" : ""}`} disabled={!server}>ℹ️ Baca Info Perangkat</button>
        <button onClick={readBattery} className={`neo-button secondary ${!server ? "opacity-50 cursor-not-allowed" : ""}`} disabled={!server}>🔋 Baca Baterai</button>
        <button onClick={testPrint} className={`neo-button success ${!writableChar ? "opacity-50 cursor-not-allowed" : ""}`} disabled={!writableChar}>🖨️ Tes Kirim Teks</button>
      </div>

      <div className="flex flex-wrap gap-2 my-3 items-center">
        <label className="text-sm">Identifier Target (MAC/Serial)</label>
        <input
          className="neo-input min-w-[240px]"
          placeholder="mis. 60:6e:41:79:35:5b"
          value={expectedId}
          onChange={(e) => {
            setExpectedId(e.target.value);
            try { localStorage.setItem("preferred_printer_identifier", e.target.value); } catch {}
          }}
        />
        <label className="text-sm">Gunakan filter ISSC (49535343)</label>
        <input
          type="checkbox"
          checked={useISSCFilter}
          onChange={(e) => setUseISSCFilter(e.target.checked)}
        />
      </div>

      <hr className="my-3" />

      <h2 className="font-semibold mt-4">Status Perangkat</h2>
      <ul>
        <li>Nama: {device?.name ?? "-"}</li>
        <li>ID: {device?.id ?? "-"}</li>
        <li>Terkoneksi: {server ? (server.connected ? "ya" : "tidak") : "-"}</li>
        <li>Characteristic writable: {writableChar ? `ada (${selectedCharUuid || writableChar.uuid})` : "tidak"}</li>
        <li>Battery: {batteryLevel != null ? `${batteryLevel}%` : "-"}</li>
        <li>Serial (DIS): {disInfo.serialNumber ?? "-"}</li>
        {expectedId && (
          <li>
            Kecocokan Identifier:
            {(() => {
              const norm = (s: string | undefined) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
              const exp = norm(expectedId);
              const mSerial = norm(disInfo.serialNumber) === exp;
              const mId = norm(device?.id) === exp;
              const mName = device?.name ? norm(device.name).includes(exp) : false;
              const parts = [
                `Serial(DIS): ${mSerial ? "cocok" : "tidak"}`,
                `Device ID: ${mId ? "cocok" : "tidak"}`,
                `Nama: ${mName ? "mengandung" : "tidak"}`,
              ];
              return " " + parts.join(" | ");
            })()}
          </li>
        )}
      </ul>

      <h2 className="font-semibold mt-4">Device Information (DIS)</h2>
      <ul>
        <li>Manufacturer: {disInfo.manufacturer ?? "-"}</li>
        <li>Model: {disInfo.model ?? "-"}</li>
        <li>Serial Number: {disInfo.serialNumber ?? "-"}</li>
        <li>Hardware Revision: {disInfo.hardwareRevision ?? "-"}</li>
        <li>Firmware Revision: {disInfo.firmwareRevision ?? "-"}</li>
        <li>Software Revision: {disInfo.softwareRevision ?? "-"}</li>
      </ul>

      <h2 className="font-semibold mt-4">Layanan & Karakteristik</h2>
      {services.length === 0 ? (
        <p>-</p>
      ) : (
        <div>
          {services.map((svc) => (
            <div key={svc.uuid} style={{ marginBottom: 12 }}>
              <div style={{ fontWeight: 600 }}>Service: {svc.uuid}</div>
              <ul>
                {(svcMeta[svc.uuid] ?? []).map((c) => (
                  <li key={c.uuid}>
                    Char: {c.uuid} — props: {c.props.join(", ") || "-"}
                    {c.props.some((p) => p === "write" || p === "writeWithoutResponse") && (
                      <button
                        className={`neo-button small ${selectedCharUuid === c.uuid ? "success" : "secondary"} ml-2`}
                        onClick={() => useCharacteristic(c.uuid)}
                      >🖨️ Pakai untuk Cetak</button>
                    )}
                    {c.props.includes("notify") && (
                      <button
                        className={`neo-button small ${notifStatus[c.uuid] ? "ghost" : "secondary"} ml-2`}
                        onClick={() => startNotify(c.uuid)}
                        disabled={!!notifStatus[c.uuid]}
                      >{notifStatus[c.uuid] ? "🔔 Notifikasi aktif" : "🔔 Aktifkan Notifikasi"}</button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}