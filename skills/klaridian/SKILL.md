---
name: klaridian
description: Generate a Model Context Protocol (MCP) server from an OpenAPI or Swagger spec with the klaridian CLI, in TypeScript or Python, with tool curation, upstream auth, and optional OpenTelemetry or product-analytics instrumentation. Use when the user wants to turn a REST API, an OpenAPI/Swagger file, or an API URL into an MCP server, curate which endpoints become agent tools, or run, deploy, or publish a klaridian-generated server.
license: MIT
compatibility: Needs the klaridian CLI (npx, npm, pip, or Homebrew) and a shell. Running a generated server needs Node.js 22+ (TypeScript) or Python 3.11+ (Python).
metadata:
  homepage: https://klaridian.dev
  source: https://github.com/klaridian/klaridian
---

# klaridian

klaridian is a CLI that turns an OpenAPI 3.x or Swagger 2.0 spec into a runnable, stateless MCP server on the official MCP SDK. The output is plain source code the user owns. Nothing from klaridian is needed at runtime.

## Before you run anything

1. **Find the spec.** A local `.json`/`.yaml` file or an `https://` URL. Ask for it if you can't find one; don't write a spec from memory.
2. **Pick the language.** TypeScript is the default. Pass `--language python` when the user's stack is Python.
3. **Pick the tools.** Most specs have far more operations than an agent should see. Curate before you generate (next section).
4. **Always pass `--json`.** You get exactly one JSON value on stdout and no prose to parse.

Run it without installing anything:

```bash
npx klaridian generate --spec ./openapi.yaml --out ./my-server --json
```

If `klaridian` is already on `PATH` (installed with `npm install -g klaridian`, `pip install klaridian`, or Homebrew), call it directly.

## Curate the tool surface

By default every operation becomes a tool, so a large spec produces a large tool list, and a large tool list costs the agent context and makes it pick wrong tools. Before generating for real, check the size, then narrow it.

- **Tags**: `--include-tags pet,store` or `--exclude-tags internal,admin`.
- **Path regex and HTTP method**: `--include-paths '^/v1/customers'`, `--exclude-paths '^/internal/'`, `--include-methods get,post`, `--exclude-methods delete`. Use these when the spec has no tags.
- **Single operations**: `--exclude-operation-ids deleteAccount,purgeData`.
- **In the spec itself**: an `x-klaridian` object on an operation. `expose: false` hides it, `title` sets the display title, and `readOnly`, `destructive`, and `openWorld` override the method-derived MCP annotations.

Tag filters and path/method filters combine: an operation must pass both. The result JSON tells you what happened: `toolCount` is what was emitted and `curatedFromTotal` is the operation count before filtering (`null` when nothing was filtered).

To see the size first, generate into a scratch directory and read `toolCount`, then regenerate with filters. Ask the user which areas of the API the agent needs rather than guessing. If they need most of a large API, suggest `--architecture code-mode` instead: it emits two tools (`search_docs`, `execute_code`) over a typed client run in a Deno sandbox. Code-mode is TypeScript-only, needs an absolute `--base-url`, and the generated server needs Deno installed to run.

Never pass `--interactive` yourself. It needs a human at a terminal and fails with `INTERACTIVE_REQUIRES_TTY` when standard input isn't a TTY.

## Common flags

| Need | Flag |
|---|---|
| Server name | `--name my-server` |
| Upstream base URL (required if the spec's `servers` is missing or relative) | `--base-url https://api.example.com` |
| Python output | `--language python` |
| HTTP instead of stdio | `--transport streamable-http --port 3000` |
| Tracing over OTLP | `--plugin otel --plugin-config otel.serviceName=my-server` |
| Product analytics | `--plugin posthog`, `amplitude`, or `mixpanel` (run `klaridian plugins list --json` for required configuration) |
| Install and build right after generating | `--install` |
| Overwrite a non-empty `--out` | `--force` (only with the user's OK: it replaces the directory's contents) |
| Reuse settings | `--config ./klaridian.config.json` (found automatically in the current directory) |
| Publish to the MCP Registry | `--registry-name io.github.owner/server` |

One plugin per server. For every flag, run `klaridian generate --help` or read https://klaridian.dev/docs/reference/cli-reference.

## Read the result

Success:

```json
{ "success": true, "outputDir": "/abs/my-server", "toolCount": 12, "curatedFromTotal": 594,
  "language": "typescript", "transport": "stdio", "nextSteps": "cd /abs/my-server && npm install && npm run build && npm start",
  "warnings": [] }
```

Show the user `warnings` and follow `nextSteps`.

Failure: `success` is `false`, the process exits non-zero, and `code` says what went wrong. Branch on `code`, never on the `error` text.

| `code` | What to do |
|---|---|
| `VALIDATE_CURATION` | A filter matched nothing or named an unknown tag. The `error` lists the real tags; fix the filter. |
| `CHECK_OUTPUT_DIR` | `--out` isn't empty. Pick a new directory, or ask before adding `--force`. |
| `VALIDATE_PLUGIN` | Unknown plugin or missing `--plugin-config`. |
| `CONFIG_FILE` | The configuration file is missing or malformed. |
| `INTERACTIVE_REQUIRES_TTY` | Drop `--interactive`; use curation flags. |
| `UNEXPECTED` | A klaridian bug. Report it with the `error` text. |

If the error says the spec's `info.version` isn't a valid semantic version, pass `--server-version 1.0.0` (or the version the user wants).

## Run the generated server

The server calls the upstream API with credentials from environment variables, chosen from the spec's `securitySchemes`:

- `KLARIDIAN_BASE_URL`: upstream base URL, unless it was baked in with `--base-url`.
- `KLARIDIAN_AUTH_TOKEN` (bearer), `KLARIDIAN_API_KEY` (API key), `KLARIDIAN_BASIC_USER` and `KLARIDIAN_BASIC_PASS` (basic), or `KLARIDIAN_OAUTH_TOKEN` (OAuth 2 or OpenID Connect).

Ask the user for credentials, or have them set the variables. Never write secrets into generated files.

Then:

- **TypeScript**: `npm install && npm run build`, then `npm start`.
- **Python**: `python -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt`, then `python server.py`.
- Or `klaridian start ./my-server` for either language, once the project is built.

A stdio server is launched by the MCP client (Claude Desktop, Claude Code, Cursor, and others) as a child process: point the client's configuration at the start command. To inspect one by hand, run `npx @modelcontextprotocol/inspector node dist/server.bundle.js`.

`klaridian deploy ./my-server --target docker` (or `cloudflare`, `fly`) writes deploy configuration for a streamable-http server. It doesn't deploy; the platform's own CLI does that.

## Rules

- Regenerate instead of editing generated files. They start with `DO NOT EDIT`.
- Generating doesn't touch the network unless you pass a spec URL, `--oauth-issuer`, or `--allow-external-refs`. Keep it that way for sensitive specs.
- More detail: https://klaridian.dev/llms.txt (docs index for agents) and https://klaridian.dev/docs.
