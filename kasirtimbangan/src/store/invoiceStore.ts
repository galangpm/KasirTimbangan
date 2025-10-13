import { create } from "zustand";
import { persist } from "zustand/middleware";

export type InvoiceItem = {
  fruit: string;
  weightKg: number;
  pricePerKg: number;
  totalPrice: number;
  imageDataUrl?: string;
  fullImageDataUrl?: string;
};

type PaymentMethod = "cash" | "card" | "qr" | null;

type InvoiceState = {
  items: InvoiceItem[];
  paymentMethod: PaymentMethod;
  newInvoice: () => void;
  addItem: (item: InvoiceItem) => void;
  removeItem: (index: number) => void;
  submitInvoice: () => void;
  setPaymentMethod: (m: Exclude<PaymentMethod, null>) => void;
};

export const useInvoiceStore = create<InvoiceState>()(
  persist(
    (set) => ({
      items: [],
      paymentMethod: null,
      newInvoice: () => set({ items: [], paymentMethod: null }),
      addItem: (item) => set((s) => ({ items: [...s.items, item] })),
      removeItem: (index) => set((s) => ({ items: s.items.filter((_, i) => i !== index) })),
      submitInvoice: () => {},
      setPaymentMethod: (m) => set({ paymentMethod: m }),
    }),
    { name: "kasir-invoice" }
  )
);