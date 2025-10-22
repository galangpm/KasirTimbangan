"use client";
import { create } from "zustand";

export type FlashType = "success" | "error" | "warning" | "info";
export type FlashMsg = { id: string; type: FlashType; text: string; timeoutMs?: number };

type FlashState = {
  messages: FlashMsg[];
  show: (type: FlashType, text: string, timeoutMs?: number) => string;
  close: (id: string) => void;
  clear: () => void;
};

export const useFlashStore = create<FlashState>((set) => ({
  messages: [],
  show: (type, text, timeoutMs = 4000) => {
    const id = (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function")
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random()}`;
    set((s) => ({ messages: [...s.messages, { id, type, text, timeoutMs }] }));
    return id;
  },
  close: (id) => set((s) => ({ messages: s.messages.filter((m) => m.id !== id) })),
  clear: () => set({ messages: [] }),
}));