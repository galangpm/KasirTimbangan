"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useFlashStore } from "@/store/flashStore";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const check = async () => {
      try {
        const res = await fetch("/api/auth/me", { cache: "no-store", credentials: "include" });
        const data = await res.json();
        if (data?.user) {
          // Sudah login: arahkan ke /settings untuk superadmin, kasir ke beranda
          if (String(data.user.role || "") === "superadmin") {
            window.location.assign("/settings");
          } else {
            window.location.assign("/");
          }
        }
      } catch {}
    };
    check();
  }, [router]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) throw new Error(data?.error || "Gagal login");
      const role = String(data.user?.role || "");
      // Tunggu proses pasca-login: pastikan sesi aktif dan schema/settings siap
      try {
        await fetch("/api/auth/me", { cache: "no-store", credentials: "include" }).then((r) => r.json()).catch(() => ({}));
        await fetch("/api/settings", { cache: "no-store", credentials: "include" }).catch(() => {});
      } catch {}
      // Redirect akhir
      if (role === "superadmin") {
        window.location.assign("/settings");
      } else {
        window.location.assign("/");
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      useFlashStore.getState().show("error", message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-md neo-card p-4">
      <h1 className="text-lg font-semibold mb-3">Login</h1>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="block text-sm mb-1">Username</label>
          <input className="neo-input w-full" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="superadmin / kasir" />
        </div>
        <div>
          <label className="block text-sm mb-1">Password</label>
          <input type="password" className="neo-input w-full" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="password" />
        </div>
        <button type="submit" className="neo-button secondary w-full" disabled={loading}>{loading ? "Mengirim..." : "Masuk"}</button>
      </form>
    </div>
  );
}