"use client";

import styles from "./hunt-app.module.css";
import { availableCities, GC_LABELS, TRAVEL_LABELS } from "./lib/cities";
import { huntData } from "./lib/hunt-data";
import type { GrandCompany, TravelPreference } from "./lib/hunt-types";
import { updateSettings } from "./lib/user-state";
import { useSettings } from "./use-user-state";

export function SettingsTab() {
  const settings = useSettings();
  const cities = availableCities(settings.grandCompany);
  const { sources, expansions } = huntData.meta;

  return (
    <>
      <section className={styles.card}>
        <h2>移動方法</h2>
        <div className={styles.radios} role="radiogroup" aria-label="移動方法">
          {(Object.keys(TRAVEL_LABELS) as TravelPreference[]).map((p) => (
            <label key={p} className={styles.radio}>
              <input
                type="radio"
                name="travelPreference"
                checked={settings.travelPreference === p}
                onChange={() => updateSettings({ travelPreference: p })}
              />
              <span className={styles.rowBody}>
                <span className={styles.rowTitle}>{TRAVEL_LABELS[p].name}</span>
                <span className={styles.rowSub}>{TRAVEL_LABELS[p].description}</span>
              </span>
            </label>
          ))}
        </div>
      </section>

      <section className={styles.card}>
        <h2>出発地</h2>
        <label className={styles.field}>
          <span>所属グランドカンパニー</span>
          <select
            value={settings.grandCompany ?? ""}
            onChange={(e) => updateSettings({ grandCompany: (e.target.value || undefined) as GrandCompany | undefined })}
          >
            <option value="">指定しない</option>
            {(Object.keys(GC_LABELS) as GrandCompany[]).map((g) => (
              <option key={g} value={g}>
                {GC_LABELS[g]}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span>既定の出発地</span>
          <select
            value={cities.find((c) => c.id === settings.defaultCityId)?.id ?? cities[0]?.id ?? ""}
            onChange={(e) => updateSettings({ defaultCityId: e.target.value })}
          >
            {cities.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <p className={styles.note}>所属を選ぶと、新生エオルゼアの出発地が所属の本部だけになります。</p>
      </section>

      <section className={styles.card}>
        <h2>データ</h2>
        <p className={styles.note}>
          対象の拡張: {expansions.join(" / ")}。生成元: ffxiv-datamining {sources.datamining}、Teamcraft {sources.teamcraft}（スキーマ v
          {huntData.meta.schemaVersion}）
        </p>
        <p className={styles.note}>
          © SQUARE ENIX。FFXIV の著作権・商標は SQUARE ENIX に帰属します。FATE の座標は FFXIV Teamcraft（MIT License）のデータを使っています。
        </p>
      </section>
    </>
  );
}
