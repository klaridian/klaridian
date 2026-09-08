import type { Metadata } from "next";
import { JetBrains_Mono } from "next/font/google";
import { RootProvider } from "fumadocs-ui/provider/next";
import "./globals.css";

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["400", "500", "700", "800"],
});

const SITE_URL = "https://klaridian.dev";
const TITLE = "klaridian() — OpenAPI to instrumented MCP servers";
const DESCRIPTION =
  "Generate a stateless, instrumented Model Context Protocol server from your OpenAPI or Swagger spec — in TypeScript or Python, with OpenTelemetry and product-analytics observability and tool curation wired in.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: TITLE,
    template: "%s — klaridian",
  },
  description: DESCRIPTION,
  applicationName: "klaridian",
  keywords: [
    "MCP",
    "Model Context Protocol",
    "OpenAPI",
    "Swagger",
    "MCP server generator",
    "OpenTelemetry",
    "observability",
    "PostHog",
    "AI agents",
    "CLI",
  ],
  authors: [{ name: "Ricardo Vasconcelos" }],
  alternates: {
    canonical: "/",
  },
  robots: {
    index: true,
    follow: true,
  },
  openGraph: {
    type: "website",
    url: SITE_URL,
    siteName: "klaridian",
    title: TITLE,
    description: DESCRIPTION,
    images: [
      {
        url: "/og.png",
        width: 2400,
        height: 800,
        alt: "klaridian — OpenAPI spec to an instrumented MCP server",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: ["/og.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={jetbrainsMono.variable} suppressHydrationWarning>
      <body className="antialiased">
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  );
}
