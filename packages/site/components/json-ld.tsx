const SITE_URL = "https://klaridian.dev";

// SoftwareApplication structured data for the homepage. Helps search engines
// classify klaridian as a developer tool and can earn rich results.
const softwareApplication = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "klaridian",
  applicationCategory: "DeveloperApplication",
  operatingSystem: "macOS, Linux, Windows",
  url: SITE_URL,
  description:
    "Generate a stateless, instrumented Model Context Protocol (MCP) server from your OpenAPI or Swagger spec — in TypeScript or Python, with OpenTelemetry and product-analytics observability and tool curation wired in.",
  license: "https://opensource.org/licenses/MIT",
  softwareHelp: `${SITE_URL}/docs`,
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
  },
  author: {
    "@type": "Person",
    name: "Ricardo Vasconcelos",
  },
  keywords:
    "MCP, Model Context Protocol, OpenAPI, Swagger, MCP server generator, OpenTelemetry, observability, AI agents, CLI",
  sameAs: ["https://github.com/klaridian/klaridian"],
} as const;

export function HomeJsonLd() {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareApplication) }}
    />
  );
}

export type BreadcrumbItem = { name: string; url: string };

// BreadcrumbList structured data for docs pages. Items are absolute URLs that
// resolve to real pages; the caller passes only segments that exist.
export function DocsBreadcrumbJsonLd({ items }: { items: BreadcrumbItem[] }) {
  // A single-item breadcrumb (the /docs root pointing at itself) carries no
  // hierarchy — skip it so only real trails emit structured data.
  if (items.length < 2) return null;

  const breadcrumb = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      item: item.url.startsWith("http") ? item.url : `${SITE_URL}${item.url}`,
    })),
  };
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumb) }}
    />
  );
}
