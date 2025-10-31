"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { openSerialPort, requestSerialPort, serialPrintText, closeSerialPort } from "@/utils/serialPrint";

type AnySerialPort = any;

export default function PrinterClassicDebugPage() {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [port, setPort] = useState<AnySerialPort | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [baudRate, setBaudRate] = useState<number>(9600);
  const [isOpen, setIsOpen] = useState<boolean>(false);

  useEffect(() => {
    setSupported(!!(navigator as any)?.serial);
  }, []);

  const connect = useCallback(async () => {
    setError(null);
    try {
      const p = await requestSerialPort();
      await openSerialPort(p, { baudRate });
      setPort(p);
      setIsOpen(true);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  }, [baudRate]);

  const disconnect = useCallback(async () => {
    setError(null);
    try {
      await closeSerialPort(port);
    } catch {}
    setIsOpen(false);
    setPort(null);
  }, [port]);

  const testPrint = useCallback(async () => {
    setError(null);
    try {
      if (!port || !isOpen) throw new Error("Belum terhubung ke port serial");
      await serialPrintText(port, "Tes Cetak dari Bluetooth Classic (COM)\n");
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  }, [port, isOpen]);

  const info = useMemo(() => {
    try {
      const gi = port?.getInfo?.();
      return gi ? JSON.stringify(gi) : "-";
    } catch {
      return "-";
    }
  }, [port]);

  return (
    <div className="neo-card neo-page p-4">
      <h1 className="text-xl font-bold">Debug Printer Bluetooth Classic (Serial / COM)</h1>
      {supported === false && (
        <p className="text-red-600">Browser tidak mendukung Web Serial. Coba Chrome/Edge versi terbaru.</p>
      )}
      {error && <p className="text-red-600">Error: {error}</p>}

      <div className="flex flex-wrap gap-2 my-3 items-center">
        <label className="text-sm">Baud Rate</label>
        <select
          className="neo-input"
          value={baudRate}
          onChange={(e) => setBaudRate(Number(e.target.value))}
        >
          {[9600, 19200, 38400, 57600, 115200].map((b) => (
            <option key={b} value={b}>{b}</option>
          ))}
        </select>
        <button className="neo-button" onClick={connect}>Pilih & Hubungkan Port</button>
        <button className="neo-button" onClick={disconnect} disabled={!isOpen}>Putuskan</button>
        <button className="neo-button" onClick={testPrint} disabled={!isOpen}>Tes Kirim Teks</button>
      </div>

      <hr className="my-3" />

      <h2 className="font-semibold">Status</h2>
      <ul className="list-disc ml-6">
        <li>Web Serial didukung: {supported ? "ya" : supported === false ? "tidak" : "-"}</li>
        <li>Terkoneksi: {isOpen ? "ya" : "tidak"}</li>
        <li>Info Port: {info}</li>
      </ul>

      <h2 className="font-semibold mt-4">Petunjuk</h2>
      <ul className="list-disc ml-6">
        <li>Pasangkan printer Bluetooth Classic di OS (Windows) terlebih dahulu.</li>
        <li>Pastikan printer memiliki COM port (SPP) aktif.</li>
        <li>Pilih COM port melalui tombol "Pilih & Hubungkan Port" di atas.</li>
        <li>Jika tidak muncul, hapus pairing di OS, nyalakan ulang perangkat, lalu coba lagi.</li>
      </ul>
    </div>
  );
}