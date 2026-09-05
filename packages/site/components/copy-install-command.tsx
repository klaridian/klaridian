"use client";

import { useState } from "react";

const INSTALL_CMD = "npx klaridian generate --spec ./api.yaml";

export function CopyInstallCommand() {
  const [copied, setCopied] = useState(false);

  const onCopy = () => {
    navigator.clipboard.writeText(INSTALL_CMD);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div
      className="border-[3px] border-[var(--klaridian-ink)] bg-[var(--klaridian-ink)] text-[var(--klaridian-paper)] mx-auto mb-9 max-w-[620px]"
      style={{ boxShadow: "8px 8px 0 var(--klaridian-accent)" }}
    >
      <div className="flex justify-between px-3.5 py-2 border-b border-[#444] text-[11px] text-[#999]">
        <span>install.sh</span>
        <button
          onClick={onCopy}
          className="bg-[var(--klaridian-accent)] text-[var(--klaridian-ink)] font-extrabold text-[11px] px-2.5 py-1"
        >
          {copied ? "COPIED ✓" : "COPY"}
        </button>
      </div>
      <pre className="px-5 pt-[22px] pb-[26px] text-base overflow-x-auto text-left">
        <span className="text-[var(--klaridian-accent)]">$</span> {INSTALL_CMD}
        {"\n"}
        <span className="text-[#888] text-xs block mt-2.5">
          # → 31 tools · otel wired · dist/src/index.js ready
        </span>
      </pre>
    </div>
  );
}
