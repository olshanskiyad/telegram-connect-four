import type { Metadata } from "next";
import type { ReactNode } from "react";
import Script from "next/script";

import "./globals.css";

export const metadata: Metadata = {
  title: "4 в ряд",
  description: "Игра 4 в ряд с ботом, комнатами и рейтингом."
};

export default function RootLayout({
  children
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="ru">
      <head>
        {/* Telegram Mini App API. Outside Telegram it does nothing and the game runs as a guest. */}
        <Script
          src="https://telegram.org/js/telegram-web-app.js?61"
          strategy="beforeInteractive"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
