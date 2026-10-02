// デイリー／ウィークリーのリセット時刻（PLAN §9、§13。ゲーム内で確認済み）。
// リセットは「次の手配書を受注できるようになる時刻」で、受注済みの手配書は消えない。

import type { HuntTarget } from "./hunt-types";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** 日次リセット: 毎日 15:00 UTC（0:00 JST） */
const DAILY_HOUR_UTC = 15;
/** 週次リセット: 火曜 8:00 UTC（17:00 JST） */
const WEEKLY_DAY_UTC = 2;
const WEEKLY_HOUR_UTC = 8;

/** 直近のリセット時刻（now 以前でいちばん新しいもの）。エポックミリ秒 */
export function lastResetTime(kind: HuntTarget["kind"], now: number): number {
  const d = new Date(now);
  if (kind === "daily") {
    const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), DAILY_HOUR_UTC);
    return t > now ? t - DAY : t;
  }
  const today = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), WEEKLY_HOUR_UTC);
  const t = today - ((d.getUTCDay() - WEEKLY_DAY_UTC + 7) % 7) * DAY;
  return t > now ? t - 7 * DAY : t;
}

/** 次のリセット時刻。エポックミリ秒 */
export function nextResetTime(kind: HuntTarget["kind"], now: number): number {
  return lastResetTime(kind, now) + (kind === "daily" ? DAY : 7 * DAY);
}

/** リセット時刻を JST で表示する（例: 10/3 0:00） */
export function formatResetTime(time: number): string {
  return new Date(time).toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: false,
  });
}
