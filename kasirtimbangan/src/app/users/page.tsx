"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useFlashStore } from "@/store/flashStore";

type UserItem = { id: string; username: string; role: "superadmin" | "kasir"; createdAt: string };

export default function UsersPage() {
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);
  const [users, setUsers] = useState<UserItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<"superadmin" | "kasir">("kasir");
  const [editId, setEditId] = useState<string | null>(null);
  const [editUsername, setEditUsername] = useState("");
  const [editPassword, setEditPassword] = useState("");
  const [editRole, setEditRole] = useState<"superadmin" | "kasir">("kasir");

  useEffect(() => {
    const check = async () => {
      try {
        const res = await fetch("/api/auth/me");
        const data = await res.json();
        if (!data?.user) {
          router.replace("/login");
          return;
        }
        if (data.user.role !== "superadmin") {
          useFlashStore.getState().show("warning", "Akses ditolak: hanya untuk superadmin");
          router.replace("/");
          return;
        }
        setAuthChecked(true);
      } catch {
        router.replace("/login");
      }
    };
    check();
  }, [router]);

  const loadUsers = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/users");
      const data = await res.json();
      if (!res.ok || !data?.ok) throw new Error(data?.error || "Gagal memuat users");
      setUsers(data.users || []);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      useFlashStore.getState().show("error", message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (authChecked) loadUsers(); }, [authChecked]);

  const createUser = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    // Validasi: hanya huruf A-Z, tanpa spasi
    if (!/^[A-Za-z]+$/.test(newUsername)) {
      useFlashStore.getState().show("warning", "Username hanya boleh huruf A-Z, tanpa spasi");
      return;
    }
    setCreating(true);
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: newUsername, password: newPassword, role: newRole }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) throw new Error(data?.error || "Gagal membuat user");
      useFlashStore.getState().show("success", "User berhasil dibuat");
      setNewUsername(""); setNewPassword(""); setNewRole("kasir");
      await loadUsers();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      useFlashStore.getState().show("error", message);
    } finally {
      setCreating(false);
    }
  };

  const startEdit = (u: UserItem) => {
    setEditId(u.id);
    setEditUsername(u.username);
    setEditPassword("");
    setEditRole(u.role);
  };

  const cancelEdit = () => { setEditId(null); setEditUsername(""); setEditPassword(""); };

  const saveEdit = async (id: string) => {
    // Validasi: hanya huruf A-Z, tanpa spasi
    if (!/^[A-Za-z]+$/.test(editUsername)) {
      useFlashStore.getState().show("warning", "Username hanya boleh huruf A-Z, tanpa spasi");
      return;
    }
    try {
      const payload: { username: string; role: "superadmin" | "kasir"; password?: string } = { username: editUsername, role: editRole };
      if (editPassword) payload.password = editPassword;
      const res = await fetch(`/api/users/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) throw new Error(data?.error || "Gagal menyimpan perubahan");
      useFlashStore.getState().show("success", "Perubahan disimpan");
      cancelEdit();
      await loadUsers();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      useFlashStore.getState().show("error", message);
    }
  };

  const deleteUser = async (id: string) => {
    if (!confirm("Hapus user ini?")) return;
    try {
      const res = await fetch(`/api/users/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok || !data?.ok) throw new Error(data?.error || "Gagal menghapus user");
      useFlashStore.getState().show("success", "User dihapus");
      await loadUsers();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      useFlashStore.getState().show("error", message);
    }
  };

  if (!authChecked) return <div className="neo-card p-4">Memeriksa akses...</div>;

  return (
    <div className="space-y-6">
      <div className="neo-card p-4">
        <h2 className="text-lg font-semibold mb-3">Tambah User</h2>
        <form onSubmit={createUser} className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
          <div>
            <label className="block text-sm mb-1">Username</label>
            <input
              className="neo-input w-full"
              value={newUsername}
              onChange={(e) => setNewUsername(e.target.value)}
              pattern="[A-Za-z]+"
              title="Username hanya huruf A-Z, tanpa spasi"
            />
          </div>
          <div>
            <label className="block text-sm mb-1">Password</label>
            <input type="password" className="neo-input w-full" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
          </div>
          <div>
            <label className="block text-sm mb-1">Role</label>
            <select className="neo-input w-full" value={newRole} onChange={(e) => setNewRole(e.target.value as "kasir" | "superadmin")}>
              <option value="kasir">Kasir</option>
              <option value="superadmin">Superadmin</option>
            </select>
          </div>
          <button type="submit" className="neo-button secondary" disabled={creating}>{creating ? "Menyimpan..." : "Buat User"}</button>
        </form>
      </div>

      <div className="neo-card p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Daftar User</h2>
          <button className="neo-button ghost" onClick={loadUsers} disabled={loading}>{loading ? "Memuat..." : "Muat Ulang"}</button>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[720px] md:min-w-0 md:w-full text-sm neo-table">
            <thead>
              <tr className="text-left">
                <th className="px-3 py-2">Username</th>
                <th className="px-3 py-2">Role</th>
                <th className="px-3 py-2">Dibuat</th>
                <th className="px-3 py-2">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {users.length === 0 ? (
                <tr><td className="px-3 py-2" colSpan={4}>Tidak ada user</td></tr>
              ) : users.map((u) => (
                <tr key={u.id} className="border-t">
                  <td className="px-3 py-2">
                    {editId === u.id ? (
                      <input
                        className="neo-input w-full"
                        value={editUsername}
                        onChange={(e) => setEditUsername(e.target.value)}
                        pattern="[A-Za-z]+"
                        title="Username hanya huruf A-Z, tanpa spasi"
                      />
                    ) : (
                      <span>{u.username}</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {editId === u.id ? (
                      <select className="neo-input w-full" value={editRole} onChange={(e) => setEditRole(e.target.value as "kasir" | "superadmin")}>
                        <option value="kasir">Kasir</option>
                        <option value="superadmin">Superadmin</option>
                      </select>
                    ) : (
                      <span className={`neo-badge ${u.role === "superadmin" ? "success" : "pending"}`}>{u.role}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{new Date(u.createdAt).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })}</td>
                  <td className="px-3 py-2">
                    {editId === u.id ? (
                      <div className="flex gap-2 items-center">
                        <input type="password" className="neo-input" value={editPassword} onChange={(e) => setEditPassword(e.target.value)} placeholder="Password (opsional)" />
                        <button className="neo-button small secondary" onClick={() => saveEdit(u.id)}>Simpan</button>
                        <button className="neo-button small ghost" onClick={cancelEdit}>Batal</button>
                      </div>
                    ) : (
                      <div className="flex gap-2">
                        <button className="neo-button small ghost" onClick={() => startEdit(u)}>Edit</button>
                        <button className="neo-button small danger" onClick={() => deleteUser(u.id)}>Hapus</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}