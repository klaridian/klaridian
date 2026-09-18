import Link from "next/link";
import { CopyInstallCommand } from "@/components/copy-install-command";
import { AnimatedTerminal } from "@/components/animated-terminal";
import { HomeJsonLd } from "@/components/json-ld";

const FEATURES = [
  {
    title: "Curation, not a tool dump",
    body: "Filter by tag, path, or operationId so the agent sees the handful of tools it needs instead of your entire API. Tool bloat is the thing people complain about most with generated MCP servers, and this is the fix.",
  },
  {
    title: "Observability comes wired",
    body: "OpenTelemetry tracing and product-analytics events are written into the server at generation time, as readable source you own rather than a black-box dependency.",
  },
  {
    title: "TypeScript or Python",
    body: "One spec, either runtime. Same tools, same annotations, same traces. Pick whichever you'd rather deploy.",
  },
  {
    title: "You can read every line",
    body: "Plain output on the official MCP SDK. Before you hand it production credentials, you can see exactly what each tool call does.",
  },
  {
    title: "Handles huge specs",
    body: "Code-mode collapses hundreds of operations into a typed client and two tools, so a giant API doesn't blow up the agent's context window.",
  },
  {
    title: "Ships where you deploy",
    body: "Get a Dockerfile, a Cloudflare Worker, or a Fly.io app. klaridian writes the config and the platform's own CLI takes it from there.",
  },
  {
    title: "No black-box generator in the middle",
    body: "klaridian parses and maps your OpenAPI spec itself, built on the standard swagger-parser library. The mapping is checked against real specs from Stripe, GitHub, and Kubernetes, so what comes out of your spec is predictable.",
  },
];

const STATS = [
  { n: "452", unit: "/452", label: "tools from Stripe's public spec" },
  { n: "2", unit: " langs", label: "TypeScript & Python, full parity" },
  { n: "MIT", unit: "", label: "open source, auditable output" },
];

export default function Home() {
  return (
    <main className="min-h-screen bg-fd-background text-fd-foreground">
      <HomeJsonLd />

      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-fd-border bg-fd-background/80 backdrop-blur">
        <div className="max-w-[1080px] mx-auto px-8 flex items-center gap-6 h-[60px]">
          <span className="font-mono font-bold text-base">
            klaridian<span className="text-[var(--klaridian-accent)]">()</span>
          </span>
          <nav className="flex gap-6 text-sm ml-2 text-fd-muted-foreground">
            <Link href="/docs" className="hover:text-fd-foreground transition-colors">Docs</Link>
            <Link href="/changelog" className="hover:text-fd-foreground transition-colors">Changelog</Link>
            <Link href="/docs/how-to/plugins/otel" className="hover:text-fd-foreground transition-colors">Plugins</Link>
          </nav>
          <span className="flex-1" />
          <a
            href="https://github.com/klaridian/klaridian"
            className="flex items-center gap-1.5 border border-fd-border rounded-lg px-3 py-1.5 text-[13px] font-medium bg-fd-card hover:border-[var(--klaridian-accent)] transition-colors"
          >
            <span className="text-[var(--klaridian-accent)]">★</span> Star
          </a>
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-[1080px] mx-auto px-8 pt-20 pb-10 text-center">
        <div className="inline-flex items-center gap-2 border border-fd-border bg-fd-card rounded-full px-3.5 py-1.5 text-[12.5px] text-fd-muted-foreground font-mono mb-7">
          MCP SDK v2 &nbsp;·&nbsp; MCP 2025-11-25 &nbsp;·&nbsp;{" "}
          <b className="text-[var(--klaridian-accent)] font-medium">TypeScript + Python</b>
        </div>
        <h1 className="text-[clamp(34px,6vw,56px)] leading-[1.05] font-extrabold tracking-[-0.03em] mb-5 max-w-[720px] mx-auto">
          Your OpenAPI spec,{" "}
          <span className="bg-gradient-to-br from-[var(--klaridian-accent)] to-[var(--klaridian-accent-strong)] bg-clip-text text-transparent">
            a real MCP server
          </span>{" "}
          you can trust.
        </h1>
        <p className="text-[19px] text-fd-muted-foreground max-w-[60ch] mx-auto mb-8 leading-relaxed">
          Point klaridian at an OpenAPI or Swagger spec and it writes a stateless
          Model Context Protocol server, with OpenTelemetry, analytics, and tool
          curation already in place. The output is plain code you can read before
          it touches a single credential.
        </p>
        <div className="flex flex-wrap gap-3 justify-center items-center">
          <Link
            href="/docs"
            className="bg-[var(--klaridian-accent)] text-[#04120b] rounded-lg px-6 py-3 font-semibold text-sm hover:opacity-90 transition-opacity"
          >
            Read the docs →
          </Link>
          <a
            href="https://github.com/klaridian/klaridian"
            className="border border-fd-border rounded-lg px-6 py-3 font-semibold text-sm hover:border-[var(--klaridian-accent)] transition-colors"
          >
            View source
          </a>
        </div>

        <AnimatedTerminal />
      </section>

      {/* Proof strip */}
      <section className="border-y border-fd-border">
        <div className="max-w-[1080px] mx-auto px-8 py-11 flex justify-center gap-12 flex-wrap">
          {STATS.map((s) => (
            <div key={s.label} className="text-center">
              <div className="text-[28px] font-bold font-mono">
                <span className="text-[var(--klaridian-accent)]">{s.n}</span>
                {s.unit}
              </div>
              <div className="text-[13px] text-fd-muted-foreground mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section className="max-w-[1080px] mx-auto px-8 py-14">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="border border-fd-border bg-fd-card rounded-xl p-[22px]"
            >
              <h3 className="text-base font-semibold mb-1.5">{f.title}</h3>
              <p className="text-sm text-fd-muted-foreground leading-relaxed">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Install */}
      <section id="install" className="border-t border-fd-border">
        <div className="max-w-[1080px] mx-auto px-8 py-14 text-center">
          <h2 className="text-2xl font-bold mb-3">Install</h2>
          <p className="text-sm text-fd-muted-foreground max-w-[440px] mx-auto mb-7">
            One CLI, available on npm, PyPI, and Homebrew. The PyPI and Homebrew
            builds are prebuilt native binaries for macOS, Linux, and Windows, so
            you don't need Node.js installed.
          </p>
          <CopyInstallCommand />
          <div className="text-sm mt-6 flex flex-wrap justify-center gap-x-6 gap-y-2">
            <Link href="/docs/how-to/installation" className="text-[var(--klaridian-accent)] hover:underline underline-offset-4">
              All install options
            </Link>
            <Link href="/docs" className="text-[var(--klaridian-accent)] hover:underline underline-offset-4">
              Read the docs
            </Link>
            <a href="https://github.com/klaridian/klaridian" className="text-[var(--klaridian-accent)] hover:underline underline-offset-4">
              View on GitHub
            </a>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-fd-border">
        <div className="max-w-[1080px] mx-auto px-8 py-6 flex justify-between items-center text-[12px] text-fd-muted-foreground font-mono flex-wrap gap-3">
          <a href="https://github.com/klaridian/klaridian/blob/main/LICENSE" className="hover:text-[var(--klaridian-accent)]">
            MIT License
          </a>
          <a href="/llms.txt" title="Machine-readable docs index for agents (llms.txt)" className="hover:text-[var(--klaridian-accent)]">
            llms.txt
          </a>
          <span>Built on the official MCP SDK</span>
        </div>
      </footer>
    </main>
  );
}
