import type { MetadataRoute } from "next";
import { source } from "@/lib/source";

const SITE_URL = "https://klaridian.dev";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: SITE_URL, lastModified: now, changeFrequency: "weekly", priority: 1 },
    // Changelog is a single reverse-chronological feed page; each release is an
    // in-page anchor (#v<version>), not its own route, so only the feed URL is
    // listed here.
    {
      url: `${SITE_URL}/changelog`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.7,
    },
    // Machine-ingestible docs for agents (llms.txt convention).
    {
      url: `${SITE_URL}/llms.txt`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.6,
    },
    {
      url: `${SITE_URL}/llms-full.txt`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.5,
    },
  ];

  const docRoutes: MetadataRoute.Sitemap = source.getPages().map((page) => ({
    url: `${SITE_URL}${page.url}`,
    lastModified: now,
    changeFrequency: "weekly",
    priority: page.url === "/docs" ? 0.8 : 0.6,
  }));

  return [...staticRoutes, ...docRoutes];
}
