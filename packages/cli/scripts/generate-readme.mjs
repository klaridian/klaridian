#!/usr/bin/env node
// Generate packages/cli/README.md from the repository-root README.md so the npm
// package page has a README (npm only renders a README that ships INSIDE the
// published package, and the CLI package had none — see ARCHITECTURE.md).
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

let md = readFileSync(join(repoRoot, "README.md"), "utf8");

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

writeFileSync(join(cliDir, "README.md"), md);
console.log(
  `generate-readme: wrote packages/cli/README.md (links pinned to ${ref})`,
);
