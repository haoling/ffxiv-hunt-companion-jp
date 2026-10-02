"use client";

import { useSyncExternalStore } from "react";
import type { BillEntry, UserSettings } from "./lib/hunt-types";
import { billStore, settingsStore } from "./lib/user-state";

const noopSubscribe = () => () => {};

/** クライアントで localStorage を読めるようになったか（ハイドレーション前の空表示を避ける） */
export function useHydrated(): boolean {
  return useSyncExternalStore(noopSubscribe, () => true, () => false);
}

export function useBills(): BillEntry[] {
  return useSyncExternalStore(billStore.subscribe, billStore.getSnapshot, billStore.getServerSnapshot);
}

export function useSettings(): UserSettings {
  return useSyncExternalStore(settingsStore.subscribe, settingsStore.getSnapshot, settingsStore.getServerSnapshot);
}
