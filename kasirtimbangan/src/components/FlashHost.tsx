"use client";
import { useEffect, useMemo } from "react";
import { useFlashStore, FlashMsg } from "@/store/flashStore";

function typeClasses(t: FlashMsg["type"]) {
  switch (t) {
    case "success":
      return "bg-green-600 text-white border-green-700";
    case "error":
      return "bg-red-600 text-white border-red-700";
    case "warning":
      return "bg-yellow-500 text-black border-yellow-600";
    case "info":
    default:
      return "bg-blue-600 text-white border-blue-700";
  }
}

function FlashItem({ msg }: { msg: FlashMsg }) {
  const close = useFlashStore((s) => s.close);
  useEffect(() => {
    if (msg.timeoutMs && msg.timeoutMs > 0) {
      const t = window.setTimeout(() => close(msg.id), msg.timeoutMs);
      return () => window.clearTimeout(t);
    }
  }, [msg.id, msg.timeoutMs, close]);

  const cls = useMemo(
    () => `${typeClasses(msg.type)} border-2 rounded-lg shadow-xl px-4 py-3 flex items-start gap-3 transition-all duration-300`,
    [msg.type]
  );

  return (
    <div className={cls} role="alert">
      <div className="flex-1 text-sm">{msg.text}</div>
      <button
        className="neo-button ghost small"
        aria-label="Tutup"
        onClick={() => close(msg.id)}
      >Tutup</button>
    </div>
  );
}

export default function FlashHost() {
  const messages = useFlashStore((s) => s.messages);

  return (
    <div className="fixed top-3 left-1/2 -translate-x-1/2 z-[1000] w-[95%] max-w-xl">
      <div className="flex flex-col gap-2">
        {messages.map((m) => (
          <FlashItem key={m.id} msg={m} />
        ))}
      </div>
    </div>
  );
}