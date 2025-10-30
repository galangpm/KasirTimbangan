"use client";

import React, { useCallback, useEffect, useState } from "react";

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

export default function PrinterBluetoothDebugPage() {
  const [device, setDevice] = useState<AnyDevice | null>(null);
  const [server, setServer] = useState<BluetoothRemoteGATTServer | null>(null);
  const [services, setServices] = useState<BluetoothRemoteGATTService[]>([]);
  const [svcMeta, setSvcMeta] = useState<Record<string, { uuid: string; props: string[] }[]>>({});
  const [writableChar, setWritableChar] = useState<BluetoothRemoteGATTCharacteristic | null>(null);
  const [batteryLevel, setBatteryLevel] = useState<number | null>(null);
  const [disInfo, setDisInfo] = useState<Record<string, string | undefined>>({});
  const [error, setError] = useState<string | null>(null);

  const [isSupported, setIsSupported] = useState<boolean | null>(null);
  useEffect(() => {
    setIsSupported(!!(navigator as any)?.bluetooth);
  }, []);

  const connect = useCallback(async () => {
    setError(null);
    try {
      const n = navigator as Navigator & { bluetooth?: any };
      if (!n.bluetooth) throw new Error("Web Bluetooth tidak didukung oleh browser");
      const dev: AnyDevice = await n.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: COMMON_BLE_PRINTER_SERVICES });
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
      // Cari characteristic writable pertama
      let writable: BluetoothRemoteGATTCharacteristic | null = null;
      const meta: Record<string, { uuid: string; props: string[] }[]> = {};
      for (const svc of svcs) {
        const chars = await svc.getCharacteristics();
        meta[svc.uuid] = chars.map((ch) => ({ uuid: ch.uuid, props: propsToList((ch as any).properties) }));
        for (const ch of chars) {
          const p = ch.properties as any;
          if (p?.write || p?.writeWithoutResponse) { writable = ch; break; }
        }
        if (writable) break;
      }
      setDevice(dev);
      setServer(srv);
      setServices(svcs);
      setSvcMeta(meta);
      setWritableChar(writable);
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
      const p = writableChar.properties as any;
      if (p?.writeWithoutResponse && (writableChar as any).writeValueWithoutResponse) {
        await (writableChar as any).writeValueWithoutResponse(init);
        await (writableChar as any).writeValueWithoutResponse(text);
      } else {
        await writableChar.writeValue(init);
        await writableChar.writeValue(text);
      }
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  }, [writableChar]);

  return (
    <div style={{ padding: 16 }}>
      <h1>Debug Printer Bluetooth</h1>
      {isSupported === false && (
        <p style={{ color: "#b91c1c" }}>Browser tidak mendukung Web Bluetooth. Coba Chrome/Edge di Android/desktop.</p>
      )}
      {error && <p style={{ color: "#b91c1c" }}>Error: {error}</p>}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
        <button onClick={connect} style={{ padding: "8px 12px" }}>Pilih & Hubungkan Perangkat</button>
        <button onClick={disconnect} style={{ padding: "8px 12px" }} disabled={!server}>Putuskan Koneksi</button>
        <button onClick={readDIS} style={{ padding: "8px 12px" }} disabled={!server}>Baca Device Information</button>
        <button onClick={readBattery} style={{ padding: "8px 12px" }} disabled={!server}>Baca Level Baterai</button>
        <button onClick={testPrint} style={{ padding: "8px 12px" }} disabled={!writableChar}>Tes Kirim Teks</button>
      </div>

      <hr style={{ margin: "16px 0" }} />

      <h2>Status Perangkat</h2>
      <ul>
        <li>Nama: {device?.name ?? "-"}</li>
        <li>ID: {device?.id ?? "-"}</li>
        <li>Terkoneksi: {server ? (server.connected ? "ya" : "tidak") : "-"}</li>
        <li>Characteristic writable: {writableChar ? "ada" : "tidak"}</li>
        <li>Battery: {batteryLevel != null ? `${batteryLevel}%` : "-"}</li>
      </ul>

      <h2>Device Information (DIS)</h2>
      <ul>
        <li>Manufacturer: {disInfo.manufacturer ?? "-"}</li>
        <li>Model: {disInfo.model ?? "-"}</li>
        <li>Serial Number: {disInfo.serialNumber ?? "-"}</li>
        <li>Hardware Revision: {disInfo.hardwareRevision ?? "-"}</li>
        <li>Firmware Revision: {disInfo.firmwareRevision ?? "-"}</li>
        <li>Software Revision: {disInfo.softwareRevision ?? "-"}</li>
      </ul>

      <h2>Layanan & Karakteristik</h2>
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