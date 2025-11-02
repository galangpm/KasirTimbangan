"use client";
import { useEffect, useRef, useState } from "react";
import { useFlashStore } from "@/store/flashStore";

export default function CameraCaptureFixed({
  onCaptured,
  onClose,
}: {
  onCaptured: (imageData: ImageData, dataUrl: string) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [crop, setCrop] = useState({ x: 0.14, y: 0.7, w: 0.18, h: 0.14 });
  const [marginLeftPct, setMarginLeftPct] = useState(14);
  const [marginBottomPct, setMarginBottomPct] = useState(16);
  const [mode, setMode] = useState<"camera" | "image">("camera");
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(null);

  const dragStartRef = useRef<{ startX: number; startY: number; startLeft: number; startBottom: number } | null>(null);

  const compressCanvasToDataURL = (source: HTMLCanvasElement, maxW = 1024, maxH = 1024, quality = 0.6): string => {
    const w = source.width;
    const h = source.height;
    const scale = Math.min(1, maxW / w, maxH / h);
    const out = document.createElement("canvas");
    out.width = Math.floor(w * scale);
    out.height = Math.floor(h * scale);
    const octx = out.getContext("2d");
    if (!octx) return source.toDataURL("image/jpeg", quality);
    octx.drawImage(source, 0, 0, w, h, 0, 0, out.width, out.height);
    return out.toDataURL("image/jpeg", quality);
  };

  const compressImageDataToDataURL = (imgData: ImageData, maxW = 600, maxH = 600, quality = 0.7): string => {
    const tmp = document.createElement("canvas");
    tmp.width = imgData.width;
    tmp.height = imgData.height;
    const tctx = tmp.getContext("2d");
    if (!tctx) return "";
    tctx.putImageData(imgData, 0, 0);
    const w = tmp.width;
    const h = tmp.height;
    const scale = Math.min(1, maxW / w, maxH / h);
    if (scale < 1) {
      const out = document.createElement("canvas");
      out.width = Math.floor(w * scale);
      out.height = Math.floor(h * scale);
      const octx = out.getContext("2d");
      if (!octx) return tmp.toDataURL("image/jpeg", quality);
      octx.drawImage(tmp, 0, 0, w, h, 0, 0, out.width, out.height);
      return out.toDataURL("image/jpeg", quality);
    }
    return tmp.toDataURL("image/jpeg", quality);
  };

  function calcCropPixelsFromOverlay(displayedRect: DOMRect, containerRect: DOMRect, srcW: number, srcH: number) {
    // Overlay dalam piksel relatif terhadap container (bukan konten media)
    const overlayLeftPx = (marginLeftPct / 100) * containerRect.width;
    const overlayTopPx = (1 - crop.h) * containerRect.height - (marginBottomPct / 100) * containerRect.height;
    const overlayWidthPx = crop.w * containerRect.width;
    const overlayHeightPx = crop.h * containerRect.height;

    // Posisi absolut overlay (viewport)
    const overlayAbsLeft = containerRect.left + overlayLeftPx;
    const overlayAbsTop = containerRect.top + overlayTopPx;

    // Hitung contentRect di dalam elemen video/img yang memakai object-contain
    const containerW = displayedRect.width;
    const containerH = displayedRect.height;
    const srcAspect = srcW / srcH;
    const containerAspect = containerW / containerH;

    let contentW: number, contentH: number, contentAbsLeft: number, contentAbsTop: number;
    if (containerAspect > srcAspect) {
      // Letterbox horizontal: tinggi penuh, lebar mengikuti rasio sumber
      contentH = containerH;
      contentW = contentH * srcAspect;
      contentAbsLeft = displayedRect.left + (containerW - contentW) / 2;
      contentAbsTop = displayedRect.top;
    } else {
      // Letterbox vertikal: lebar penuh, tinggi mengikuti rasio sumber
      contentW = containerW;
      contentH = contentW / srcAspect;
      contentAbsLeft = displayedRect.left;
      contentAbsTop = displayedRect.top + (containerH - contentH) / 2;
    }

    // Koordinat overlay relatif terhadap area konten sebenarnya
    let relLeft = overlayAbsLeft - contentAbsLeft;
    let relTop = overlayAbsTop - contentAbsTop;
    let relRight = relLeft + overlayWidthPx;
    let relBottom = relTop + overlayHeightPx;

    // Clamp agar tetap di dalam area konten yang terlihat
    relLeft = Math.max(0, relLeft);
    relTop = Math.max(0, relTop);
    relRight = Math.min(contentW, relRight);
    relBottom = Math.min(contentH, relBottom);

    const relW = Math.max(0, relRight - relLeft);
    const relH = Math.max(0, relBottom - relTop);

    // Skala ke koordinat piksel sumber
    const scaleX = srcW / contentW;
    const scaleY = srcH / contentH;

    let rx = Math.floor(relLeft * scaleX);
    let ry = Math.floor(relTop * scaleY);
    let rw = Math.floor(relW * scaleX);
    let rh = Math.floor(relH * scaleY);

    // Pastikan batas tidak melampaui dimensi sumber
    if (rx + rw > srcW) rw = Math.max(0, srcW - rx);
    if (ry + rh > srcH) rh = Math.max(0, srcH - ry);

    return { rx, ry, rw, rh };
  }

  const handleOverlayMouseMove = (e: MouseEvent) => {
    const start = dragStartRef.current;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!start || !rect) return;
    const dxPct = ((e.clientX - start.startX) / rect.width) * 100;
    const dyPct = ((e.clientY - start.startY) / rect.height) * 100;
    setLeftMargin(start.startLeft + dxPct);
    setBottomMargin(start.startBottom - dyPct);
  };
  const handleOverlayMouseUp = () => {
    dragStartRef.current = null;
    window.removeEventListener("mousemove", handleOverlayMouseMove);
    window.removeEventListener("mouseup", handleOverlayMouseUp);
  };
  const handleOverlayMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragStartRef.current = { startX: e.clientX, startY: e.clientY, startLeft: marginLeftPct, startBottom: marginBottomPct };
    window.addEventListener("mousemove", handleOverlayMouseMove);
    window.addEventListener("mouseup", handleOverlayMouseUp);
  };

  const handleOverlayTouchMove = (e: TouchEvent) => {
    const start = dragStartRef.current;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!start || !rect) return;
    const t = e.touches[0];
    const dxPct = ((t.clientX - start.startX) / rect.width) * 100;
    const dyPct = ((t.clientY - start.startY) / rect.height) * 100;
    setLeftMargin(start.startLeft + dxPct);
    setBottomMargin(start.startBottom - dyPct);
    e.preventDefault();
  };
  const handleOverlayTouchEnd = () => {
    dragStartRef.current = null;
    window.removeEventListener("touchmove", handleOverlayTouchMove);
    window.removeEventListener("touchend", handleOverlayTouchEnd);
  };
  const handleOverlayTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    e.preventDefault();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const t = e.touches[0];
    dragStartRef.current = { startX: t.clientX, startY: t.clientY, startLeft: marginLeftPct, startBottom: marginBottomPct };
    window.addEventListener("touchmove", handleOverlayTouchMove, { passive: false });
    window.addEventListener("touchend", handleOverlayTouchEnd);
  };

  useEffect(() => {
    if (mode !== "camera") return;
    const vEl = videoRef.current;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (vEl) {
          vEl.srcObject = stream;
          await vEl.play();
        }
      } catch {
        useFlashStore.getState().show("error", "Tidak bisa mengakses kamera");
      }
    })();
    return () => {
      const s = vEl?.srcObject as MediaStream | null;
      s?.getTracks().forEach((t) => t.stop());
    };
  }, [mode]);

  const capture = () => {
    const canvas = canvasRef.current;
    const containerRect = containerRef.current?.getBoundingClientRect();
    if (!canvas || !containerRect) return;

    if (mode === "camera") {
      const video = videoRef.current;
      if (!video) return;
      const displayedRect = video.getBoundingClientRect();
      const w = video.videoWidth;
      const h = video.videoHeight;
      if (w <= 0 || h <= 0 || displayedRect.width <= 0 || displayedRect.height <= 0) return;

      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, w, h);
      const { rx, ry, rw, rh } = calcCropPixelsFromOverlay(displayedRect, containerRect, w, h);
      const imgData = ctx.getImageData(rx, ry, rw, rh);
      const fullDataUrl = compressCanvasToDataURL(canvas, 1024, 1024, 0.6);
      const dataUrl = compressImageDataToDataURL(imgData, 600, 600, 0.7);
      window.dispatchEvent(new CustomEvent("camera-captured-full", { detail: { fullDataUrl } }));
      onCaptured(imgData, dataUrl);
    } else {
      const img = imgRef.current;
      if (!img) return;
      const displayedRect = img.getBoundingClientRect();
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      if (w <= 0 || h <= 0 || displayedRect.width <= 0 || displayedRect.height <= 0) return;

      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, w, h);
      const { rx, ry, rw, rh } = calcCropPixelsFromOverlay(displayedRect, containerRect, w, h);
      const imgData = ctx.getImageData(rx, ry, rw, rh);
      const fullDataUrl = compressCanvasToDataURL(canvas, 1024, 1024, 0.6);
      const dataUrl = compressImageDataToDataURL(imgData, 600, 600, 0.7);
      window.dispatchEvent(new CustomEvent("camera-captured-full", { detail: { fullDataUrl } }));
      onCaptured(imgData, dataUrl);
    }
  };

  const triggerFilePick = () => {
    const el = document.getElementById("filePickInput") as HTMLInputElement | null;
    el?.click();
  };
  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result);
      setUploadedUrl(url);
      setMode("image");
    };
    reader.readAsDataURL(file);
  };

  const setWidthPct = (pct: number) => {
    const wPct = Math.min(100, Math.max(1, pct));
    const maxLeft = 100 - wPct;
    const newLeft = Math.min(marginLeftPct, maxLeft);
    const w = wPct / 100;
    setMarginLeftPct(newLeft);
    setCrop((c) => ({ ...c, w, x: newLeft / 100, y: 1 - c.h - marginBottomPct / 100 }));
  };
  const setHeightPct = (pct: number) => {
    const hPct = Math.min(100, Math.max(1, pct));
    const maxBottom = 100 - hPct;
    const newBottom = Math.min(marginBottomPct, maxBottom);
    const h = hPct / 100;
    setMarginBottomPct(newBottom);
    setCrop((c) => ({ ...c, h, x: marginLeftPct / 100, y: 1 - h - newBottom / 100 }));
  };
  const setLeftMargin = (pct: number) => {
    const m = Math.min(100, Math.max(0, pct));
    const maxLeft = 100 - crop.w * 100;
    const newLeft = Math.min(m, maxLeft);
    setMarginLeftPct(newLeft);
    setCrop((c) => ({ ...c, x: newLeft / 100 }));
  };
  const setBottomMargin = (pct: number) => {
    const m = Math.min(100, Math.max(0, pct));
    const maxBottom = 100 - crop.h * 100;
    const newBottom = Math.min(m, maxBottom);
    setMarginBottomPct(newBottom);
    setCrop((c) => ({ ...c, y: 1 - c.h - newBottom / 100 }));
  };

  return (
    <div className="p-4">
      <div className="relative" ref={containerRef}>
        {mode === "camera" ? (
          <video ref={videoRef} className="w-full max-h-[60vh] object-contain rounded" playsInline muted />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img ref={imgRef} src={uploadedUrl ?? undefined} alt="uploaded" className="w-full max-h-[60vh] object-contain rounded" />
        )}
        {mode === "camera" && (
          <>
            {/* Area atas di luar crop */}
            <div
              className="absolute z-10 bg-black/50 pointer-events-none"
              style={{ top: 0, left: 0, width: "100%", height: `${(1 - crop.h) * 100 - marginBottomPct}%` }}
            />
            {/* Area kiri di luar crop */}
            <div
              className="absolute z-10 bg-black/50 pointer-events-none"
              style={{ top: `${(1 - crop.h) * 100 - marginBottomPct}%`, left: 0, width: `${marginLeftPct}%`, height: `${crop.h * 100}%` }}
            />
            {/* Area kanan di luar crop */}
            <div
              className="absolute z-10 bg-black/50 pointer-events-none"
              style={{
                top: `${(1 - crop.h) * 100 - marginBottomPct}%`,
                left: `calc(${marginLeftPct}% + ${crop.w * 100}%)`,
                width: `calc(100% - (${marginLeftPct}% + ${crop.w * 100}%))`,
                height: `${crop.h * 100}%`,
              }}
            />
            {/* Area bawah di luar crop */}
            <div
              className="absolute z-10 bg-black/50 pointer-events-none"
              style={{
                top: `calc(${(1 - crop.h) * 100 - marginBottomPct}% + ${crop.h * 100}%)`,
                left: 0,
                width: "100%",
                height: `calc(100% - (${(1 - crop.h) * 100 - marginBottomPct}% + ${crop.h * 100}%))`,
              }}
            />
          </>
        )}
        <div
          className="absolute z-20 border-2 border-emerald-500 cursor-move touch-none select-none"
          onMouseDown={handleOverlayMouseDown}
          onTouchStart={handleOverlayTouchStart}
          style={{
            left: `${marginLeftPct}%`,
            top: `${(1 - crop.h) * 100 - marginBottomPct}%`,
            width: `${crop.w * 100}%`,
            height: `${crop.h * 100}%`,
          }}
        />
      </div>

      {mode === "image" && (
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <div className="flex items-center gap-2">
            <span>Lebar (%)</span>
            <input type="range" min={1} max={100} value={Math.round(crop.w * 100)} onChange={(e) => setWidthPct(Number(e.target.value))} />
            <input type="number" min={1} max={100} className="neo-input w-16" value={Math.round(crop.w * 100)} onChange={(e) => setWidthPct(Number(e.target.value))} />
          </div>
          <div className="flex items-center gap-2">
            <span>Tinggi (%)</span>
            <input type="range" min={1} max={100} value={Math.round(crop.h * 100)} onChange={(e) => setHeightPct(Number(e.target.value))} />
            <input type="number" min={1} max={100} className="neo-input w-16" value={Math.round(crop.h * 100)} onChange={(e) => setHeightPct(Number(e.target.value))} />
          </div>
          <div className="flex items-center gap-2">
            <span>Margin Kiri (%)</span>
            <input type="range" min={0} max={100} value={marginLeftPct} onChange={(e) => setLeftMargin(Number(e.target.value))} />
            <input type="number" min={0} max={100} className="neo-input w-16" value={marginLeftPct} onChange={(e) => setLeftMargin(Number(e.target.value))} />
          </div>
          <div className="flex items-center gap-2">
            <span>Margin Bawah (%)</span>
            <input type="range" min={0} max={100} value={marginBottomPct} onChange={(e) => setBottomMargin(Number(e.target.value))} />
            <input type="number" min={0} max={100} className="neo-input w-16" value={marginBottomPct} onChange={(e) => setBottomMargin(Number(e.target.value))} />
          </div>
        </div>
      )}

      <div className="mt-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {mode === "image" ? (
            <button className="neo-button secondary small" onClick={() => { setMode("camera"); setUploadedUrl(null); }}>Gunakan Kamera</button>
          ) : (
            <button className="neo-button secondary small" onClick={triggerFilePick}>Pilih dari Penyimpanan</button>
          )}
          <input id="filePickInput" type="file" accept="image/*" className="hidden" onChange={onFileChange} />
        </div>
        <div className="flex items-center gap-2">
          <button className="neo-button ghost" onClick={onClose}>Tutup</button>
          <button className="neo-button primary" onClick={capture}>{mode === "camera" ? "Ambil" : "Gunakan Foto"}</button>
        </div>
      </div>

      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}
