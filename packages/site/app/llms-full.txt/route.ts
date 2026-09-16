import { docEntries } from "@/lib/llms";
import { readDocBody } from "@/lib/llms-content";

export const dynamic = "force-static";

// /llms-full.txt — every doc page concatenated as plain Markdown, each under a
// header with its title and canonical URL, for agents that want the whole
// corpus in one fetch. Derived from content/docs at build time.
export async function GET() {
  const entries = docEntries();

  const parts = [
    "# klaridian — full documentation",
    "",
    "> Generate a stateless, instrumented MCP server from your OpenAPI or Swagger spec, in TypeScript or Python.",
    "",
    "Every documentation page follows, each under its title and canonical URL.",
    "",
  ];

  for (const e of entries) {
    const body = await readDocBody(e);
    parts.push(
      "---",
      "",
      `# ${e.title}`,
      "",
      `Source: ${e.absoluteUrl}`,
      ...(e.description ? ["", `> ${e.description}`] : []),
      "",
      body,
      "",
    );
  }

  return new Response(parts.join("\n"), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
