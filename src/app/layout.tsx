import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { headers } from "next/headers";
import "@/styles/globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "IVM - Intelligent Value Mapper",
  description: "AI-powered document-to-form autofill platform",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.className} antialiased`} {...(nonce ? { "data-nonce": nonce } : {})}>
        {children}
      </body>
    </html>
  );
}
