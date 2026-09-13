import { defineDocs, defineConfig } from 'fumadocs-mdx/config';
import { frontmatterSchema } from 'fumadocs-mdx/config';
import { z } from 'zod';

export const docs = defineDocs({
  dir: 'content/docs',
});

// A SEPARATE collection for release notes — NOT a page inside content/docs.
// Release notes differ from reference docs in audience, shape (a
// reverse-chronological feed), and schema (each entry carries version/date).
// The .mdx files here are DERIVED from the root CHANGELOG.md by
// scripts/generate-changelog.mjs (the single source of truth); they are
// git-ignored, never hand-authored. See ARCHITECTURE.md §76.
export const changelog = defineDocs({
  dir: 'content/changelog',
  docs: {
    schema: frontmatterSchema.extend({
      version: z.string(),
      date: z.string(),
    }),
  },
});

export default defineConfig();
