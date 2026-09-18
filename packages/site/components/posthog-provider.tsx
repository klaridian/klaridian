"use client";

import posthog from "posthog-js";
import { PostHogProvider as PHProvider } from "posthog-js/react";
import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense } from "react";

const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://eu.i.posthog.com";

// Consent gate: we start fully opted-OUT and cookieless. Nothing is captured and
// no persistent storage is used until the visitor explicitly opts in via the
// banner. Do Not Track is respected (posthog-js honors respect_dnt).
export const CONSENT_KEY = "klaridian_analytics_consent"; // 'yes' | 'no'

function hasConsent(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(CONSENT_KEY) === "yes";
}

export function grantConsent() {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(CONSENT_KEY, "yes");
  // Switch to durable storage and start capturing.
  posthog.set_config({ persistence: "localStorage+cookie" });
  posthog.opt_in_capturing();
}

export function denyConsent() {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(CONSENT_KEY, "no");
  posthog.opt_out_capturing();
}

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (!KEY) return; // No key configured (e.g. local/CI) — PostHog stays dormant.
    posthog.init(KEY, {
      api_host: HOST,
      ui_host: "https://eu.posthog.com",
      // Cookieless until opt-in: memory persistence + opted out by default.
      persistence: "memory",
      opt_out_capturing_by_default: true,
      respect_dnt: true,
      capture_pageview: false, // handled manually below so it's consent-gated
      capture_pageleave: true,
      autocapture: false, // explicit events only; no broad DOM autocapture
      disable_session_recording: true,
    });
    if (hasConsent()) grantConsent();
  }, []);

  if (!KEY) return <>{children}</>;

  return (
    <PHProvider client={posthog}>
      <Suspense fallback={null}>
        <PageViewTracker />
      </Suspense>
      {children}
    </PHProvider>
  );
}

// Manual pageview capture (App Router has no page event). No-ops until consent
// because posthog is opted out, so this is safe to always mount.
function PageViewTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!KEY || !hasConsent()) return;
    let url = window.origin + pathname;
    const qs = searchParams?.toString();
    if (qs) url += "?" + qs;
    posthog.capture("$pageview", { $current_url: url });
  }, [pathname, searchParams]);

  return null;
}
