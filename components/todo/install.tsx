"use client";

// Phone app support: registers the service worker and keeps the browser's
// install prompt so the Setup view can offer an "Install app" button.
import { useEffect, useSyncExternalStore } from "react";

type InstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export type InstallState = "installed" | "available" | "ios" | "unsupported";

let deferred: InstallPrompt | null = null;
let installed = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

if (typeof window !== "undefined") {
  // The browser fires this once, early. Keep it for later.
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferred = event as InstallPrompt;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    installed = true;
    deferred = null;
    notify();
  });
}

function snapshot(): InstallState {
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (installed || standalone) return "installed";
  if (deferred) return "available";
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return ios ? "ios" : "unsupported";
}

export function useInstall() {
  const state = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    snapshot,
    () => "unsupported" as InstallState,
  );
  const install = async () => {
    if (!deferred) return;
    const prompt = deferred;
    deferred = null;
    await prompt.prompt();
    const choice = await prompt.userChoice;
    if (choice.outcome === "accepted") installed = true;
    notify();
  };
  return { state, install };
}

/** Registers the service worker in production builds. */
export function ServiceWorker() {
  useEffect(() => {
    // In local preview the dev server rebuilds files constantly; a worker would get in the way.
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // The app works the same without it; only offline support is lost.
    });
  }, []);
  return null;
}
