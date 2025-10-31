import type { NextConfig } from "next";
import path from "path";

// Pastikan Turbopack memilih root project yang benar
const nextConfig: NextConfig = {
  turbopack: {
    root: path.join(__dirname),
  },
  eslint: {
    // Abaikan lint saat build agar peringatan tidak menggagalkan build
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
