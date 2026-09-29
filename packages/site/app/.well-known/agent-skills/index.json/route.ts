import { skillIndexEntry } from "@/lib/agent-skill";

export const dynamic = "force-static";

// Agent Skills discovery index (Cloudflare-led RFC, schema v0.2.0), so tools
// such as `npx skills add https://klaridian.dev` find the klaridian skill.
export async function GET() {
  const body = {
    $schema: "https://schemas.agentskills.io/discovery/0.2.0/schema.json",
    skills: [await skillIndexEntry()],
  };
  return new Response(JSON.stringify(body, null, 2) + "\n", {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
