import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { DocEntry } from "@/lib/llms";

const CONTENT_DIR = join(process.cwd(), "content", "docs");

// Read a page's raw MDX from disk and strip the YAML frontmatter block, so the
// body is plain Markdown an agent can ingest. Kept in its own module (imported
// only by the build-time-static /llms-full.txt route) so the fs dependency
// doesn't leak into the index route. Prefer the absolutePath Fumadocs
// resolved; fall back to CONTENT_DIR + virtual path.
export async function readDocBody(entry: DocEntry): Promise<string> {
  const file = entry.absolutePath ?? join(CONTENT_DIR, entry.path);
  // Build-time-only read from the content dir (route is force-static); the
  // path is app-controlled, not user input. Silence Turbopack's dynamic-fs
  // project-tracing warning.
  const raw = await readFile(/* turbopackIgnore: true */ file, "utf8");
  return raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "").trim();
}
