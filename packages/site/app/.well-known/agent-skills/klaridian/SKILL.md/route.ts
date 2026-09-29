import { readSkill } from "@/lib/agent-skill";

export const dynamic = "force-static";

// The klaridian Agent Skill, byte-for-byte from skills/klaridian/SKILL.md, so
// its sha256 matches the digest in /.well-known/agent-skills/index.json.
export async function GET() {
  return new Response(new Uint8Array(await readSkill()), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
