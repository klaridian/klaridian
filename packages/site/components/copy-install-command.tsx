"use client";

import { useState } from "react";

const CHANNELS = [
  {
    label: "npx",
    cmd: "npx klaridian generate --spec ./api.yaml --out ./server",
    note: "# Node.js · run once, nothing installed — recommended",
  },
  {
    label: "npm",
    cmd: "npm install -g klaridian",
    note: "# Node.js · installs the klaridian command globally",
  },
  {
    label: "pip",
    cmd: "pip install klaridian",
    note: "# prebuilt native binary · no Node.js required",
  },
  {
    label: "brew",
    cmd: "brew tap klaridian/klaridian && brew install klaridian",
    note: "# prebuilt native binary · no Node.js required",
  },
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
    <div className="border border-fd-border bg-fd-card rounded-xl mx-auto max-w-[560px] overflow-hidden">
      <div className="flex justify-between items-center px-3.5 py-2 border-b border-fd-border text-[11px] text-fd-muted-foreground">
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
                  ? "px-2.5 py-0.5 rounded font-semibold text-[#04120b] bg-[var(--klaridian-accent)]"
                  : "px-2.5 py-0.5 rounded hover:text-fd-foreground transition-colors"
              }
            >
              {c.label}
            </button>
          ))}
        </div>
        <button
          onClick={onCopy}
          className="text-[var(--klaridian-accent)] font-semibold text-[11px] px-2.5 py-1 hover:opacity-80"
        >
          {copied ? "COPIED ✓" : "COPY"}
        </button>
      </div>
      <pre className="px-5 pt-[22px] pb-[26px] text-sm overflow-x-auto text-left font-mono text-fd-foreground">
        <span className="text-[var(--klaridian-accent)]">$</span> {current.cmd}
        {"\n"}
        <span className="text-fd-muted-foreground text-xs block mt-2.5">
          {current.note}
        </span>
      </pre>
    </div>
  );
}
