// packages/cli/src/plugins/mixpanel/mixpanel.plugin.ts
//
// Product-observability plugin #3 (ARCHITECTURE.md section 26).
//
// The vendored instrumentation file is assembled from the shared
// product-analytics template (ARCHITECTURE.md section 58); only this
// provider's SDK-specific pieces (import/init/capture) live here. Unlike
// posthog/amplitude it supplies no flush handlers — see the note below.

import type {
  ObservabilityPlugin,
  PluginConfigField,
  ResolvedPluginConfig,
  TemplateContribution,
} from "../plugin.interface.js";
import { buildProductAnalyticsInstrumentationFile } from "../shared/product-analytics-template.js";
import { buildPythonProductAnalyticsInstrumentationFile } from "../shared/product-analytics-python-template.js";

const CONFIG_SCHEMA: PluginConfigField[] = [];

function generateInstrumentationFile(_config: ResolvedPluginConfig): string {
  return buildProductAnalyticsInstrumentationFile({
    pluginId: "mixpanel",
    // stdio-safety note (checked directly against the installed package, not
    // assumed — see ARCHITECTURE.md section 26).
    stdioSafetyLines: [
      "The `mixpanel` (mixpanel-node) package has zero console.log/dir/info",
      "call sites in its published code (verified directly — see",
      "ARCHITECTURE.md section 26) — it only reports errors via callback,",
      "never writes to stdout on its own. Safe alongside stdio MCP transport",
      "for the same reason the OTel/PostHog/Amplitude plugins are (see",
      "spikes/001-otel-mechanic/FINDINGS.md for why that distinction matters).",
    ],
    importStatement: `import Mixpanel from "mixpanel";`,
    credentialEnvVar: "MIXPANEL_TOKEN",
    credentialDescription: "your Mixpanel project token",
    credentialConstName: "TOKEN",
    initStatements: `const mixpanel = Mixpanel.init(TOKEN);`,
    // No SIGINT/SIGTERM flush handlers, unlike PostHog/Amplitude: mixpanel-node's
    // track() sends each event over HTTP immediately rather than batching
    // client-side, so there's no in-memory queue that could be lost on process
    // exit (confirmed against the installed package, not assumed) — a real
    // difference between SDKs, not an oversight. Emitted as a comment into the
    // vendored file so the absence is documented for whoever audits it.
    flushHandlers: `// No explicit flush/shutdown handler here, unlike PostHog/Amplitude:
// mixpanel-node's track() sends each event over HTTP immediately rather than
// batching client-side, so there's no in-memory queue that could be lost on
// process exit (confirmed against the installed package, not assumed) — a real
// difference between SDKs, not an oversight.`,
    wrapFunctionName: "wrapMixpanelTool",
    identityConstName: "distinctId",
    captureStatement: ({ identityConst, success }) =>
      `mixpanel.track("mcp tool called", {
        distinct_id: ${identityConst},
        tool_name: toolName,
        duration_ms: Date.now() - startedAt,
        success: ${success},${success ? "" : "\n        error_message: String(err),"}
      });`,
  });
}

function generatePythonInstrumentationFile(_config: ResolvedPluginConfig): string {
  return buildPythonProductAnalyticsInstrumentationFile({
    pluginId: "mixpanel",
    stdioSafetyLines: [
      "The mixpanel Python SDK sends each event over HTTP and reports errors",
      "via the standard `logging` module — it never prints to stdout, so it is",
      "safe alongside the stdio MCP transport for the same reason the TS",
      "Mixpanel plugin is (see spikes/001-otel-mechanic/FINDINGS.md).",
    ],
    importStatement: `from mixpanel import Mixpanel`,
    credentialEnvVar: "MIXPANEL_TOKEN",
    credentialDescription: "your Mixpanel project token",
    credentialConstName: "TOKEN",
    initStatements: `mixpanel = Mixpanel(TOKEN)`,
    // No flush handler, matching the TS plugin: the mixpanel Python SDK's
    // track() sends each event over HTTP immediately rather than batching
    // client-side, so there's no in-memory queue to lose on exit.
    flushHandlers: `# No explicit flush handler here, unlike posthog/amplitude: the mixpanel
# Python SDK's track() sends each event over HTTP immediately rather than
# batching client-side, so there's no in-memory queue that could be lost on
# process exit — a real difference between SDKs, not an oversight.`,
    identityConstName: "distinct_id",
    captureStatement: ({ identityConst, success }) =>
      `mixpanel.track(
                ${identityConst},
                "mcp tool called",
                {
                    "tool_name": tool_name,
                    "duration_ms": int((time.monotonic() - started_at) * 1000),
                    "success": ${success ? "True" : "False"},${success ? "" : '\n                    "error_message": str(err),'}
                },
            )`,
  });
}

export const mixpanelPlugin: ObservabilityPlugin = {
  id: "mixpanel",
  name: "Mixpanel (product observability)",
  configSchema: CONFIG_SCHEMA,

  getTemplateContributions(config: ResolvedPluginConfig): TemplateContribution[] {
    return [
      {
        path: "src/instrumentation/mixpanel.ts",
        content: generateInstrumentationFile(config),
      },
    ];
  },

  getDependencies(): Record<string, string> {
    return {
      mixpanel: "^0.23.0",
    };
  },

  getServerWiring() {
    return {
      importStatement: `import { wrapMixpanelTool } from "./instrumentation/mixpanel.js";`,
      wrapFunctionName: "wrapMixpanelTool",
    };
  },

  python: {
    getTemplateContributions(config: ResolvedPluginConfig): TemplateContribution[] {
      return [
        {
          path: "instrumentation/mixpanel.py",
          content: generatePythonInstrumentationFile(config),
        },
      ];
    },
    getDependencies(): Record<string, string> {
      return {
        mixpanel: ">=4.10",
      };
    },
    importStatement: `from instrumentation.mixpanel import wrap_dispatch`,
    wrapFunctionName: "wrap_dispatch",
  },
};
