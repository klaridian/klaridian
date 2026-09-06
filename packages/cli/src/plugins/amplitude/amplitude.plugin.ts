// packages/cli/src/plugins/amplitude/amplitude.plugin.ts
//
// Product-observability plugin #2 (ARCHITECTURE.md section 26 — multiple
// product-analytics providers, since unlike OTel/OTLP on the engineering
// side, there is no analogous open standard/wire-protocol on the product
// side that would let one plugin fan out to every backend).
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
import { buildPythonProductAnalyticsInstrumentationFile } from "../shared/product-analytics-python-template.js";

const CONFIG_SCHEMA: PluginConfigField[] = [
  {
    key: "serverZone",
    prompt: "Amplitude server zone (US or EU)",
    default: "US",
    required: true,
  },
];

function generateInstrumentationFile(config: ResolvedPluginConfig): string {
  return buildProductAnalyticsInstrumentationFile({
    pluginId: "amplitude",
    // stdio-safety note (checked directly against the installed package, not
    // assumed — see ARCHITECTURE.md section 26).
    stdioSafetyLines: [
      "@amplitude/analytics-node's own Logger defaults to LogLevel.None",
      "(verified directly against the installed package — see ARCHITECTURE.md",
      "section 26) — never writes to stdout unless a caller explicitly raises",
      "the log level, which this file does not do. Safe alongside stdio MCP",
      "transport for the same reason the OTel/PostHog plugins are (see",
      "spikes/001-otel-mechanic/FINDINGS.md for why that distinction matters).",
    ],
    importStatement: `import { init, track, flush } from "@amplitude/analytics-node";`,
    credentialEnvVar: "AMPLITUDE_API_KEY",
    credentialDescription: "your Amplitude project API key",
    credentialConstName: "API_KEY",
    initStatements: `const SERVER_ZONE = (process.env.AMPLITUDE_SERVER_ZONE || ${JSON.stringify(
      config.serverZone
    )}) as "US" | "EU";

init(API_KEY, { serverZone: SERVER_ZONE });`,
    // Flush on exit — the SDK batches events internally (flushQueueSize/
    // flushIntervalMillis), so an unflushed batch is lost on process exit
    // otherwise (same class of bug as OTel's BatchSpanProcessor finding).
    flushHandlers: `process.on("SIGINT", () => flush().promise.finally(() => process.exit(0)));
process.on("SIGTERM", () => flush().promise.finally(() => process.exit(0)));`,
    wrapFunctionName: "wrapAmplitudeTool",
    identityConstName: "deviceId",
    captureStatement: ({ identityConst, success }) =>
      `track(
        "mcp tool called",
        {
          tool_name: toolName,
          duration_ms: Date.now() - startedAt,
          success: ${success},${success ? "" : "\n          error_message: String(err),"}
        },
        { device_id: ${identityConst} }
      );`,
  });
}

function generatePythonInstrumentationFile(config: ResolvedPluginConfig): string {
  return buildPythonProductAnalyticsInstrumentationFile({
    pluginId: "amplitude",
    stdioSafetyLines: [
      "The amplitude-analytics Python SDK logs via the standard `logging`",
      "module and never prints to stdout, so it is safe alongside the stdio",
      "MCP transport for the same reason the TS Amplitude plugin is (see",
      "spikes/001-otel-mechanic/FINDINGS.md for why that distinction matters).",
    ],
    importStatement: `from amplitude import Amplitude, BaseEvent`,
    credentialEnvVar: "AMPLITUDE_API_KEY",
    credentialDescription: "your Amplitude project API key",
    credentialConstName: "API_KEY",
    initStatements: `SERVER_ZONE = os.environ.get("AMPLITUDE_SERVER_ZONE") or ${JSON.stringify(
      config.serverZone
    )}

amplitude = Amplitude(API_KEY, server_zone=SERVER_ZONE)`,
    // The SDK batches events; flush on exit so a short-lived stdio server
    // doesn't drop the final batch.
    flushHandlers: `import atexit

atexit.register(amplitude.flush)`,
    identityConstName: "device_id",
    captureStatement: ({ identityConst, success }) =>
      `amplitude.track(
                BaseEvent(
                    event_type="mcp tool called",
                    device_id=${identityConst},
                    event_properties={
                        "tool_name": tool_name,
                        "duration_ms": int((time.monotonic() - started_at) * 1000),
                        "success": ${success ? "True" : "False"},${success ? "" : '\n                        "error_message": str(err),'}
                    },
                )
            )`,
  });
}

export const amplitudePlugin: ObservabilityPlugin = {
  id: "amplitude",
  name: "Amplitude (product observability)",
  configSchema: CONFIG_SCHEMA,

  getTemplateContributions(config: ResolvedPluginConfig): TemplateContribution[] {
    return [
      {
        path: "src/instrumentation/amplitude.ts",
        content: generateInstrumentationFile(config),
      },
    ];
  },

  getDependencies(): Record<string, string> {
    return {
      "@amplitude/analytics-node": "^1.5.0",
    };
  },

  getServerWiring() {
    return {
      importStatement: `import { wrapAmplitudeTool } from "./instrumentation/amplitude.js";`,
      wrapFunctionName: "wrapAmplitudeTool",
    };
  },

  python: {
    getTemplateContributions(config: ResolvedPluginConfig): TemplateContribution[] {
      return [
        {
          path: "instrumentation/amplitude.py",
          content: generatePythonInstrumentationFile(config),
        },
      ];
    },
    getDependencies(): Record<string, string> {
      return {
        "amplitude-analytics": ">=1.1",
      };
    },
    importStatement: `from instrumentation.amplitude import wrap_dispatch`,
    wrapFunctionName: "wrap_dispatch",
  },
};
