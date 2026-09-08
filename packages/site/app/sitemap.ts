import type { MetadataRoute } from "next";
import { source } from "@/lib/source";

const SITE_URL = "https://klaridian.dev";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: SITE_URL, lastModified: now, changeFrequency: "weekly", priority: 1 },
  ];

  const docRoutes: MetadataRoute.Sitemap = source.getPages().map((page) => ({
    url: `${SITE_URL}${page.url}`,
    lastModified: now,
    changeFrequency: "weekly",
    priority: page.url === "/docs" ? 0.8 : 0.6,
  }));

  return [...staticRoutes, ...docRoutes];
}
