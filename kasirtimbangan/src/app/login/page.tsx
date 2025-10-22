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
        const res = await fetch("/api/auth/me");
        const data = await res.json();
        if (data?.user) {
          // Sudah login: arahkan sesuai role
          if (data.user.role === "superadmin") router.replace("/analytics");
          else router.replace("/");
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
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) throw new Error(data?.error || "Gagal login");
      const role = String(data.user?.role || "");
      if (role === "superadmin") router.replace("/analytics");
      else router.replace("/");
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      useFlashStore.getState().show("error", message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-md mx-auto neo-card p-4">
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
      <div className="text-xs text-slate-500 mt-3">Default: superadmin/superadmin, kasir/kasir</div>
    </div>
  );
}