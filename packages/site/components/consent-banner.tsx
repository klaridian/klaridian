"use client";

import { useEffect, useState } from "react";
import { CONSENT_KEY, grantConsent, denyConsent } from "./posthog-provider";

// Minimal GDPR consent banner. Shows only when no choice has been recorded yet.
// Until the visitor chooses, analytics stay opted out and cookieless (see
// posthog-provider). If the browser sends Do Not Track, we auto-decline and
// never show the banner.
export function ConsentBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!process.env.NEXT_PUBLIC_POSTHOG_KEY) return; // nothing to consent to
    const dnt =
      window.navigator.doNotTrack === "1" ||
      // @ts-expect-error legacy vendor-prefixed flags
      window.doNotTrack === "1" ||
      window.navigator.doNotTrack === "yes";
    const existing = window.localStorage.getItem(CONSENT_KEY);
    if (dnt) {
      if (!existing) denyConsent();
      return;
    }
    if (!existing) setVisible(true);
  }, []);

  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-label="Analytics consent"
      className="fixed bottom-4 left-4 right-4 md:left-auto md:right-6 md:max-w-md z-50 border border-fd-border bg-fd-card rounded-xl p-4 shadow-lg"
    >
      <p className="text-sm text-fd-foreground mb-1 font-medium">
        A cookie-free look at what's useful
      </p>
      <p className="text-[13px] text-fd-muted-foreground mb-3 leading-relaxed">
        We'd like anonymous, cookieless analytics (EU-hosted) to see which docs
        help and which don't. Nothing is stored until you say yes.
      </p>
      <div className="flex gap-2">
        <button
          onClick={() => {
            grantConsent();
            setVisible(false);
          }}
          className="bg-[var(--klaridian-accent)] text-[#04120b] rounded-lg px-3.5 py-1.5 text-[13px] font-semibold hover:opacity-90"
        >
          Allow
        </button>
        <button
          onClick={() => {
            denyConsent();
            setVisible(false);
          }}
          className="border border-fd-border rounded-lg px-3.5 py-1.5 text-[13px] font-medium hover:border-[var(--klaridian-accent)]"
        >
          Decline
        </button>
      </div>
    </div>
  );
}
