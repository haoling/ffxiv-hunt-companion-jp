"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { BillTab } from "./bill-tab";
import styles from "./hunt-app.module.css";
import { LICENSE_LINKS } from "./lib/licenses";
import { RouteTab } from "./route-tab";
import { ScanTab } from "./scan-tab";
import { SettingsTab } from "./settings-tab";
import { useHydrated, useSettings } from "./use-user-state";

type Tab = "bills" | "scan" | "route" | "settings";

const TABS: { id: Tab; label: string }[] = [
  { id: "bills", label: "手配書" },
  { id: "scan", label: "スキャン" },
  { id: "route", label: "ルート" },
  { id: "settings", label: "設定" },
];

export function HuntApp() {
  const [tab, setTab] = useState<Tab>("bills");
  const hydrated = useHydrated();
  const { theme } = useSettings();
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({ bills: null, scan: null, route: null, settings: null });

  // 設定のテーマを <html data-theme> に反映する（"auto" は OS の設定に任せる）
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "auto") delete root.dataset.theme;
    else root.dataset.theme = theme;
  }, [theme]);

  /** 矢印キー・Home・End でタブを移動する（WAI-ARIA のタブの操作） */
  const onTabKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = TABS.length - 1;
    const next =
      e.key === "ArrowRight" ? (index + 1) % TABS.length : e.key === "ArrowLeft" ? (index + last) % TABS.length : e.key === "Home" ? 0 : e.key === "End" ? last : -1;
    if (next < 0) return;
    e.preventDefault();
    setTab(TABS[next].id);
    tabRefs.current[TABS[next].id]?.focus();
  };

  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <h1>FFXIV Hunt Companion JP</h1>
        <nav className={styles.tabs} role="tablist" aria-label="画面の切り替え">
          {TABS.map((t, i) => (
            <button
              key={t.id}
              ref={(el) => {
                tabRefs.current[t.id] = el;
              }}
              id={`tab-${t.id}`}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              aria-controls="main-panel"
              tabIndex={tab === t.id ? 0 : -1}
              className={tab === t.id ? styles.tabActive : styles.tab}
              onClick={() => setTab(t.id)}
              onKeyDown={(e) => onTabKeyDown(e, i)}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>
      <main id="main-panel" role="tabpanel" aria-labelledby={`tab-${tab}`} className={styles.main}>
        {!hydrated ? (
          <p className={styles.muted}>読み込み中…</p>
        ) : tab === "bills" ? (
          <BillTab />
        ) : tab === "scan" ? (
          <ScanTab onOpenBills={() => setTab("bills")} />
        ) : tab === "route" ? (
          <RouteTab onOpenSettings={() => setTab("settings")} />
        ) : (
          <SettingsTab />
        )}
      </main>
      <footer className={styles.footer}>
        <p>© SQUARE ENIX。ゲームデータは非商用の個人利用の範囲で使っています。</p>
        <p>
          {LICENSE_LINKS.map((l) => (
            <a key={l.href} href={l.href} target="_blank" rel="noreferrer" className={styles.footerLink}>
              {l.label}
            </a>
          ))}
        </p>
      </footer>
    </div>
  );
}
