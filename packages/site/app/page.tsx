import Link from "next/link";
import { CopyInstallCommand } from "@/components/copy-install-command";
import { HomeJsonLd } from "@/components/json-ld";

const FEATURES = [
  {
    title: "Born instrumented",
    body: "OpenTelemetry spans and product-analytics events wired at generation time — not bolted on after the fact.",
  },
  {
    title: "Curated, not dumped",
    body: "Exclude, rename, and tag operations so agents see a clean tool catalog, not your whole API.",
  },
  {
    title: "TypeScript or Python",
    body: "Same tools, same annotations, same observability from one spec — pick the runtime you'd rather deploy.",
  },
  {
    title: "Deploy anywhere",
    body: "Emit a portable Dockerfile, a Cloudflare Worker, or a Fly.io app. klaridian writes the config; the platform's CLI does the rest.",
  },
  {
    title: "Built for large APIs",
    body: "Code-mode turns hundreds of operations into a typed client and just two tools, so agents keep their context lean.",
  },
  {
    title: "Open by default",
    body: "MIT-licensed generator, plain readable output on the official MCP SDK. Read it before you trust it with real credentials.",
  },
];

export default function Home() {
  return (
    <main className="min-h-screen bg-[var(--klaridian-paper)] text-[var(--klaridian-ink)] font-mono">
      <HomeJsonLd />
      {/* Header */}
      <header className="border-b-[3px] border-[var(--klaridian-ink)]">
        <div className="max-w-[860px] mx-auto px-5 flex items-center justify-between py-[18px]">
          <div className="font-extrabold text-[19px] tracking-tight">
            klaridian<span className="text-[var(--klaridian-accent)]">()</span>
          </div>
          <nav className="flex gap-6 text-sm">
            <Link href="/docs" className="hover:border-b-2 hover:border-[var(--klaridian-accent)]">
              docs
            </Link>
            <Link
              href="/changelog"
              className="hover:border-b-2 hover:border-[var(--klaridian-accent)]"
            >
              changelog
            </Link>
            <a
              href="https://github.com/klaridian/klaridian"
              title="Star klaridian on GitHub"
              className="hover:border-b-2 hover:border-[var(--klaridian-accent)]"
            >
              <span className="text-[var(--klaridian-accent)]">★</span> star
            </a>
          </nav>
        </div>
      </header>

      {/* Hero — claim, one-line sub, CTAs, then a real generate → output block. */}
      <section className="border-b-[3px] border-[var(--klaridian-ink)] py-[80px]">
        <div className="max-w-[860px] mx-auto px-5 text-center">
          <h1 className="text-[42px] md:text-5xl font-extrabold tracking-tight leading-[1.2] mb-5 max-w-[640px] mx-auto">
            Generate an{" "}
            <span className="text-[var(--klaridian-accent)]">instrumented</span>{" "}
            MCP server from your API spec.
          </h1>
          <p className="text-sm max-w-[500px] mx-auto mb-8 text-[#333]">
            OpenAPI (or Swagger 2.0) in, a stateless MCP server out — in
            TypeScript or Python, with observability and tool curation wired in.
            Generate it, run it, deploy it.
          </p>
          <div className="flex gap-3 justify-center mb-12">
            <a
              href="#install"
              className="inline-block px-7 py-3.5 text-[13px] font-bold border-2 border-[var(--klaridian-ink)] bg-[var(--klaridian-ink)] text-[var(--klaridian-paper)] hover:bg-[var(--klaridian-accent)] hover:border-[var(--klaridian-accent)] hover:text-[var(--klaridian-ink)] transition-colors"
            >
              Get started →
            </a>
            <Link
              href="/docs"
              className="inline-block px-7 py-3.5 text-[13px] font-bold border-2 border-[var(--klaridian-ink)] bg-transparent text-[var(--klaridian-ink)] hover:bg-[var(--klaridian-ink)] hover:text-[var(--klaridian-paper)] transition-colors"
            >
              Read the docs
            </Link>
          </div>

          {/* Representative generate run + emitted output */}
          <div
            className="border-[3px] border-[var(--klaridian-ink)] bg-[var(--klaridian-ink)] text-[var(--klaridian-paper)] mx-auto max-w-[620px] text-left"
            style={{ boxShadow: "8px 8px 0 var(--klaridian-accent)" }}
          >
            <div className="flex items-center gap-1.5 px-3.5 py-2 border-b border-[#444]">
              <span className="w-2.5 h-2.5 border border-[#666]" />
              <span className="w-2.5 h-2.5 border border-[#666]" />
              <span className="w-2.5 h-2.5 border border-[#666]" />
            </div>
            <pre className="px-5 py-[22px] text-[12.5px] leading-relaxed overflow-x-auto">
              <span className="text-[var(--klaridian-accent)]">$</span> klaridian generate --spec ./api.yaml \{"\n"}
              {"    "}--out ./server --plugin otel
              {"\n\n"}
              <span className="text-[var(--klaridian-accent)]">✓</span> 24 operations → 24 MCP tools{"\n"}
              <span className="text-[var(--klaridian-accent)]">✓</span> OpenTelemetry tracing wired in{"\n"}
              <span className="text-[var(--klaridian-accent)]">✓</span> TypeScript · stateless · official MCP SDK
              {"\n\n"}
              <span className="text-[#888]">./server/</span>{"\n"}
              <span className="text-[#888]">  ├─ src/server-factory.ts</span>{"\n"}
              <span className="text-[#888]">  ├─ src/index.ts</span>{"\n"}
              <span className="text-[#888]">  └─ package.json</span>
            </pre>
          </div>
        </div>
      </section>

      {/* What you get — six one-sentence blurbs, no cards, no icons */}
      <section className="border-b-[3px] border-[var(--klaridian-ink)] py-[60px]">
        <div className="max-w-[860px] mx-auto px-5 grid grid-cols-1 md:grid-cols-3 gap-x-10 gap-y-9">
          {FEATURES.map((b) => (
            <div key={b.title}>
              <h3 className="text-sm font-extrabold mb-2.5">
                <span className="text-[var(--klaridian-accent)]">
                  {b.title.split(" ")[0]}
                </span>{" "}
                {b.title.split(" ").slice(1).join(" ")}
              </h3>
              <p className="text-xs leading-relaxed text-[#444]">{b.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Quick install — the one prominent code block */}
      <section id="install" className="py-[60px]">
        <div className="max-w-[860px] mx-auto px-5 text-center">
          <h2 className="text-xl font-extrabold mb-3">Quick install</h2>
          <p className="text-xs max-w-[440px] mx-auto mb-7 text-[#444]">
            One CLI on npm, PyPI, and Homebrew — prebuilt native binaries for
            macOS, Linux, and Windows, no Node.js required.
          </p>
          <CopyInstallCommand />
          <div className="text-xs mt-5">
            <Link
              href="/docs/how-to/installation"
              className="underline decoration-[var(--klaridian-accent)] underline-offset-4 mx-2.5"
            >
              All install options
            </Link>
            <Link
              href="/docs"
              className="underline decoration-[var(--klaridian-accent)] underline-offset-4 mx-2.5"
            >
              Read the docs
            </Link>
            <a
              href="https://github.com/klaridian/klaridian"
              className="underline decoration-[var(--klaridian-accent)] underline-offset-4 mx-2.5"
            >
              View on GitHub
            </a>
          </div>
        </div>
      </section>

      <footer className="border-t-[3px] border-[var(--klaridian-ink)] py-5">
        <div className="max-w-[860px] mx-auto px-5 flex justify-between text-[11px] text-[#666]">
          <a
            href="https://github.com/klaridian/klaridian/blob/main/LICENSE"
            className="hover:text-[var(--klaridian-accent)] hover:underline"
          >
            MIT LICENSE
          </a>
          <a
            href="/llms.txt"
            title="Machine-readable docs index for agents (llms.txt)"
            className="hover:text-[var(--klaridian-accent)] hover:underline"
          >
            llms.txt
          </a>
          <span>BUILT ON THE OFFICIAL MCP SDK</span>
        </div>
      </footer>
    </main>
  );
}
