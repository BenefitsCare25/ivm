import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { headers } from "next/headers";
import "@/styles/globals.css";
import { DeploymentGuard } from "@/components/deployment-guard";
import { ThemeProvider } from "@/components/theme-provider";

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
      <body
        className={`${inter.className} antialiased`}
        suppressHydrationWarning
        {...(nonce ? { "data-nonce": nonce } : {})}
      >
        {/* Inline script to set theme before first paint, preventing flash */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{const t=localStorage.getItem('theme')||(window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');document.documentElement.setAttribute('data-mode',t)}catch(e){}`,
          }}
        />
        <ThemeProvider>
          <DeploymentGuard />
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
