import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Sidebar } from "@/components/layout/Sidebar";
import { BackgroundProvider } from "@/components/layout/BackgroundProvider";

// Primary font - Inter (geometric neo-grotesk)
// Clean, modern, excellent for data-heavy interfaces
// Weights: 400 (normal), 500 (medium), 600 (semibold)
const inter = Inter({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

// Data & monospace font - JetBrains Mono
// For hashes, timestamps, metrics, packet data, code
const jetbrainsMono = JetBrains_Mono({
  variable: "--font-data",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "pyMC Repeater Dashboard",
  description: "LoRa Mesh Network Repeater Monitoring Dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${inter.variable} ${jetbrainsMono.variable} antialiased bg-bg-body min-h-screen`}
      >
        {/* Dynamic background - controlled by BackgroundSelector */}
        <BackgroundProvider />
        
        {/* App shell: sidebar + main content */}
        <div className="flex min-h-screen">
          <Sidebar />
          
          {/* Main content area */}
          <main className="flex-1 min-w-0 pt-14 lg:pt-0">
            <div className="h-full overflow-y-auto">
              <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
                {children}
              </div>
            </div>
          </main>
        </div>
      </body>
    </html>
  );
}
