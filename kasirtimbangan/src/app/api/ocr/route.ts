import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

// Helper: normalisasi angka "dd.ddd" dari teks apapun
function normalizeToWeight(text: string): string | null {
  if (!text) return null;
  // Ambil kandidat angka dengan titik/desimal
  const m = text.match(/\d+(?:[\.,]\d+)?/g);
  if (!m) return null;
  // Pilih token terpanjang lalu normalisasi titik
  const s = m.sort((a, b) => b.length - a.length)[0].replace(/,/g, ".");
  // Pastikan ada satu titik, dan maksimal 3 desimal
  const parts = s.split(".");
  let valStr = parts.length > 1 ? `${parts[0]}.${parts.slice(1).join("")}` : parts[0];
  // Batas 3 desimal
  if (valStr.includes(".")) {
    const [i, d] = valStr.split(".");
    valStr = `${i}.${d.slice(0, 3)}`;
  }
  // Format 2 digit integer + 3 desimal
  const num = parseFloat(valStr);
  if (!Number.isFinite(num)) return null;
  const fixed = num.toFixed(3);
  const [ip, dp] = fixed.split(".");
  return `${ip.padStart(2, "0")}.${dp}`;
}

// Helper untuk mengekstrak pesan error secara aman
const getErrorMessage = (e: unknown): string => {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  try { return JSON.stringify(e); } catch { return String(e); }
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const imageDataUrl: string | undefined = body?.imageDataUrl;
    if (!imageDataUrl || typeof imageDataUrl !== "string") {
      return NextResponse.json({ error: "imageDataUrl diperlukan" }, { status: 400 });
    }

    // Validasi data URL
    if (!/^data:image\/(png|jpeg|jpg|webp);base64,/.test(imageDataUrl)) {
      return NextResponse.json({ error: "imageDataUrl harus base64 data URL (png/jpeg/webp)" }, { status: 400 });
    }

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: "OPENAI_API_KEY belum diset di environment" }, { status: 500 });
    }

    // Instruksi yang presisi agar hasil sangat akurat dan terstruktur
    const systemPrompt = "Anda adalah sistem OCR timbangan. Ekstrak angka berat dari gambar display digital/7-segment dengan sangat akurat. Kembalikan hanya angka berat dengan titik desimal (contoh: 02.345). Jika tidak ada angka, jawab 0.";
    const userPrompt = "Ekstrak angka berat (kg) dari gambar berikut. Pastikan format dd.ddd (2 digit integer, 3 digit desimal). Jika tidak ditemukan, jawab 0.";

    const resp = await client.responses.create({
      // Gunakan model multimodal yang menerima input image
      model: "gpt-4o-mini",
      input: [
        {
          role: "system",
          content: [{ type: "input_text", text: systemPrompt }],
        },
        {
          role: "user",
          content: [
            { type: "input_text", text: userPrompt },
            { type: "input_image", image_url: imageDataUrl, detail: "high" },
          ],
        },
      ],
    });

    const text = resp.output_text || "";
    const normalized = normalizeToWeight(text) ?? (text.trim() === "N/A" ? null : null);

    return NextResponse.json({ raw: text, normalized }, { status: 200 });
  } catch (e: unknown) {
    console.error("OCR API error", e);
    return NextResponse.json({ error: getErrorMessage(e) || "OCR API error" }, { status: 500 });
  }
}