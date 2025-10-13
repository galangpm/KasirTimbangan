import { create } from "zustand";

export type Prices = Record<string, number>;

type PriceState = {
  prices: Prices;
  setAll: (prices: Prices) => void;
  setPrice: (fruit: string, price: number) => void;
  addFruit: (fruit: string, price: number) => void;
  removeFruit: (fruit: string) => void;
};

export const usePriceStore = create<PriceState>()((set) => ({
  prices: {},
  setAll: (prices) => set({ prices }),
  setPrice: (fruit, price) =>
    set((s) => ({ prices: { ...s.prices, [fruit]: Math.max(0, Math.floor(price)) } })),
  addFruit: (fruit, price) =>
    set((s) => ({ prices: { ...s.prices, [fruit]: Math.max(0, Math.floor(price)) } })),
  removeFruit: (fruit) =>
    set((s) => {
      const next = { ...s.prices };
      delete next[fruit];
      return { prices: next };
    }),
}));