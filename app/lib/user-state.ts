// ユーザーの状態（手配書の行と個人設定）の保存（PLAN §6、§9）。

import { createStore } from "./create-store";
import type { BillEntry, GrandCompany, HuntTarget, TravelPreference, UserSettings } from "./hunt-types";
import { isExpired } from "./reset";

const TRAVEL_PREFERENCES: TravelPreference[] = ["teleport", "fly", "walk"];
const GRAND_COMPANIES: GrandCompany[] = ["maelstrom", "twinAdder", "immortalFlames"];

const EMPTY_BILLS: BillEntry[] = [];
const DEFAULT_SETTINGS: UserSettings = { travelPreference: "teleport" };

function parseBills(raw: unknown): BillEntry[] {
  if (!Array.isArray(raw)) return EMPTY_BILLS;
  const entries: BillEntry[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const e = item as Record<string, unknown>;
    if (
      typeof e.targetId === "number" &&
      typeof e.neededKills === "number" &&
      typeof e.done === "boolean" &&
      typeof e.addedAt === "string"
    ) {
      entries.push({
        targetId: e.targetId,
        neededKills: e.neededKills,
        done: e.done,
        source: e.source === "ocr" ? "ocr" : "manual",
        addedAt: e.addedAt,
      });
    }
  }
  return entries;
}

function parseSettings(raw: unknown): UserSettings {
  if (typeof raw !== "object" || raw === null) return DEFAULT_SETTINGS;
  const s = raw as Record<string, unknown>;
  return {
    grandCompany: GRAND_COMPANIES.find((g) => g === s.grandCompany),
    defaultCityId: typeof s.defaultCityId === "string" ? s.defaultCityId : undefined,
    travelPreference: TRAVEL_PREFERENCES.find((p) => p === s.travelPreference) ?? "teleport",
  };
}

export const billStore = createStore("hunt-companion:v1:bills", parseBills, EMPTY_BILLS);
export const settingsStore = createStore("hunt-companion:v1:settings", parseSettings, DEFAULT_SETTINGS);

/** 対象を手配書に追加する。すでにあるときは討伐体数だけ更新する */
export function addEntry(target: HuntTarget, neededKills: number) {
  billStore.update((bills) => {
    if (bills.some((b) => b.targetId === target.id)) {
      return bills.map((b) => (b.targetId === target.id ? { ...b, neededKills } : b));
    }
    return [...bills, { targetId: target.id, neededKills, done: false, source: "manual", addedAt: new Date().toISOString() }];
  });
}

export function removeEntry(targetId: number) {
  billStore.update((bills) => bills.filter((b) => b.targetId !== targetId));
}

export function toggleDone(targetId: number) {
  billStore.update((bills) => bills.map((b) => (b.targetId === targetId ? { ...b, done: !b.done } : b)));
}

export function clearEntries() {
  billStore.update(() => EMPTY_BILLS);
}

export function updateSettings(patch: Partial<UserSettings>) {
  settingsStore.update((s) => ({ ...s, ...patch }));
}

/** リセット時刻を過ぎた手配書の行を取り除く（日次はデイリー、週次はエリート） */
export function purgeExpired(kindOf: (targetId: number) => HuntTarget["kind"] | undefined, now = Date.now()) {
  const bills = billStore.getSnapshot();
  const kept = bills.filter((b) => {
    const kind = kindOf(b.targetId);
    return kind !== undefined && !isExpired(b, kind, now);
  });
  if (kept.length !== bills.length) billStore.update(() => kept);
}
