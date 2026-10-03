"use client";

import { useSyncExternalStore } from "react";
import type { BillEntry, UserSettings } from "./lib/hunt-types";
import type { Position } from "./lib/route-planner";
import { billStore, positionStore, settingsStore } from "./lib/user-state";

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

export function usePosition(): Position | undefined {
  return useSyncExternalStore(positionStore.subscribe, positionStore.getSnapshot, positionStore.getServerSnapshot);
}
