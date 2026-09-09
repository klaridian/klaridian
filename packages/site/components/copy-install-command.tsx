"use client";

import { useState } from "react";

const CHANNELS = [
  { label: "npm", cmd: "npm install -g klaridian" },
  { label: "pip", cmd: "pip install klaridian" },
  { label: "brew", cmd: "brew install klaridian/klaridian/klaridian" },
];

export function CopyInstallCommand() {
  const [active, setActive] = useState(0);
  const [copied, setCopied] = useState(false);

  const current = CHANNELS[active];

  const onCopy = () => {
    navigator.clipboard.writeText(current.cmd);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div
      className="border-[3px] border-[var(--klaridian-ink)] bg-[var(--klaridian-ink)] text-[var(--klaridian-paper)] mx-auto max-w-[560px]"
      style={{ boxShadow: "8px 8px 0 var(--klaridian-accent)" }}
    >
      <div className="flex justify-between items-center px-3.5 py-2 border-b border-[#444] text-[11px] text-[#999]">
        <div className="flex gap-1.5">
          {CHANNELS.map((c, i) => (
            <button
              key={c.label}
              onClick={() => {
                setActive(i);
                setCopied(false);
              }}
              className={
                i === active
                  ? "px-2 py-0.5 font-extrabold text-[var(--klaridian-ink)] bg-[var(--klaridian-accent)]"
                  : "px-2 py-0.5 hover:text-[var(--klaridian-paper)]"
              }
            >
              {c.label}
            </button>
          ))}
        </div>
        <button
          onClick={onCopy}
          className="bg-[var(--klaridian-accent)] text-[var(--klaridian-ink)] font-extrabold text-[11px] px-2.5 py-1"
        >
          {copied ? "COPIED ✓" : "COPY"}
        </button>
      </div>
      <pre className="px-5 pt-[22px] pb-[26px] text-base overflow-x-auto text-left">
        <span className="text-[var(--klaridian-accent)]">$</span> {current.cmd}
        {"\n"}
        <span className="text-[#888] text-xs block mt-2.5">
          {active === 0
            ? "# Node.js · or run once with: npx klaridian generate ..."
            : "# prebuilt native binary · no Node.js required"}
        </span>
      </pre>
    </div>
  );
}
