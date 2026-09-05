# Documentation style

All prose documentation in this repository—the public site/docs (`packages/site/content/docs/`), `README.md`, `AGENTS.md`, `PLAN.md`, `ARCHITECTURE.md`, `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, package READMEs, and anything else meant to be read as prose—follows the **Microsoft Writing Style Guide** (<https://learn.microsoft.com/style-guide/>).

This applies to **existing content and all new/edited content going forward**, not just the pages written when this rule was adopted.

## Why Microsoft's guide, and the licensing basis for using it

The Microsoft Writing Style Guide's own text (on learn.microsoft.com) is copyrighted and not under an open license—we don't copy or redistribute that text here. What we adopt is the *style itself* (voice, terminology conventions, punctuation rules): a set of writing conventions isn't copyrightable, only a particular expression of them is. This is exactly the model the `errata-ai/Microsoft` (aka `vale-cli/Microsoft`) project already uses—an independent, **MIT-licensed** re-implementation of the guide's rules as a linter package for [Vale](https://vale.sh)—and it's the mechanism this repo uses to enforce the style. No conflict with klaridian's own MIT/Apache-2.0 licensing anywhere in this repo or its docs.

## Key conventions (the ones that most often need correcting)

- **Active voice, second person, present tense.** "Run the generator", not "The generator should be run" or "You will run the generator".
- **Contractions are fine and expected in prose** ("it's", "don't", "you're")—this isn't legal writing.
- **Sentence-case headings**, not Title Case ("Getting started", not "Getting Started"). *(Exception: this repo's existing ARCHITECTURE.md/PLAN.md numbered section headings predate this rule and are not being retrofitted—see [Scope](#scope-and-exceptions) below.)*
- **No end punctuation in headings or UI-style text** (no trailing periods or colons on headings).
- **Em dashes have no surrounding spaces**: `word—word`, not `word — word`. This was a deliberate, repo-wide fix (Sep 2026)—see `.github/vale/scripts/fix_em_dashes.py`, which safely reflows this without touching code blocks or inline code spans.
- **Avoid Latin abbreviations** in prose—"for example" instead of "e.g.", "that is" instead of "i.e.".
- **Spell out the first use of an acronym** the first time it appears in a page, when it isn't universally obvious in context (MCP, OTel, and similarly ubiquitous project-specific terms are treated as understood after the first doc page introduces them, not re-spelled out on every page).

## Deliberate deviations from the base Microsoft ruleset

The generic Microsoft/Vale package includes some rules that are actively wrong for an infrastructure/AI developer-tooling project. These are turned off project-wide in `.vale.ini`, not worked around case by case:

- **`Microsoft.Terms`**—disabled. The base rule wants to replace "agent" with "personal digital assistant", which is nonsensical here: "agent" is the correct, standard term for an LLM-driven client calling MCP tools.
- A **custom vocabulary** (`.github/vale/styles/config/vocabularies/klaridian/accept.txt`) allowlists project/domain terms that would otherwise trip `Vale.Spelling`—`klaridian`, `OpenAPI`, `MCP`, `OTel`, `OTLP`, `Deno`, `Zod`, `stdio`/`stdout`/`stderr`, `operationId`, `registerTool`, `execute_code`, `search_docs`, and similar.

If a Microsoft rule is flagged as a false positive for a *new* term not yet in the vocabulary, add the term to `accept.txt` rather than ignoring the warning inline—keep the linter meaningful for everyone who runs it after you.

## Enforcement: Vale

This repo lints prose with [Vale](https://vale.sh) configured against the MIT-licensed `Microsoft` style package (see `.vale.ini`). Install once (`brew install vale`), then:

```bash
vale sync              # pulls/updates the Microsoft style package into .github/vale/styles/
vale README.md         # lint a single file
vale packages/site/content/docs/**/*.mdx   # lint a directory
```

If Vale reports `'klaridian' vocabulary not found` even though `.vale.ini` and the vocabulary file are both present, set `VALE_STYLES_PATH` explicitly—Vale resolves the custom vocabulary against that environment variable, not `.vale.ini`'s project-relative `StylesPath`, and falls back to a global per-user directory otherwise (this is what CI's `docs-style` job sets):

```bash
export VALE_STYLES_PATH="$(pwd)/.github/vale/styles"
```

`vale sync`'s output directory (`.github/vale/styles/`) is generated, not hand-edited—don't patch rule files there directly; adjust `.vale.ini` or the vocabulary file instead, both of which are checked into version control.

### Before you write or edit documentation

1. Write normally, following the conventions above.
2. Run `vale` on the file(s) you touched before committing.
3. Fix genuine style violations. For a false positive on a real project term, add it to the vocabulary (see above) instead of ignoring it.
4. If you introduce many new em dashes with spaces around them (easy to do by habit), run `python3 .github/vale/scripts/fix_em_dashes.py <files...>` to reflow them automatically—it skips fenced code blocks and inline code spans, so it's safe to run broadly.

CI does not currently gate on Vale (not yet wired into `.github/workflows/ci.yml`—a reasonable follow-up, not done as part of adopting this rule). Until it is, this is an author/reviewer discipline, not an automated gate.

## Scope and exceptions

- **Code comments, commit messages, and Plane/issue-tracker text** are not covered by this rule—it's specifically for documentation meant to be read as prose (READMEs, guides, the public docs site, planning/architecture documents).
- **ARCHITECTURE.md and PLAN.md's existing numbered-section Title Case headings** (`## 43. Code-mode / search+execute design decision...`) are grandfathered as-is—converting ~50 historical section headings to sentence case has no reader benefit and would generate needless diff noise against a living document with cross-references (`ARCHITECTURE.md#43-...`) baked into many other files. **New sections added going forward should still prefer sentence case** where it doesn't break an existing anchor-naming pattern in the same document.
- Generated content (API reference tables, changelogs assembled from commit messages, etc.) is exempt where the source data itself doesn't follow prose conventions—for example, `packages/site/content/docs/cli-reference.mdx`, produced verbatim from `klaridian generate`'s real flag descriptions by `packages/cli/scripts/generate-cli-docs.mjs` (see AGENTS.md's working agreements). Fix wording by editing the flag's `.option()` description in `packages/cli/src/commands/generate.ts` and regenerating, not by hand-editing the `.mdx`.
