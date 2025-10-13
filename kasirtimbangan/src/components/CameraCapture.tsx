"use client";
import { useEffect, useRef, useState } from "react";

export default function CameraCapture({
  onCaptured,
  onClose,
}: {
  onCaptured: (imageData: ImageData, dataUrl: string) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  // Fixed bottom-left dengan margin: x = marginKiri, y = 1 - h - marginBawah
  const [crop, setCrop] = useState({ x: 0.14, y: 0.7, w: 0.18, h: 0.14 });
  const [marginLeftPct, setMarginLeftPct] = useState(14); // persen
  const [marginBottomPct, setMarginBottomPct] = useState(16); // persen
  const [mode, setMode] = useState<"camera" | "image">("camera");
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const dragStartRef = useRef<{ startX: number; startY: number; startLeft: number; startBottom: number } | null>(null);

  // Helper: kompres canvas ke ukuran maksimum agar payload POST tidak terlalu besar
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

  // Helper: kompres ImageData hasil crop agar kecil
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
    dragStartRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startLeft: marginLeftPct,
      startBottom: marginBottomPct,
    };
    window.addEventListener("mousemove", handleOverlayMouseMove);
    window.addEventListener("mouseup", handleOverlayMouseUp);
  };

  // Touch support: drag overlay on touch devices
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
    dragStartRef.current = {
      startX: t.clientX,
      startY: t.clientY,
      startLeft: marginLeftPct,
      startBottom: marginBottomPct,
    };
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
        alert("Tidak bisa mengakses kamera");
      }
    })();
    return () => {
      const s = vEl?.srcObject as MediaStream | null;
      s?.getTracks().forEach((t) => t.stop());
    };
  }, [mode]);

  const capture = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const calcCrop = (w: number, h: number) => {
      // Posisi selalu kiri bawah dengan margin
      const x = marginLeftPct / 100;
      const y = 1 - crop.h - marginBottomPct / 100;
      const rx = Math.floor(x * w);
      const ry = Math.floor(y * h);
      const rw = Math.floor(crop.w * w);
      const rh = Math.floor(crop.h * h);
      return { rx, ry, rw, rh };
    };

    if (mode === "camera") {
      const video = videoRef.current;
      if (!video) return;
      const w = video.videoWidth;
      const h = video.videoHeight;
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, w, h);
      // Kompres full image agar tidak terlalu besar
      const fullDataUrl = compressCanvasToDataURL(canvas, 1024, 1024, 0.6);
      const { rx, ry, rw, rh } = calcCrop(w, h);
      const imgData = ctx.getImageData(rx, ry, rw, rh);
      // Kompres hasil crop
      const dataUrl = compressImageDataToDataURL(imgData, 600, 600, 0.7);
      window.dispatchEvent(new CustomEvent("camera-captured-full", { detail: { fullDataUrl } }));
      onCaptured(imgData, dataUrl);
    } else {
      const img = imgRef.current;
      if (!img) return;
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, w, h);
      // Kompres full image agar tidak terlalu besar
      const fullDataUrl = compressCanvasToDataURL(canvas, 1024, 1024, 0.6);
      const { rx, ry, rw, rh } = calcCrop(w, h);
      const imgData = ctx.getImageData(rx, ry, rw, rh);
      // Kompres hasil crop
      const dataUrl = compressImageDataToDataURL(imgData, 600, 600, 0.7);
      window.dispatchEvent(new CustomEvent("camera-captured-full", { detail: { fullDataUrl } }));
      onCaptured(imgData, dataUrl);
    }
  };

  // File picker
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

  // Setter agar ukuran/margin bisa diubah manual saat mode file
  const setWidthPct = (pct: number) => {
    const wPct = Math.min(100, Math.max(1, pct));
    const maxLeft = 100 - wPct; // hindari keluar kanan
    const newLeft = Math.min(marginLeftPct, maxLeft);
    const w = wPct / 100;
    setMarginLeftPct(newLeft);
    setCrop((c) => ({ ...c, w, x: newLeft / 100, y: 1 - c.h - marginBottomPct / 100 }));
  };
  const setHeightPct = (pct: number) => {
    const hPct = Math.min(100, Math.max(1, pct));
    const maxBottom = 100 - hPct; // hindari keluar bawah
    const newBottom = Math.min(marginBottomPct, maxBottom);
    const h = hPct / 100;
    setMarginBottomPct(newBottom);
    setCrop((c) => ({ ...c, h, x: marginLeftPct / 100, y: 1 - h - newBottom / 100 }));
  };
  const setLeftMargin = (pct: number) => {
    const m = Math.min(100, Math.max(0, pct));
    const maxLeft = 100 - crop.w * 100; // hindari keluar kanan
    const newLeft = Math.min(m, maxLeft);
    setMarginLeftPct(newLeft);
    setCrop((c) => ({ ...c, x: newLeft / 100 }));
  };
  const setBottomMargin = (pct: number) => {
    const m = Math.min(100, Math.max(0, pct));
    const maxBottom = 100 - crop.h * 100; // hindari keluar bawah
    const newBottom = Math.min(m, maxBottom);
    setMarginBottomPct(newBottom);
    setCrop((c) => ({ ...c, y: 1 - c.h - newBottom / 100 }));
  };

  return (
    <div className="p-4">
      <div className="relative" ref={containerRef}>
        {mode === "camera" ? (
          <video ref={videoRef} className="w-full rounded" playsInline muted />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img ref={imgRef} src={uploadedUrl ?? undefined} alt="uploaded" className="w-full rounded" />
        )}
        {/* Penggelapan di luar kotak crop saat mode kamera */}
        {mode === "camera" && (
          <>
            {/* Area atas */}
            <div
              className="absolute z-10 bg-black/50 pointer-events-none"
              style={{
                top: 0,
                left: 0,
                width: "100%",
                height: `${(1 - crop.h) * 100 - marginBottomPct}%`,
              }}
            />
            {/* Area kiri */}
            <div
              className="absolute z-10 bg-black/50 pointer-events-none"
              style={{
                top: `${(1 - crop.h) * 100 - marginBottomPct}%`,
                left: 0,
                width: `${marginLeftPct}%`,
                height: `${crop.h * 100}%`,
              }}
            />
            {/* Area kanan */}
            <div
              className="absolute z-10 bg-black/50 pointer-events-none"
              style={{
                top: `${(1 - crop.h) * 100 - marginBottomPct}%`,
                left: `calc(${marginLeftPct}% + ${crop.w * 100}%)`,
                width: `calc(100% - (${marginLeftPct}% + ${crop.w * 100}%))`,
                height: `${crop.h * 100}%`,
              }}
            />
            {/* Area bawah */}
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
        {/* Crop overlay: tampil pada kedua mode (kamera & file) */}
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

      {/* Controls ukuran & margin: tampil hanya saat menggunakan file */}
      {mode === "image" && (
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <div className="flex items-center gap-2">
            <span>Lebar (%)</span>
            <input
              type="range"
              min={1}
              max={100}
              value={Math.round(crop.w * 100)}
              onChange={(e) => setWidthPct(Number(e.target.value))}
            />
            <input
              type="number"
              min={1}
              max={100}
              className="neo-input w-16"
              value={Math.round(crop.w * 100)}
              onChange={(e) => setWidthPct(Number(e.target.value))}
            />
          </div>
          <div className="flex items-center gap-2">
            <span>Tinggi (%)</span>
            <input
              type="range"
              min={1}
              max={100}
              value={Math.round(crop.h * 100)}
              onChange={(e) => setHeightPct(Number(e.target.value))}
            />
            <input
              type="number"
              min={1}
              max={100}
              className="neo-input w-16"
              value={Math.round(crop.h * 100)}
              onChange={(e) => setHeightPct(Number(e.target.value))}
            />
          </div>
          <div className="flex items-center gap-2">
            <span>Margin Kiri (%)</span>
            <input
              type="range"
              min={0}
              max={100}
              value={marginLeftPct}
              onChange={(e) => setLeftMargin(Number(e.target.value))}
            />
            <input
              type="number"
              min={0}
              max={100}
              className="neo-input w-16"
              value={marginLeftPct}
              onChange={(e) => setLeftMargin(Number(e.target.value))}
            />
          </div>
          <div className="flex items-center gap-2">
            <span>Margin Bawah (%)</span>
            <input
              type="range"
              min={0}
              max={100}
              value={marginBottomPct}
              onChange={(e) => setBottomMargin(Number(e.target.value))}
            />
            <input
              type="number"
              min={0}
              max={100}
              className="neo-input w-16"
              value={marginBottomPct}
              onChange={(e) => setBottomMargin(Number(e.target.value))}
            />
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