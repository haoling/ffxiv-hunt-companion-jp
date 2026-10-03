import type { Metadata, Viewport } from "next";
import "./globals.css";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export const metadata: Metadata = {
  title: "FFXIV Hunt Companion JP",
  description: "FFXIV のモブハント手配書の対象と、効率のよい回り方を文字で案内するクライアントサイド Web アプリ",
  manifest: `${basePath}/manifest.webmanifest`,
  icons: {
    icon: [{ url: `${basePath}/icons/icon.svg`, type: "image/svg+xml" }],
    apple: [{ url: `${basePath}/icons/apple-touch-icon.png`, sizes: "180x180" }],
  },
  appleWebApp: { capable: true, title: "ハント案内", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8fafc" },
    { media: "(prefers-color-scheme: dark)", color: "#0f172a" },
  ],
};

/** 描画前に保存済みのテーマを適用して、表示が切り替わるちらつきを防ぐ（キーは app/lib/user-state.ts の settingsStore と同じ） */
const THEME_SCRIPT = `try{var t=JSON.parse(localStorage.getItem("hunt-companion:v1:settings")||"{}").theme;if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
