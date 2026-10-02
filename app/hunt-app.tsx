"use client";

import { useState } from "react";
import { BillTab } from "./bill-tab";
import styles from "./hunt-app.module.css";
import { RouteTab } from "./route-tab";
import { SettingsTab } from "./settings-tab";
import { useHydrated } from "./use-user-state";

type Tab = "bills" | "route" | "settings";

const TABS: { id: Tab; label: string }[] = [
  { id: "bills", label: "手配書" },
  { id: "route", label: "ルート" },
  { id: "settings", label: "設定" },
];

export function HuntApp() {
  const [tab, setTab] = useState<Tab>("bills");
  const hydrated = useHydrated();

  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <h1>FFXIV Hunt Companion JP</h1>
        <nav className={styles.tabs} role="tablist" aria-label="画面の切り替え">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={tab === t.id ? styles.tabActive : styles.tab}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>
      <main className={styles.main}>
        {!hydrated ? (
          <p className={styles.muted}>読み込み中…</p>
        ) : tab === "bills" ? (
          <BillTab />
        ) : tab === "route" ? (
          <RouteTab onOpenSettings={() => setTab("settings")} />
        ) : (
          <SettingsTab />
        )}
      </main>
      <footer className={styles.footer}>
        <p>© SQUARE ENIX。ゲームデータは非商用の個人利用の範囲で使っています。</p>
      </footer>
    </div>
  );
}
