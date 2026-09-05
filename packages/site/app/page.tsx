import Link from "next/link";
import { CopyInstallCommand } from "@/components/copy-install-command";

export default function Home() {
  return (
    <main className="min-h-screen bg-[var(--klaridian-paper)] text-[var(--klaridian-ink)] font-mono">
      {/* Header */}
      <header className="border-b-[3px] border-[var(--klaridian-ink)]">
        <div className="max-w-[900px] mx-auto px-5 flex items-center justify-between py-[18px]">
          <div className="font-extrabold text-[19px] tracking-tight">
            klaridian<span className="text-[var(--klaridian-accent)]">()</span>
          </div>
          <nav className="flex gap-6 text-sm">
            <Link href="/docs" className="hover:border-b-2 hover:border-[var(--klaridian-accent)]">
              docs
            </Link>
            <a href="#" className="hover:border-b-2 hover:border-[var(--klaridian-accent)]">
              plugins
            </a>
            <a
              href="https://github.com/ricardocvasconcelos/klaridian"
              className="hover:border-b-2 hover:border-[var(--klaridian-accent)]"
            >
              github
            </a>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="border-b-[3px] border-[var(--klaridian-ink)] py-14">
        <div className="max-w-[900px] mx-auto px-5 text-center">
          <div className="inline-block border-2 border-[var(--klaridian-ink)] px-2.5 py-1 text-[11px] font-bold tracking-wider mb-6">
            OPENAPI → MCP SERVER
          </div>
          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight leading-[1.15] mb-4 max-w-[640px] mx-auto">
            Generate an{" "}
            <span className="text-[var(--klaridian-accent)]">instrumented</span>{" "}
            MCP server from your API spec.
          </h1>
          <p className="text-sm max-w-[560px] mx-auto mb-9 text-[#333]">
            Point it at an OpenAPI document. Get a stateless, TypeScript MCP
            server with OpenTelemetry traces wired in — no manual
            instrumentation, no closed binary.
          </p>

          <CopyInstallCommand />

          <div className="flex items-center justify-center gap-3.5 flex-wrap">
            <Link
              href="/docs"
              className="inline-block px-5 py-3 text-[13px] font-bold border-2 border-[var(--klaridian-ink)] bg-[var(--klaridian-ink)] text-[var(--klaridian-paper)] hover:bg-[var(--klaridian-accent)] hover:border-[var(--klaridian-accent)] hover:text-[var(--klaridian-ink)] transition-colors"
            >
              Read the docs
            </Link>
            <a
              href="https://github.com/ricardocvasconcelos/klaridian"
              className="inline-block px-5 py-3 text-[13px] font-bold border-2 border-[var(--klaridian-ink)] hover:bg-[var(--klaridian-ink)] hover:text-[var(--klaridian-paper)] transition-colors"
            >
              View on GitHub
            </a>
          </div>
        </div>
      </section>

      {/* 3-column feature strip */}
      <section className="border-b-[3px] border-[var(--klaridian-ink)]">
        <div className="max-w-[900px] mx-auto grid grid-cols-1 md:grid-cols-3">
          {[
            {
              n: "01",
              title: "Parse",
              body: "OpenAPI 3.x or Swagger 2.0, converted transparently. 122/122 operations on real production specs.",
            },
            {
              n: "02",
              title: "Curate",
              body: "Exclude, rename, override tool hints via CLI flags or an x-klaridian-mcp overlay.",
            },
            {
              n: "03",
              title: "Instrument",
              body: "OTel spans at the registerTool boundary. OTLPTraceExporter — Datadog, Grafana, any OTLP backend.",
            },
          ].map((c, i) => (
            <div
              key={c.n}
              className={`px-6 py-7 ${
                i > 0 ? "border-t-2 md:border-t-0 md:border-l-2 border-[var(--klaridian-ink)]" : ""
              }`}
            >
              <div className="text-[11px] font-extrabold text-[var(--klaridian-accent)] mb-2.5">
                {c.n}
              </div>
              <h3 className="text-sm font-bold mb-2">{c.title}</h3>
              <p className="text-xs text-[#444]">{c.body}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="py-5">
        <div className="max-w-[900px] mx-auto px-5 flex justify-between text-[11px] text-[#666]">
          <span>MIT LICENSE</span>
          <span>BUILT ON THE OFFICIAL MCP SDK</span>
        </div>
      </footer>
    </main>
  );
}
