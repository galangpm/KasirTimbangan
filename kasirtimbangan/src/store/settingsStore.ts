// DEPRECATED: Store pengaturan usaha ini tidak lagi menjadi sumber data utama.
// Gunakan API /api/settings untuk menyimpan/memuat data profil usaha dari database.
// Store ini boleh dipakai sebagai cache sementara bila diperlukan.

import { create } from "zustand";
import { persist } from "zustand/middleware";

export type BusinessSettings = {
  name: string;
  address: string;
  phone: string;
  receiptFooter: string;
};

type SettingsState = BusinessSettings & {
  setName: (v: string) => void;
  setAddress: (v: string) => void;
  setPhone: (v: string) => void;
  setReceiptFooter: (v: string) => void;
  setAll: (s: Partial<BusinessSettings>) => void;
};

const defaultSettings: BusinessSettings = {
  name: "Kasir Timbangan",
  address: "",
  phone: "",
  receiptFooter: "Terima kasih telah berbelanja!",
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      ...defaultSettings,
      setName: (v) => set({ name: v }),
      setAddress: (v) => set({ address: v }),
      setPhone: (v) => set({ phone: v }),
      setReceiptFooter: (v) => set({ receiptFooter: v }),
      setAll: (s) => set((cur) => ({
        name: s.name ?? cur.name,
        address: s.address ?? cur.address,
        phone: s.phone ?? cur.phone,
        receiptFooter: s.receiptFooter ?? cur.receiptFooter,
      })),
    }),
    { name: "kasir-settings" }
  )
);