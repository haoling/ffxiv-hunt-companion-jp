import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FFXIV Hunt Companion JP",
  description: "FFXIVモブハント手配書の認識とルート案内を目指すクライアントサイドWebアプリ",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
