# Market research (Aug 30, 2026)

Raw output from 4 parallel research passes, conducted to inform the differentiation-path decision recorded in ARCHITECTURE.md sections 21-24 and PLAN.md section 5. Kept verbatim (not cleaned up) as the primary source these decisions cite — future re-reads of the summarized decisions should be able to trace back to what was actually found, not just the conclusion.

- `2026-08-30-mcp-ecosystem-trajectory.md` — where the MCP protocol/ecosystem is heading strategically (Anthropic/AAIF roadmap, SEPs in flight, platform vendor moves).
- `2026-08-30-developer-pain-points.md` — real developer complaints/feature requests from Reddit, Hacker News, GitHub issues on major MCP projects. This is the source for the "tool bloat is the strongest validated pain point" finding that drove the section 24 tool-curation decision.
- `2026-08-30-competitive-fleet-landscape.md` — competitive/funding landscape for MCP observability, analytics, and fleet-management tooling. This is the source for concluding the hosted correlation/fleet layer idea (PLAN.md section 4) has early competitors but isn't crowded yet — though adjacent governance/gateway space is well-funded.
- `2026-08-30-enterprise-adoption-blockers.md` — what large organizations say they need to run MCP in production (identity/SEP-990, security incidents, governance spend) — mostly validates a different category (governing existing servers) than mcpforge's current one (generating new servers).

Each file is a raw subagent JSON output (`report_markdown` + `top_3_signals`) saved as-is — not reformatted into clean prose, since the goal here is traceability to sources, not readability. If you need the polished takeaways, read ARCHITECTURE.md sections 21-24 and PLAN.md section 5 instead; come here only to verify a specific claim against its original research pass.
