import type { Metadata, Viewport } from "next";
import { Noto_Sans_Thai } from "next/font/google";
import "./globals.css";

const notoSansThai = Noto_Sans_Thai({
  subsets: ["thai", "latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-noto-sans-thai",
  // "optional": the font is used only if it is ready almost immediately, so text never reflows
  // (swapping fonts moved a whole policy page by CLS 0.29 in Lighthouse).
  display: "optional",
});

export const metadata: Metadata = {
  title: "P-Hook",
  description: "จดง่าย เห็นเงินชัด",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th" className={notoSansThai.variable}>
      <body>{children}</body>
    </html>
  );
}
