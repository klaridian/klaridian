import { docEntries } from "@/lib/llms";

export const dynamic = "force-static";

// /llms.txt — the machine-ingestible index of the docs, following the
// llms.txt convention (https://llmstxt.org). An agent reads this to find the
// right page, then fetches /llms-full.txt (or a specific page) for detail.
export async function GET() {
  const entries = docEntries();

  const lines = [
    "# klaridian",
    "",
    "> Generate a stateless, instrumented Model Context Protocol (MCP) server from your OpenAPI or Swagger spec — in TypeScript or Python, with OpenTelemetry and product-analytics observability and tool curation wired in.",
    "",
    "klaridian is an MIT-licensed CLI. Point it at an OpenAPI (or Swagger 2.0) spec and it emits a stateless MCP server built on the official MCP SDK, with observability and tool curation already wired in.",
    "",
    "## Docs",
    "",
    ...entries.map(
      (e) =>
        `- [${e.title}](${e.absoluteUrl})${e.description ? `: ${e.description}` : ""}`,
    ),
    "",
    "## Full text",
    "",
    "- [Full documentation, concatenated](https://klaridian.dev/llms-full.txt): every doc page as plain text, for whole-corpus ingestion.",
    "",
    "## Optional",
    "",
    "- [Changelog](https://klaridian.dev/changelog): release notes, newest first.",
    "- [Source on GitHub](https://github.com/klaridian/klaridian): MIT-licensed generator.",
    "",
  ];

  return new Response(lines.join("\n"), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
