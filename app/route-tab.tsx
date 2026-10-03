"use client";

import styles from "./hunt-app.module.css";
import { availableCities, TRAVEL_LABELS } from "./lib/cities";
import { huntIndex } from "./lib/hunt-data";
import type { HuntTarget } from "./lib/hunt-types";
import { computeRoute, DEFAULT_ROUTE_OPTIONS, targetPosition, type TravelPart } from "./lib/route-planner";
import { clearPosition, toggleDone, updateSettings } from "./lib/user-state";
import { useBills, usePosition, useSettings } from "./use-user-state";

const fmt = (n: number) => n.toFixed(1);

function travelHeading(part: TravelPart, zoneName: string): string {
  if (part.kind === "teleport") return `テレポ: ${part.aetheryteName}`;
  const label = part.mode === "fly" ? "飛行" : part.mode === "walk" ? "徒歩" : "移動";
  return `${label}: ${zoneName}へ`;
}

export function RouteTab({ onOpenSettings }: { onOpenSettings: () => void }) {
  const bills = useBills();
  const settings = useSettings();
  const position = usePosition();
  const cities = availableCities(settings.grandCompany);
  const city = cities.find((c) => c.id === settings.defaultCityId) ?? cities[0];

  const pending = bills.flatMap((b) => {
    const t = !b.done ? huntIndex.targets.get(b.targetId) : undefined;
    return t ? [t] : [];
  });
  const cityAetheryte = city ? huntIndex.aetherytes.get(city.aetheryteId) : undefined;
  // 最後に倒した場所が分かるときは、そこからルートを組む（チェックのたびに出発地へ戻らない）
  const start = position && huntIndex.zones.has(position.zoneId) ? position : cityAetheryte;
  const route =
    city === undefined
      ? undefined
      : computeRoute(huntIndex, pending, start, { ...DEFAULT_ROUTE_OPTIONS, preference: settings.travelPreference });

  const kills = new Map(bills.map((b) => [b.targetId, b.neededKills]));
  const startZone = cityAetheryte?.name;
  const currentZone = position ? huntIndex.zones.get(position.zoneId)?.name : undefined;

  return (
    <>
      <section className={styles.card}>
        <h2>出発地と移動方法</h2>
        <label className={styles.field}>
          <span>出発地</span>
          <select value={city?.id ?? ""} onChange={(e) => updateSettings({ defaultCityId: e.target.value })}>
            {cities.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <p className={styles.note}>
          移動方法: <strong>{TRAVEL_LABELS[settings.travelPreference].name}</strong>{" "}
          <button type="button" className={styles.linkButton} onClick={onOpenSettings}>
            設定を変更
          </button>
        </p>
      </section>

      <section className={styles.card}>
        <h2>ルート</h2>
        {pending.length === 0 ? (
          <p className={styles.muted}>未完了の対象がありません。「手配書」で対象を追加してください。</p>
        ) : route && (
          <>
            <p className={styles.note}>
              {position && currentZone ? (
                <>
                  現在地: {currentZone}（最後に倒した場所）{" "}
                  <button type="button" className={styles.linkButton} onClick={clearPosition}>
                    出発地から計算し直す
                  </button>
                </>
              ) : (
                <>出発: {startZone}</>
              )}
            </p>
            <ol className={styles.steps}>
              {route.steps.map((step, i) => (
                <li key={step.zoneId} className={styles.step}>
                  <h3>
                    {i + 1}. {step.travel.length === 0 ? `${step.zoneName}（出発地のエリア内）` : step.travel.map((p) => travelHeading(p, step.zoneName)).join(" → ")}
                  </h3>
                  {step.travel.map((part, k) =>
                    part.kind === "move" && part.legs.length > 0 ? (
                      <ul key={k} className={styles.legs}>
                        {part.legs.map((leg, j) => (
                          <li key={j}>
                            {leg.fromZoneName}（{fmt(leg.exitX)}, {fmt(leg.exitY)} の出口）→ {leg.toZoneName}
                          </li>
                        ))}
                      </ul>
                    ) : null,
                  )}
                  <ul className={styles.stops}>
                    {step.stops.map((stop) => (
                      <li key={stop.key}>
                        <span className={styles.stopPlace}>
                          → {stop.regionName ?? step.zoneName}
                          {stop.direction && `（${stop.direction}へ）`}
                        </span>
                        <ul className={styles.list}>
                          {stop.targets.map((t) => (
                            <TargetCheck key={t.id} target={t} kills={kills.get(t.id) ?? 1} />
                          ))}
                        </ul>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
            {route.unreachable.length > 0 && (
              <p className={styles.warn}>
                ルートを組めなかった対象: {route.unreachable.map((t) => t.name).join("、")}
              </p>
            )}
          </>
        )}
      </section>
    </>
  );
}

function TargetCheck({ target, kills }: { target: HuntTarget; kills: number }) {
  return (
    <li className={styles.row}>
      <label className={styles.check}>
        <input type="checkbox" checked={false} onChange={() => toggleDone(target.id, targetPosition(huntIndex, target))} />
        <span className={styles.rowBody}>
          <span className={styles.rowTitle}>
            {target.name} × {kills}
          </span>
          {target.fate && (
            <span className={styles.rowSub}>
              FATE「{target.fate.name}」のボス（FATE が発生していないときは待つか、後回しに）
            </span>
          )}
          {target.kind === "elite" && <span className={styles.rowSub}>エリート。湧き地点はエリア内のどこか</span>}
        </span>
      </label>
    </li>
  );
}
