#!/usr/bin/env node
// Generate the registry READMEs from the repository-root README.md:
//   --target npm  (default) -> packages/cli/README.md, so the npm package page
//                   has a README (npm only renders a README that ships INSIDE
//                   the published package, and the CLI package had none).
//   --target pypi -> packaging/pypi/README.md, the wheel's long_description
//                   (MCPFO-120; was a hand-written stub that drifted).
//
// The root README uses repo-relative links (assets/banner.png, ARCHITECTURE.md,
// LICENSE, ...) that resolve on GitHub but 404 on npm. This rewrites every
// relative target to an absolute GitHub URL pinned to the release tag `v<version>`
// (so a given npm version's README points at that version's sources, not a
// moving `main`):
//   - images  -> https://raw.githubusercontent.com/<repo>/v<version>/<path>   (renders inline)
//   - links   -> https://github.com/<repo>/blob/v<version>/<path>             (navigates)
// Anchors (#...) and already-absolute (http/https/mailto) targets are left as-is.
//
// Runs from `prepack`, so `npm publish`/`npm pack` always ship a fresh, correct
// README. The generated packages/cli/README.md is git-ignored (derived artifact,
// single source of truth is the root README) — same "derive, don't duplicate"
// rule the repo uses for --version and cli-reference.mdx.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const REPO = "klaridian/klaridian";
const here = dirname(fileURLToPath(import.meta.url));
const cliDir = join(here, "..");
const repoRoot = join(cliDir, "..", "..");

const version = JSON.parse(
  readFileSync(join(cliDir, "package.json"), "utf8"),
).version;
const ref = `v${version}`;
const rawBase = `https://raw.githubusercontent.com/${REPO}/${ref}`;
const blobBase = `https://github.com/${REPO}/blob/${ref}`;

const isAbsolute = (t) => /^(https?:|mailto:|#)/i.test(t);

// Split a link target into path + optional #anchor, rewrite the path only.
function toAbsolute(target, base) {
  if (isAbsolute(target)) return target;
  const clean = target.replace(/^\.\//, "").replace(/^\//, "");
  const hashAt = clean.indexOf("#");
  const path = hashAt === -1 ? clean : clean.slice(0, hashAt);
  const anchor = hashAt === -1 ? "" : clean.slice(hashAt);
  if (!path) return target; // pure in-page anchor
  return `${base}/${path}${anchor}`;
}

// Target registry: `npm` (default, packages/cli/README.md) or `pypi`
// (packaging/pypi/README.md, the wheel's long_description). Both derive from the
// SAME root README so the two registry pages can't drift apart (MCPFO-120).
const target = process.argv.includes("--target")
  ? process.argv[process.argv.indexOf("--target") + 1]
  : "npm";
if (target !== "npm" && target !== "pypi") {
  throw new Error(`generate-readme: unknown --target "${target}" (expected npm or pypi)`);
}

let md = readFileSync(join(repoRoot, "README.md"), "utf8");

// PyPI's renderer (readme_renderer) doesn't give headings anchor ids, so
// in-page `#section` links would go nowhere there. Point them at the same
// anchor on the GitHub README instead. npm renders anchors, so it keeps them.
if (target === "pypi") {
  md = md.replace(
    /\]\((#[^)\s]+)\)/g,
    (match, anchor) => `](${blobBase}/README.md${anchor})`,
  );
}

// Rewrite Markdown image/link targets: the `!` prefix distinguishes an image
// (raw URL, must render) from a link (blob URL, must navigate).
md = md.replace(
  /(!?)\[([^\]]*)\]\(([^)\s]+)\)/g,
  (match, bang, text, target) => {
    const base = bang === "!" ? rawBase : blobBase;
    return `${bang}[${text}](${toAbsolute(target, base)})`;
  },
);

// Second pass for shield/badge links whose link TEXT is itself an image
// (`[![alt](img)](target)`): the outer link's text contains a `]`, so the
// single-pass regex above skips it and leaves `target` relative (e.g. the
// `](LICENSE)` MIT badge). Rewrite any link target still left relative.
md = md.replace(
  /\]\(([^)\s#][^)\s]*)\)/g,
  (match, target) =>
    isAbsolute(target) ? match : `](${toAbsolute(target, blobBase)})`,
);

// PyPI: add a channel note right under the tagline (the first `> ` quote),
// because a pip user needs to know this wheel is a native binary, not a
// Python library, before reading the npx-first install section.
if (target === "pypi") {
  const note =
    "> **This PyPI package is the klaridian CLI as a prebuilt native binary**—no Node.js, nothing to compile. " +
    "Install it with `pip install klaridian`, `uv tool install klaridian`, or `pipx install klaridian`. " +
    "It's the same CLI published to npm, shipped as platform-tagged wheels (the pattern ruff and uv use).";
  const taglineAt = md.search(/^> .*$/m);
  if (taglineAt === -1) {
    throw new Error("generate-readme: no `> ` tagline found in the root README to anchor the PyPI note");
  }
  const lineEnd = md.indexOf("\n", taglineAt);
  md = `${md.slice(0, lineEnd + 1)}\n${note}\n${md.slice(lineEnd + 1)}`;
}

const outPath =
  target === "pypi"
    ? join(repoRoot, "packaging", "pypi", "README.md")
    : join(cliDir, "README.md");
writeFileSync(outPath, md);
console.log(
  `generate-readme: wrote ${outPath.slice(repoRoot.length + 1)} (links pinned to ${ref})`,
);
