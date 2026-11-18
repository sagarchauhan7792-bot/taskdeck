import type { Metadata, Viewport } from "next";
import { Providers } from "@/components/todo/providers";
import { APP_NAME } from "@/lib/todo";
import "./globals.css";

export const metadata: Metadata = {
  title: APP_NAME,
  description: "Every task you hand out, in one place.",
  applicationName: APP_NAME,
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
    apple: "/apple-touch-icon.png",
  },
  // Lets iPhone open it full screen from the home screen.
  appleWebApp: { capable: true, title: APP_NAME, statusBarStyle: "black" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0b0c10",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
