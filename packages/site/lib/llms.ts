import { source } from "@/lib/source";

const SITE_URL = "https://klaridian.dev";

export type DocEntry = {
  title: string;
  description: string;
  url: string;
  absoluteUrl: string;
  path: string; // virtualized path relative to content/docs, e.g. "how-to/code-mode.mdx"
  absolutePath?: string;
};

// All doc pages, in a deterministic order (by URL) so the generated files are
// stable across builds — prompt-cache friendly and diff-friendly.
export function docEntries(): DocEntry[] {
  return source
    .getPages()
    .map((page) => ({
      title: page.data.title ?? page.url,
      description: page.data.description ?? "",
      url: page.url,
      absoluteUrl: `${SITE_URL}${page.url}`,
      path: page.path,
      absolutePath: page.absolutePath,
    }))
    .sort((a, b) => a.url.localeCompare(b.url));
}

export { SITE_URL };
