import { changelogSource } from '@/lib/source';
import defaultMdxComponents from 'fumadocs-ui/mdx';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Changelog',
  description: 'Release notes for klaridian, newest first.',
  alternates: {
    canonical: '/changelog',
  },
};

// Reverse-chronological feed of every shipped release. Entries are derived
// from the root CHANGELOG.md (scripts/generate-changelog.mjs) — single source
// of truth. See ARCHITECTURE.md §76.
export default function Page() {
  const pages = changelogSource
    .getPages()
    .sort((a, b) => b.data.version.localeCompare(a.data.version, undefined, { numeric: true }));

  return (
    <main className="container mx-auto max-w-3xl px-4 py-16">
      <header className="mb-12">
        <h1 className="font-mono text-3xl font-bold">
          klaridian<span className="text-[var(--klaridian-accent)]">()</span> changelog
        </h1>
        <p className="mt-2 text-fd-muted-foreground">
          Release notes, newest first. Also on{' '}
          <a
            href="https://github.com/klaridian/klaridian/releases"
            className="underline underline-offset-4"
          >
            GitHub Releases
          </a>
          .
        </p>
      </header>

      <div className="flex flex-col gap-16">
        {pages.map((page) => {
          const MDX = page.data.body;
          const date = new Date(page.data.date).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          });
          return (
            <section key={page.data.version} className="scroll-mt-20" id={`v${page.data.version}`}>
              <div className="mb-4 flex items-baseline gap-3">
                <a
                  href={`#v${page.data.version}`}
                  className="font-mono text-2xl font-bold text-[var(--klaridian-accent)]"
                >
                  v{page.data.version}
                </a>
                <time className="text-sm text-fd-muted-foreground" dateTime={page.data.date}>
                  {date}
                </time>
              </div>
              <div className="prose prose-fd max-w-none">
                <MDX components={{ ...defaultMdxComponents }} />
              </div>
            </section>
          );
        })}
      </div>
    </main>
  );
}
