// packages/cli/src/plugins/posthog/posthog.plugin.ts
//
// The product-observability plugin (PLAN.md section 2/4, ARCHITECTURE.md
// section 20 — the second plugin, proving the ObservabilityPlugin interface
// and multi-plugin composition actually generalize beyond OTel).
//
// Deliberately narrow scope for v0, mirroring the OTel plugin's own
// restraint: captures one event per tool call ("mcp tool called") with
// name/duration/success/error properties, using posthog-node's built-in
// batching + shutdown() flush. No feature flags, no session recording, no
// group analytics — those are real posthog-node capabilities but out of
// scope until there's a concrete need (same "don't guess, don't
// over-build" principle as the OTel plugin's OTLP-exporter-only choice).
//
// The vendored instrumentation file is assembled from the shared
// product-analytics template (ARCHITECTURE.md section 58); only this
// provider's SDK-specific pieces (import/init/flush/capture) live here.

import type {
  ObservabilityPlugin,
  PluginConfigField,
  ResolvedPluginConfig,
  TemplateContribution,
} from "../plugin.interface.js";
import { buildProductAnalyticsInstrumentationFile } from "../shared/product-analytics-template.js";

const CONFIG_SCHEMA: PluginConfigField[] = [
  {
    key: "apiHost",
    prompt: "PostHog API host",
    default: "https://us.i.posthog.com",
    required: true,
  },
];

function generateInstrumentationFile(config: ResolvedPluginConfig): string {
  return buildProductAnalyticsInstrumentationFile({
    pluginId: "posthog",
    // stdio-safety note (unlike the OTel plugin, this one has NO equivalent
    // of spikes/001-otel-mechanic/FINDINGS.md's ConsoleSpanExporter finding).
    stdioSafetyLines: [
      "posthog-node only ever writes to console.error/console.warn internally",
      "(verified by inspecting its published dist/ directly), which go to",
      "stderr in Node — never stdout. So this is safe alongside stdio MCP",
      "transport the same way the OTel plugin's OTLPTraceExporter is (see",
      "spikes/001-otel-mechanic/FINDINGS.md for why that distinction matters).",
    ],
    importStatement: `import { PostHog } from "posthog-node";`,
    credentialEnvVar: "POSTHOG_API_KEY",
    credentialDescription: "your PostHog project API key",
    credentialConstName: "API_KEY",
    initStatements: `const API_HOST = process.env.POSTHOG_API_HOST || ${JSON.stringify(config.apiHost)};

const posthog = new PostHog(API_KEY, { host: API_HOST });`,
    // Flush on exit — posthog-node batches events internally, so an unflushed
    // batch is lost on process exit otherwise (same class of bug as OTel's
    // BatchSpanProcessor finding in spikes/001-otel-mechanic/FINDINGS.md).
    flushHandlers: `process.on("SIGINT", () => posthog.shutdown().finally(() => process.exit(0)));
process.on("SIGTERM", () => posthog.shutdown().finally(() => process.exit(0)));`,
    wrapFunctionName: "wrapPostHogTool",
    identityConstName: "distinctId",
    captureStatement: ({ identityConst, success }) =>
      `posthog.capture({
        distinctId: ${identityConst},
        event: "mcp tool called",
        properties: {
          tool_name: toolName,
          duration_ms: Date.now() - startedAt,
          success: ${success},${success ? "" : "\n          error_message: String(err),"}
        },
      });`,
  });
}

export const posthogPlugin: ObservabilityPlugin = {
  id: "posthog",
  name: "PostHog (product observability)",
  configSchema: CONFIG_SCHEMA,

  getTemplateContributions(config: ResolvedPluginConfig): TemplateContribution[] {
    return [
      {
        path: "src/instrumentation/posthog.ts",
        content: generateInstrumentationFile(config),
      },
    ];
  },

  getDependencies(): Record<string, string> {
    return {
      "posthog-node": "^5.0.0",
    };
  },

  getServerWiring() {
    return {
      importStatement: `import { wrapPostHogTool } from "./instrumentation/posthog.js";`,
      wrapFunctionName: "wrapPostHogTool",
    };
  },
};
