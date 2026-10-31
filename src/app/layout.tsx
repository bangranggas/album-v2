import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { ServiceWorkerRegister } from "@/components/ServiceWorkerRegister";

import "./globals.css";

export const metadata: Metadata = {
  title: "Link Collector",
  description: "Links captured from the browser with the Tampermonkey script.",
  robots: { index: false, follow: false },
  // Links the PWA manifest (which carries the share_target) to every page.
  manifest: "/manifest.webmanifest",
  // iOS ignores the manifest for "Add to Home Screen"; this is its equivalent.
  appleWebApp: {
    capable: true,
    title: "Link Collector",
    statusBarStyle: "default",
  },
  icons: {
    apple: "/icons/icon-192.png",
  },
};

export const viewport: Viewport = {
  // Matches the manifest's theme_color so the browser chrome and the app agree.
  themeColor: "#0f172a",
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased">
        {/* Registered on every page so the share target is live before sign-in. */}
        <ServiceWorkerRegister />
        {children}
      </body>
    </html>
  );
}
