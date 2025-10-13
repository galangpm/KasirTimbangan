import type { NextConfig } from "next";
import path from "path";

// Pastikan Turbopack memilih root project yang benar
const nextConfig: NextConfig = {
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;
