import Link from "next/link";
import { CopyInstallCommand } from "@/components/copy-install-command";

export default function Home() {
  return (
    <main className="min-h-screen bg-[var(--klaridian-paper)] text-[var(--klaridian-ink)] font-mono">
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
            <a
              href="https://github.com/ricardocvasconcelos/klaridian"
              className="hover:border-b-2 hover:border-[var(--klaridian-accent)]"
            >
              github
            </a>
          </nav>
        </div>
      </header>

      {/* Hero — Starship-style: claim, one-line sub, single CTA. No badge, no stats. */}
      <section className="border-b-[3px] border-[var(--klaridian-ink)] py-[90px]">
        <div className="max-w-[860px] mx-auto px-5 text-center">
          <h1 className="text-[42px] md:text-5xl font-extrabold tracking-tight leading-[1.2] mb-5 max-w-[620px] mx-auto">
            Generate an{" "}
            <span className="text-[var(--klaridian-accent)]">instrumented</span>{" "}
            MCP server from your API spec.
          </h1>
          <p className="text-sm max-w-[480px] mx-auto mb-9 text-[#333]">
            OpenAPI in, a stateless TypeScript MCP server out — engineering
            observability and product analytics wired in from the start.
          </p>
          <a
            href="#install"
            className="inline-block px-7 py-3.5 text-[13px] font-bold border-2 border-[var(--klaridian-ink)] bg-[var(--klaridian-ink)] text-[var(--klaridian-paper)] hover:bg-[var(--klaridian-accent)] hover:border-[var(--klaridian-accent)] hover:text-[var(--klaridian-ink)] transition-colors"
          >
            Get started →
          </a>
        </div>
      </section>

      {/* Three one-sentence blurbs — no cards, no icons, no borders */}
      <section className="border-b-[3px] border-[var(--klaridian-ink)] py-[60px]">
        <div className="max-w-[860px] mx-auto px-5 grid grid-cols-1 md:grid-cols-3 gap-10">
          {[
            {
              title: "Born instrumented",
              body: "OTel spans and product-analytics events wired at generation time — not bolted on after the fact.",
            },
            {
              title: "Curated, not dumped",
              body: "Exclude, rename, and tag operations so agents see a clean tool catalog, not your whole API.",
            },
            {
              title: "Open by default",
              body: "MIT-licensed generator, plain readable TypeScript output. Read it before you trust it with real credentials.",
            },
          ].map((b) => (
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
          <h2 className="text-xl font-extrabold mb-7">Quick install</h2>
          <CopyInstallCommand />
          <div className="text-xs mt-5">
            <Link
              href="/docs"
              className="underline decoration-[var(--klaridian-accent)] underline-offset-4 mx-2.5"
            >
              Read the docs
            </Link>
            <a
              href="https://github.com/ricardocvasconcelos/klaridian"
              className="underline decoration-[var(--klaridian-accent)] underline-offset-4 mx-2.5"
            >
              View on GitHub
            </a>
          </div>
        </div>
      </section>

      <footer className="border-t-[3px] border-[var(--klaridian-ink)] py-5">
        <div className="max-w-[860px] mx-auto px-5 flex justify-between text-[11px] text-[#666]">
          <span>MIT LICENSE</span>
          <span>BUILT ON THE OFFICIAL MCP SDK</span>
        </div>
      </footer>
    </main>
  );
}
