// packages/cli/src/curation/interactive.ts
//
// Interactive tag-checkbox prompt for tool curation (ARCHITECTURE.md
// section 24). Kept in its own module, separate from curation.ts's pure
// logic, so the pure functions (summarizeTags, applyCurationToSpec, etc.)
// stay unit-testable without needing to drive a terminal prompt.

import { checkbox } from "@inquirer/prompts";
import type { CurationChoice, OperationSummary } from "./curation.js";
import { summarizeTags } from "./curation.js";

/**
 * Shows the user a checkbox list of every tag in the spec (pre-checked —
 * default is "include everything," matching openapi-mcp-generator's own
 * default), and returns a CurationChoice reflecting what they left checked.
 *
 * Deliberately tag-level, not operation-level, for the interactive prompt —
 * most real specs group operations into a manageable number of tags (tens,
 * not hundreds), so this stays usable even against a large spec. Per-
 * operationId exclusion remains available via --exclude-operation-ids for
 * finer-grained scripted control.
 */
export async function promptForCurationChoice(operations: OperationSummary[]): Promise<CurationChoice> {
  const tagSummaries = summarizeTags(operations).filter((t) => t.tag !== "(untagged)");

  if (tagSummaries.length === 0) {
    // No tags in this spec at all — nothing to curate interactively at the
    // tag level. Return an empty choice (include everything) rather than
    // prompting over an empty list.
    return {};
  }

  const selectedTags = await checkbox({
    message: `This spec has ${operations.length} operations across ${tagSummaries.length} tags. Choose which tags to include (space to toggle, enter to confirm):`,
    choices: tagSummaries.map(({ tag, count }) => ({
      name: `${tag} (${count} operation${count === 1 ? "" : "s"})`,
      value: tag,
      checked: true,
    })),
  });

  if (selectedTags.length === tagSummaries.length) {
    // Everything stayed checked — no filtering needed, avoid an
    // includeTags list that's functionally "include all" but adds noise.
    return {};
  }

  return { includeTags: selectedTags };
}
