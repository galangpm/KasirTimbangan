"use client";

import { useState } from "react";

export default function InstallPage() {
  const [key, setKey] = useState("");
  const [progress, setProgress] = useState<string[]>([]);
  const [installing, setInstalling] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message?: string } | null>(null);

  const append = (line: string) => setProgress((p) => [...p, line]);

  const startInstall = async () => {
    setResult(null);
    setProgress([]);
    // Validasi kunci
    append("Memvalidasi kunci...");
    if (key.trim().toLowerCase() !== "asera") {
      append("Kunci tidak valid.");
      setResult({ ok: false, message: "Kunci salah. Masukkan 'asera'." });
      return;
    }

    setInstalling(true);
    try {
      append("Memeriksa koneksi database...");
      const ping = await fetch("/api/db/ping", { method: "GET" });
      if (!ping.ok) {
        append("Gagal ping database.");
        setResult({ ok: false, message: "Tidak dapat terhubung ke database." });
        setInstalling(false);
        return;
      }

      append("Menjalankan instalasi database...");
      const resp = await fetch("/api/db/install", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Asera-Key": key.trim(),
        },
      });

      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || !data?.ok) {
        append("Instalasi gagal.");
        setResult({ ok: false, message: data?.error || `Gagal instalasi (status ${resp.status}).` });
      } else {
        append("Instalasi selesai.");
        const seededInfo = `Seeded: prices=${data?.seededCount ?? 0}, users=${data?.usersSeeded ?? 0}, scope=${data?.only ?? "all"}`;
        append(seededInfo);
        setResult({ ok: true, message: "Instalasi berhasil." });
      }
    } catch (e) {
      append("Terjadi kesalahan tak terduga.");
      setResult({ ok: false, message: e instanceof Error ? e.message : String(e) });
    } finally {
      setInstalling(false);
    }
  };

  return (
    <div className="container" style={{ maxWidth: 560, margin: "40px auto" }}>
      <div className="neo-card" style={{ padding: 20 }}>
        <h2 style={{ marginBottom: 12 }}>Instal Database</h2>
        <p style={{ color: "#666", marginBottom: 16 }}>
          Akses tanpa login menggunakan kunci instalasi. Masukkan &quot;asera&quot; sebagai kunci.
        </p>

        <label htmlFor="asera-key" style={{ display: "block", marginBottom: 8 }}>Kunci Instalasi</label>
        <input
          id="asera-key"
          type="password"
          className="neo-input"
          placeholder="Masukkan kunci 'asera'"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          style={{ width: "100%", marginBottom: 12 }}
        />

        <button
          className="neo-button"
          onClick={startInstall}
          disabled={installing}
          style={{ width: "100%", marginTop: 4 }}
        >
          {installing ? "Menginstal..." : "Mulai Instalasi"}
        </button>

        <div style={{ marginTop: 16 }}>
          <strong>Status Progres</strong>
          <div className="neo-card" style={{ padding: 12, marginTop: 8, minHeight: 60 }}>
            {progress.length === 0 ? (
              <span style={{ color: "#888" }}>Belum ada proses berjalan.</span>
            ) : (
              <ul style={{ paddingLeft: 18, margin: 0 }}>
                {progress.map((p, i) => (
                  <li key={i} style={{ marginBottom: 6 }}>{p}</li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {result && (
          <div
            className={`neo-card ${result.ok ? "success" : "error"}`}
            style={{ padding: 12, marginTop: 16 }}
          >
            {result.ok ? "Instalasi selesai." : "Instalasi gagal."}
            {result.message ? <div style={{ marginTop: 6, color: "#555" }}>{result.message}</div> : null}
          </div>
        )}
      </div>
    </div>
  );
}