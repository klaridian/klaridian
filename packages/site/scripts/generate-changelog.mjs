#!/usr/bin/env node
// Derive per-version MDX changelog entries from the root CHANGELOG.md.
//
// The root CHANGELOG.md (Keep a Changelog format) is the SINGLE SOURCE OF
// TRUTH for release notes. This script splits its `## [x.y.z] - date` sections
// into individual `content/changelog/<version>.mdx` files carrying `version`
// and `date` frontmatter, so the Fumadocs /changelog route renders the same
// content without anyone hand-authoring it (same "derive, don't duplicate"
// rule as --version and cli-reference.mdx). The [Unreleased] section is
// intentionally skipped — it is not a shipped release.
//
// Run from packages/site: `node scripts/generate-changelog.mjs`
// Wired as a prebuild step so the site always reflects the committed CHANGELOG.

import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const siteRoot = join(here, '..');
// packages/site -> packages -> repo root
const repoRoot = join(siteRoot, '..', '..');
const changelogPath = join(repoRoot, 'CHANGELOG.md');
const outDir = join(siteRoot, 'content', 'changelog');

const raw = readFileSync(changelogPath, 'utf8');
const lines = raw.split('\n');

// Match a versioned release heading: "## [0.2.0] - 2026-09-13".
// Deliberately NOT matching "## [Unreleased]" (no version → skipped).
const headingRe = /^##\s+\[(\d+\.\d+\.\d+)\]\s*-\s*(\d{4}-\d{2}-\d{2})\s*$/;
// Stop a section at the next "## [" heading (any) or the reference-link block.
const anyH2Re = /^##\s+\[/;
const refLinkRe = /^\[[^\]]+\]:\s+http/;

const entries = [];
let current = null;

for (const line of lines) {
  const m = line.match(headingRe);
  if (m) {
    if (current) entries.push(current);
    current = { version: m[1], date: m[2], body: [] };
    continue;
  }
  if (current) {
    if (anyH2Re.test(line) || refLinkRe.test(line)) {
      entries.push(current);
      current = null;
      continue;
    }
    current.body.push(line);
  }
}
if (current) entries.push(current);

if (entries.length === 0) {
  console.error('generate-changelog: no versioned sections found in CHANGELOG.md');
  process.exit(1);
}

// Fresh output dir so a removed/renamed version never leaves a stale page.
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

for (const e of entries) {
  const body = e.body.join('\n').trim();
  const mdx = `---
title: v${e.version}
version: ${e.version}
date: ${e.date}
---

${body}
`;
  writeFileSync(join(outDir, `${e.version}.mdx`), mdx, 'utf8');
}

console.log(
  `generate-changelog: wrote ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'} to content/changelog/ (${entries
    .map((e) => e.version)
    .join(', ')})`,
);
