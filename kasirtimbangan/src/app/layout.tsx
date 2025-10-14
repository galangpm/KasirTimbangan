import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import ServiceWorkerRegister from "@/components/ServiceWorkerRegister";
import Sidebar from "@/components/Sidebar";
import InvoiceSeed from "@/components/InvoiceSeed";
import FlashHost from "@/components/FlashHost";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Kasir Timbangan",
  description: "Kasir offline dengan OCR dan cetak Bluetooth",
  manifest: "/manifest.json",
  icons: {
    icon: "/next.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode; }>) {
  return (
    <html lang="id">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        {/* Flash messages at the top of the page */}
        <FlashHost />
        {/* Shell layout: Sidebar + content */}
        <div className="md:flex md:min-h-screen bg-gray-50">
          <Sidebar />
          <main className="flex-1">
            {/* Push content below mobile top-nav */}
            <div className="md:hidden h-0">
              {/* spacer not needed because nav is sticky, but keep container */}
            </div>
            <div className="p-3 md:p-6">
              {children}
            </div>
          </main>
        </div>
        {/* Registrasi Service Worker untuk PWA offline */}
        <ServiceWorkerRegister />
        {/* Seeder background 1 menit dengan deteksi perubahan */}
        <InvoiceSeed />
      </body>
    </html>
  );
}
