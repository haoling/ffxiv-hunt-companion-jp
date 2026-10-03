// ユーザーの状態（手配書の行と個人設定）の保存（PLAN §6、§9）。

import { createStore } from "./create-store";
import type { Position } from "./route-planner";
import type { BillEntry, GrandCompany, HuntTarget, ThemePreference, TravelPreference, UserSettings } from "./hunt-types";

const TRAVEL_PREFERENCES: TravelPreference[] = ["teleport", "fly", "walk"];
const THEMES: ThemePreference[] = ["auto", "light", "dark"];
const GRAND_COMPANIES: GrandCompany[] = ["maelstrom", "twinAdder", "immortalFlames"];

const EMPTY_BILLS: BillEntry[] = [];
const DEFAULT_SETTINGS: UserSettings = { travelPreference: "teleport", theme: "auto" };

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
    theme: THEMES.find((t) => t === s.theme) ?? "auto",
  };
}

export const billStore = createStore("hunt-companion:v1:bills", parseBills, EMPTY_BILLS);

function parsePosition(raw: unknown): Position | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const p = raw as Record<string, unknown>;
  return typeof p.zoneId === "number" && typeof p.x === "number" && typeof p.y === "number"
    ? { zoneId: p.zoneId, x: p.x, y: p.y }
    : undefined;
}

export const settingsStore = createStore("hunt-companion:v1:settings", parseSettings, DEFAULT_SETTINGS);

/** 最後に倒した場所（現在地）。無いときはルートを出発地から計算する */
export const positionStore = createStore<Position | undefined>("hunt-companion:v1:position", parsePosition, undefined);

/** 現在地を忘れて、ルートを出発地から計算し直す */
export function clearPosition() {
  positionStore.update(() => undefined);
}

/**
 * 対象を手配書に追加する。すでにあるときは討伐体数の多いほうに更新する。
 * ランクの異なる手配書（初級・上級など）で同じモブが対象になることがあり、
 * 1 回の討伐は両方の手配書に数えられるので、1 行にまとめて多いほうの体数を残せばよい。
 * 体数を減らしたいときは、いったん削除してから追加し直す。
 */
export function addEntry(target: HuntTarget, neededKills: number, source: BillEntry["source"] = "manual") {
  billStore.update((bills) => {
    if (bills.some((b) => b.targetId === target.id)) {
      return bills.map((b) => (b.targetId === target.id ? { ...b, neededKills: Math.max(b.neededKills, neededKills) } : b));
    }
    return [...bills, { targetId: target.id, neededKills, done: false, source, addedAt: new Date().toISOString() }];
  });
}

export function removeEntry(targetId: number) {
  billStore.update((bills) => bills.filter((b) => b.targetId !== targetId));
}

/** 完了／未完了を切り替える。完了にしたときは、その場所を現在地として覚える */
export function toggleDone(targetId: number, position: Position) {
  if (!billStore.getSnapshot().some((b) => b.targetId === targetId && !b.done)) {
    billStore.update((bills) => bills.map((b) => (b.targetId === targetId ? { ...b, done: false } : b)));
    return;
  }
  positionStore.update(() => position);
  billStore.update((bills) => bills.map((b) => (b.targetId === targetId ? { ...b, done: !b.done } : b)));
}

export function clearEntries() {
  clearPosition();
  billStore.update(() => EMPTY_BILLS);
}

export function updateSettings(patch: Partial<UserSettings>) {
  if (patch.defaultCityId !== undefined) clearPosition();
  settingsStore.update((s) => ({ ...s, ...patch }));
}

/** 完了済みの行をすべて削除する */
export function clearDone() {
  clearPosition();
  billStore.update((bills) => bills.filter((b) => !b.done));
}
