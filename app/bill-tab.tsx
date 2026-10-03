"use client";

import { useMemo, useState } from "react";
import styles from "./hunt-app.module.css";
import { huntIndex, normalizeName, spawnText } from "./lib/hunt-data";
import type { Expansion, HuntTarget } from "./lib/hunt-types";
import { formatResetTime, nextResetTime } from "./lib/reset";
import { addEntry, clearDone, clearEntries, removeEntry, toggleDone } from "./lib/user-state";
import { useBills } from "./use-user-state";

const EXPANSION_LABELS: Partial<Record<Expansion, string>> = {
  arr: "新生エオルゼア",
  hw: "蒼天のイシュガルド",
  sb: "紅蓮のリベレーター",
};

const MAX_SEARCH_RESULTS = 30;

/** 対象の場所の表示。位置は地域名と、湧き位置の中心座標（あれば）で示す */
export function placeText(t: HuntTarget): string {
  const zone = huntIndex.zones.get(t.zoneId)?.name ?? "";
  const region = t.regionId === undefined ? undefined : huntIndex.regions.get(t.regionId)?.name;
  const spawn = t.spawns?.length ? ` ${spawnText(t.spawns.slice(0, 1))}付近` : "";
  if (region) return `${zone} ${region}${spawn}`;
  return spawn ? `${zone}${spawn}` : `${zone}（湧き地点はエリア内のどこか）`;
}

export function BillTab() {
  const bills = useBills();
  const [now] = useState(() => Date.now());
  const entries = useMemo(
    () =>
      bills.flatMap((b) => {
        const target = huntIndex.targets.get(b.targetId);
        return target ? [{ entry: b, target }] : [];
      }),
    [bills],
  );
  const doneCount = entries.filter((e) => e.entry.done).length;

  return (
    <>
      <section className={styles.card}>
        <h2>
          今日の手配書 <span className={styles.badge}>{doneCount} / {entries.length} 完了</span>
        </h2>
        {entries.length === 0 ? (
          <p className={styles.muted}>まだ対象がありません。下の「対象を追加」から、手配書の「討伐対象」を選んでください。</p>
        ) : (
          <ul className={styles.list}>
            {[...entries]
              .sort((a, b) => Number(a.entry.done) - Number(b.entry.done))
              .map(({ entry, target }) => (
                <li key={target.id} className={entry.done ? styles.rowDone : styles.row}>
                  <label className={styles.check}>
                    <input type="checkbox" checked={entry.done} onChange={() => toggleDone(target.id)} />
                    <span className={styles.rowBody}>
                      <span className={styles.rowTitle}>
                        {target.name} × {entry.neededKills}
                        {target.kind === "elite" && <span className={styles.tag}>エリート</span>}
                      </span>
                      <span className={styles.rowSub}>{placeText(target)}</span>
                      {target.fate && <span className={styles.rowSub}>FATE「{target.fate.name}」のボス</span>}
                    </span>
                  </label>
                  <button type="button" className={styles.iconButton} onClick={() => removeEntry(target.id)} aria-label={`${target.name}を削除`}>
                    ×
                  </button>
                </li>
              ))}
          </ul>
        )}
        <p className={styles.note}>
          次に手配書を受注できる時刻（リセット）: デイリー {formatResetTime(nextResetTime("daily", now))} ／ エリート {formatResetTime(nextResetTime("elite", now))}（日本時間）
        </p>
        {doneCount > 0 && (
          <button type="button" className={styles.smallButton} onClick={clearDone}>
            完了済みを削除
          </button>
        )}
        {entries.length > 0 && (
          <button
            type="button"
            className={styles.dangerButton}
            onClick={() => {
              if (window.confirm("手配書の対象をすべて削除しますか？")) clearEntries();
            }}
          >
            すべて削除
          </button>
        )}
      </section>
      <AddTarget addedIds={new Set(bills.map((b) => b.targetId))} />
    </>
  );
}

function AddTarget({ addedIds }: { addedIds: Set<number> }) {
  const [query, setQuery] = useState("");
  const [expansion, setExpansion] = useState<Expansion>("arr");
  const [zoneId, setZoneId] = useState<number | "">("");
  const [kills, setKills] = useState<Record<number, number>>({});

  const zones = useMemo(() => {
    const ids = new Set(huntIndex.data.targets.map((t) => t.zoneId));
    return huntIndex.data.zones.filter((z) => ids.has(z.id) && z.expansion === expansion);
  }, [expansion]);

  const shown = useMemo(() => {
    const q = normalizeName(query);
    let list: HuntTarget[];
    if (q) {
      list = huntIndex.data.targets.filter((t) => normalizeName(t.name).includes(q));
    } else if (zoneId !== "") {
      list = huntIndex.data.targets.filter((t) => t.zoneId === zoneId);
    } else {
      return { list: [], more: 0 };
    }
    const regionName = (t: HuntTarget) => (t.regionId === undefined ? "" : (huntIndex.regions.get(t.regionId)?.name ?? ""));
    list = [...list].sort((a, b) => regionName(a).localeCompare(regionName(b), "ja") || a.name.localeCompare(b.name, "ja"));
    return { list: list.slice(0, MAX_SEARCH_RESULTS), more: Math.max(0, list.length - MAX_SEARCH_RESULTS) };
  }, [query, zoneId]);

  return (
    <section className={styles.card}>
      <h2>対象を追加</h2>
      <p className={styles.muted}>手配書の「討伐対象」のモブを、名前かエリアから探して追加します。</p>
      <label className={styles.field}>
        <span>名前で探す</span>
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="例: ウルハドシ" />
      </label>
      <div className={styles.fieldRow}>
        <label className={styles.field}>
          <span>拡張</span>
          <select
            value={expansion}
            onChange={(e) => {
              setExpansion(e.target.value as Expansion);
              setZoneId("");
            }}
          >
            {huntIndex.data.meta.expansions.map((x) => (
              <option key={x} value={x}>
                {EXPANSION_LABELS[x] ?? x}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span>エリア</span>
          <select value={zoneId} onChange={(e) => setZoneId(e.target.value === "" ? "" : Number(e.target.value))}>
            <option value="">選んでください</option>
            {zones.map((z) => (
              <option key={z.id} value={z.id}>
                {z.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <ul className={styles.list}>
        {shown.list.map((t) => {
          const added = addedIds.has(t.id);
          const value = kills[t.id] ?? t.neededKills[0];
          const region = t.regionId === undefined ? undefined : huntIndex.regions.get(t.regionId)?.name;
          return (
            <li key={t.id} className={styles.row}>
              <span className={styles.rowBody}>
                <span className={styles.rowTitle}>
                  {t.name}
                  {t.kind === "elite" && <span className={styles.tag}>エリート</span>}
                </span>
                <span className={styles.rowSub}>{query ? placeText(t) : `${region ?? "エリア内のどこか"}${t.spawns?.length ? ` ${spawnText(t.spawns.slice(0, 1))}付近` : ""}`}</span>
                {t.fate && <span className={styles.rowSub}>FATE「{t.fate.name}」のボス</span>}
              </span>
              {t.neededKills.length > 1 && (
                <select
                  className={styles.killsSelect}
                  value={value}
                  onChange={(e) => setKills({ ...kills, [t.id]: Number(e.target.value) })}
                  aria-label="討伐体数"
                >
                  {t.neededKills.map((n) => (
                    <option key={n} value={n}>
                      ×{n}
                    </option>
                  ))}
                </select>
              )}
              <button type="button" className={styles.smallButton} disabled={added} onClick={() => addEntry(t, value)}>
                {added ? "追加済み" : "追加"}
              </button>
            </li>
          );
        })}
      </ul>
      {shown.more > 0 && <p className={styles.note}>ほかに {shown.more} 件あります。名前で絞り込んでください。</p>}
    </section>
  );
}
