// packages/cli/src/cli-output.ts
//
// The step/warn/fail output helpers shared by `klaridian generate` and
// `klaridian init`. Both commands follow the same CLI-UX contract
// (ARCHITECTURE.md section 32, extended for init in section 53):
//
//   --json   one machine-readable JSON value on stdout, nothing else there
//   --quiet  suppress step-by-step progress (implied by --json)
//   warnings always recorded so they surface in --json's `warnings[]`, and
//            also printed to stderr unless --json
//   failure  a single `{ success:false, error, stage, warnings }` object on
//            stdout in --json mode, or a human `❌ message` line on stderr
//
// This module was extracted (MCPFO-38) once `init.ts` would otherwise have
// copied the three closures verbatim; `generate.ts`'s richer success-path
// JSON payload stays in that file since it isn't shared.

/** Failure payload written to stdout in --json mode by every `fail()` call. */
export interface CliFailResult {
  success: false;
  error: string;
  stage: string;
  warnings: string[];
}

export interface CliOutput {
  /** Human-readable-mode-only progress line; suppressed by --quiet and --json. */
  step: (msg: string) => void;
  /** Always recorded (surfaces in JSON's `warnings` array); also printed to stderr unless --json. */
  warn: (msg: string) => void;
  /**
   * Unified failure path: prints a single JSON error object to stdout in
   * --json mode (tagged with `stage` so a caller/agent can tell which step
   * failed without string-matching prose), or the human `❌ message` line on
   * stderr otherwise. Sets `process.exitCode = 1` either way. Callers still
   * need their own `return` right after calling this — it doesn't throw or
   * exit itself.
   */
  fail: (message: string, stage: string) => void;
  /** The live warnings buffer, so a caller can splice it into its own success payload. */
  warnings: string[];
}

export function createCliOutput(opts: { json: boolean; quiet: boolean }): CliOutput {
  const warnings: string[] = [];
  const jsonMode = opts.json;
  const quietMode = opts.quiet || opts.json;

  const step = (msg: string) => {
    if (!quietMode) console.error(msg);
  };
  const warn = (msg: string) => {
    warnings.push(msg);
    if (!jsonMode) console.error(msg);
  };
  const fail = (message: string, stage: string) => {
    process.exitCode = 1;
    if (jsonMode) {
      const result: CliFailResult = { success: false, error: message, stage, warnings };
      process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    } else {
      console.error(`❌ ${message}`);
    }
  };

  return { step, warn, fail, warnings };
}
