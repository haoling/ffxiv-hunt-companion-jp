"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { placeText } from "./bill-tab";
import styles from "./hunt-app.module.css";
import { huntIndex } from "./lib/hunt-data";
import type { HuntTarget } from "./lib/hunt-types";
import { cropAndPrepare, screenshotCrops, sourceSize, stripCrop, type CropRect } from "./lib/ocr-image";
import { MIN_ACCEPT_SCORE, matchTargets, parsePanelText, type Candidate, type ParsedPanel } from "./lib/ocr-match";
import { addEntry } from "./lib/user-state";
import { useBills } from "./use-user-state";

/** 画像の出どころ。画面をカメラで撮った写真は、モアレ対策のぼかしを入れて読む */
type Origin = "camera" | "file";

type Stage =
  | { kind: "input" }
  | { kind: "reading"; progress: number; status: string }
  | { kind: "result"; origin: Origin; panel: ParsedPanel; candidates: Candidate[]; text: string; preview: string };

const STATUS_LABELS: Record<string, string> = {
  "loading tesseract core": "OCR エンジンを読み込み中…",
  "loading language traineddata": "日本語の学習データを読み込み中…（初回だけ時間がかかります）",
  "initializing api": "準備中…",
  "recognizing text": "文字を認識中…",
};

/** 入力方法。スマホ（タッチ操作）の既定はカメラ、PC の既定はスクリーンショット */
type Mode = Origin;

function defaultMode(): Mode {
  try {
    return window.matchMedia("(pointer: coarse)").matches ? "camera" : "file";
  } catch {
    return "file";
  }
}

const MODE_LABELS: { id: Mode; label: string }[] = [
  { id: "camera", label: "カメラ" },
  { id: "file", label: "スクリーンショット" },
];

export function ScanTab({ onOpenBills }: { onOpenBills: () => void }) {
  // ScanTab はハイドレーション後にだけ描画されるので、初期値でブラウザの情報を読んでよい
  const [mode, setMode] = useState<Mode>(defaultMode);
  const [stage, setStage] = useState<Stage>({ kind: "input" });
  const [error, setError] = useState<string>();
  /** 読み取り済みのページ（n/5 の n）と、そのページ総数 */
  const [pages, setPages] = useState<{ total: number; read: number[] }>({ total: 0, read: [] });

  /** 画像を受け取ったらすぐに読み取って、候補を出す */
  const readImage = useCallback(async (blob: Blob, origin: Origin) => {
    setError(undefined);
    setStage({ kind: "reading", progress: 0, status: "準備中…" });
    try {
      const bitmap = await createImageBitmap(blob);
      const size = sourceSize(bitmap);
      const crops = origin === "camera" ? [stripCrop(size.width, size.height)] : screenshotCrops(size.width, size.height);
      const { recognize } = await import("./lib/ocr-engine");
      const onProgress = (p: { status: string; progress: number }) =>
        setStage((cur) => (cur.kind === "reading" ? { kind: "reading", progress: p.progress, status: STATUS_LABELS[p.status] ?? p.status } : cur));

      // 範囲の候補を順に試し、確からしい候補が出たらそこで止める（出なければいちばん点数の高かったものを使う）
      let best: { canvas: HTMLCanvasElement; text: string; panel: ParsedPanel; candidates: Candidate[] } | undefined;
      for (const crop of crops as CropRect[]) {
        const canvas = cropAndPrepare(bitmap, crop, { blurRadius: origin === "camera" ? 1 : 0 });
        const text = await recognize(canvas, onProgress);
        const panel = parsePanelText(text);
        const candidates = matchTargets(huntIndex, panel);
        if (!best || (candidates[0]?.score ?? 0) > (best.candidates[0]?.score ?? 0)) best = { canvas, text, panel, candidates };
        if (panel.name && (candidates[0]?.score ?? 0) >= MIN_ACCEPT_SCORE) break;
      }
      bitmap.close();
      const { canvas, text, panel, candidates } = best!;
      if (panel.page) {
        const page = panel.page;
        setPages((p) =>
          p.total === page.total ? { total: p.total, read: [...new Set([...p.read, page.current])].sort() } : { total: page.total, read: [page.current] },
        );
      }
      setStage({ kind: "result", origin, panel, candidates, text, preview: canvas.toDataURL("image/png") });
    } catch (e) {
      console.error(e);
      setError("読み取りに失敗しました。画像を確認して、もう一度お試しください（初回は通信が必要です）。");
      setStage({ kind: "input" });
    }
  }, []);

  const onFile = useCallback((f: Blob) => readImage(f, "file"), [readImage]);

  const failCamera = useCallback((message: string) => {
    setError(message);
    setMode("file");
  }, []);

  return (
    <>
      <section className={styles.card}>
        <h2>手配書をスキャン</h2>
        {error && (
          <p className={styles.warn} role="alert">
            {error}
          </p>
        )}
        {stage.kind === "input" && (
          <>
            <div className={styles.modeTabs} role="tablist" aria-label="入力方法">
              {MODE_LABELS.map((m) => (
                <button key={m.id} type="button" role="tab" aria-selected={mode === m.id} className={mode === m.id ? styles.tabActive : styles.tab} onClick={() => setMode(m.id)}>
                  {m.label}
                </button>
              ))}
            </div>
            {mode === "camera" ? <CameraPanel onCapture={(b) => readImage(b, "camera")} onError={failCamera} /> : <FilePanel onFile={onFile} />}
          </>
        )}
        {stage.kind === "reading" && (
          <div role="status">
            <p className={styles.muted}>{stage.status}</p>
            <div className={styles.progressBar}>
              <div className={styles.progressFill} style={{ width: `${Math.round(stage.progress * 100)}%` }} />
            </div>
          </div>
        )}
        {stage.kind === "result" && (
          <ResultPanel
            result={stage}
            pages={pages}
            onNext={() => setStage({ kind: "input" })}
            onOpenBills={onOpenBills}
          />
        )}
      </section>
      {pages.total > 0 && stage.kind !== "reading" && <PageProgress pages={pages} onReset={() => setPages({ total: 0, read: [] })} />}
    </>
  );
}

/** クリップボードの画像を取り出す（Ctrl+V の貼り付けイベントから） */
function imageFromPaste(e: ClipboardEvent): File | undefined {
  for (const item of e.clipboardData?.items ?? []) {
    if (item.kind === "file" && item.type.startsWith("image/")) return item.getAsFile() ?? undefined;
  }
  return undefined;
}

function FilePanel({ onFile }: { onFile: (file: File) => void }) {
  const [pasteError, setPasteError] = useState<string>();

  // このパネルを表示している間は、どこで Ctrl+V（⌘V）を押しても貼り付けられる
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const file = imageFromPaste(e);
      if (!file) return;
      e.preventDefault();
      onFile(file);
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [onFile]);

  /** ボタンから貼り付ける（Clipboard API。ブラウザが許可を求めることがある） */
  const pasteFromButton = async () => {
    setPasteError(undefined);
    try {
      for (const item of await navigator.clipboard.read()) {
        const type = item.types.find((t) => t.startsWith("image/"));
        if (type) {
          onFile(new File([await item.getType(type)], "clipboard", { type }));
          return;
        }
      }
      setPasteError("クリップボードに画像がありません。スクリーンショットをコピーしてからもう一度押してください。");
    } catch {
      setPasteError("クリップボードを読み取れませんでした。Ctrl+V（⌘V）で貼り付けてください。");
    }
  };

  return (
    <div className={styles.scanActions}>
      <p className={styles.muted}>
        手配書の画面（「討伐対象」「討伐体数」「生息場所」が並んでいるところ）が写ったスクリーンショットを、<strong>Ctrl+V（⌘V）で貼り付ける</strong>か、ファイルを選んでください。すぐに読み取ります。
      </p>
      {pasteError && (
        <p className={styles.warn} role="alert">
          {pasteError}
        </p>
      )}
      <button type="button" className={styles.primaryButton} onClick={pasteFromButton}>
        クリップボードから貼り付け
      </button>
      <label className={styles.secondaryButton} style={{ display: "grid", placeItems: "center", cursor: "pointer" }}>
        ファイルを選ぶ
        <input
          type="file"
          accept="image/*"
          className={styles.visuallyHidden}
          data-testid="scan-file"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) onFile(file);
          }}
        />
      </label>
    </div>
  );
}

/** ガイド枠の行（手配書の下部パネルの並びに合わせる）。左のラベルは固定文字、右は読み取る値の場所 */
const GUIDE_ROWS: { label: string; right?: string }[] = [
  { label: "モブ手配書", right: "n/5" },
  { label: "討伐対象" },
  { label: "討伐体数" },
  { label: "生息場所" },
];

function CameraPanel({ onCapture, onError }: { onCapture: (blob: Blob) => void; onError: (message: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let stream: MediaStream | undefined;
    let cancelled = false;
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("unsupported");
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 } }, audio: false });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play();
          setReady(true);
        }
      } catch {
        if (!cancelled) onError("カメラを使えませんでした。ブラウザのカメラの許可を確認するか、スクリーンショットを選んでください。");
      }
    })();
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onError]);

  const capture = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    canvas.toBlob((blob) => blob && onCapture(blob), "image/jpeg", 0.95);
  };

  return (
    <div className={styles.scanActions}>
      <p className={styles.muted}>文字が書いてある部分を、下の枠に合わせて映してください。枠の上下の余白も読み取るので、多少ずれても大丈夫です。撮影するとすぐに読み取ります。</p>
      <div className={styles.strip}>
        <video ref={videoRef} playsInline muted className={styles.stripVideo} />
        <div className={styles.stripGuide} aria-hidden="true">
          {GUIDE_ROWS.map((row) => (
            <div key={row.label} className={styles.stripRow}>
              <span>{row.label}</span>
              {row.right && <span>{row.right}</span>}
            </div>
          ))}
        </div>
      </div>
      <button type="button" className={styles.primaryButton} disabled={!ready} onClick={capture}>
        撮影
      </button>
    </div>
  );
}

function ResultPanel({
  result,
  pages,
  onNext,
  onOpenBills,
}: {
  result: Extract<Stage, { kind: "result" }>;
  pages: { total: number; read: number[] };
  onNext: () => void;
  onOpenBills: () => void;
}) {
  const { panel, candidates, text, preview } = result;
  const bills = useBills();
  const added = useMemo(() => new Set(bills.map((b) => b.targetId)), [bills]);
  const best = candidates[0];
  const confident = best !== undefined && best.score >= MIN_ACCEPT_SCORE;
  const [selectedId, setSelectedId] = useState<number | undefined>(confident ? best.target.id : undefined);
  const selected = candidates.find((c) => c.target.id === selectedId)?.target;

  return (
    <div className={styles.scanActions} data-testid="scan-result">
      <h3>読み取り結果{panel.page ? `（${panel.page.current} / ${panel.page.total} ページ）` : ""}</h3>
      {!confident && (
        <p className={styles.warn} role="alert">
          うまく読み取れませんでした。文字の部分を大きく映して撮り直すか、手配書タブの「対象を追加」から探してください。
        </p>
      )}
      <ul className={styles.list}>
        {candidates.map((c) => (
          <li key={c.target.id} className={styles.row} data-testid="scan-candidate" data-target-id={c.target.id} data-score={c.score.toFixed(3)}>
            <label className={styles.radio}>
              <input type="radio" name="candidate" checked={selectedId === c.target.id} onChange={() => setSelectedId(c.target.id)} />
              <span className={styles.rowBody}>
                <span className={styles.rowTitle}>
                  {c.target.name}
                  {c.target.kind === "elite" && <span className={styles.tag}>エリート</span>}
                </span>
                <span className={styles.rowSub}>
                  {placeText(c.target)}
                  {c.placeMatched ? "（生息場所が一致）" : ""}
                </span>
                {added.has(c.target.id) && <span className={styles.rowSub}>追加済み</span>}
              </span>
            </label>
          </li>
        ))}
      </ul>
      {selected && <AddSelected key={selected.id} target={selected} parsedKills={panel.kills} added={added.has(selected.id)} onAdded={onNext} />}
      {pages.total > 0 && panel.page && pages.read.length < pages.total && (
        <p className={styles.note}>追加したら、手配書を次のページに進めて、続けて撮影してください（残り {pages.total - pages.read.length} ページ）。</p>
      )}
      <button type="button" className={styles.secondaryButton} onClick={onNext}>
        追加せずに撮り直す・次へ
      </button>
      <button type="button" className={styles.linkButton} onClick={onOpenBills}>
        手配書タブで確認・手入力する
      </button>
      <details className={styles.rawText}>
        <summary>読み取った内容（デバッグ用）</summary>
        <dl className={styles.parsed}>
          <dt>討伐対象</dt>
          <dd data-testid="scan-name">{panel.name ?? "（読み取れませんでした）"}</dd>
          <dt>討伐体数</dt>
          <dd>{panel.kills ?? "（読み取れませんでした）"}</dd>
          <dt>生息場所</dt>
          <dd>{panel.place ?? "（読み取れませんでした）"}</dd>
        </dl>
        {/* eslint-disable-next-line @next/next/no-img-element -- 前処理後の canvas の dataURL */}
        <img className={styles.cropped} src={preview} alt="認識に使った画像" />
        <pre>{text}</pre>
      </details>
    </div>
  );
}

function AddSelected({ target, parsedKills, added, onAdded }: { target: HuntTarget; parsedKills?: number; added: boolean; onAdded: () => void }) {
  // 読み取った体数が、この対象の取りうる値にあればそれを、無ければ先頭を初期値にする
  const options = target.neededKills;
  const initial = parsedKills !== undefined && options.includes(parsedKills) ? parsedKills : options[0];
  const [kills, setKills] = useState(initial);
  return (
    <div className={styles.fieldRow} style={{ alignItems: "end" }}>
      {options.length > 1 && (
        <label className={styles.field}>
          <span>討伐体数</span>
          <select value={kills} onChange={(e) => setKills(Number(e.target.value))}>
            {options.map((n) => (
              <option key={n} value={n}>
                ×{n}
              </option>
            ))}
          </select>
        </label>
      )}
      <button
        type="button"
        className={styles.primaryButton}
        style={{ flex: 1 }}
        onClick={() => {
          addEntry(target, kills, "ocr");
          onAdded();
        }}
      >
        {added ? "討伐体数を更新して次へ" : `「${target.name}」を追加して次へ`}
      </button>
    </div>
  );
}

function PageProgress({ pages, onReset }: { pages: { total: number; read: number[] }; onReset: () => void }) {
  const missing = Array.from({ length: pages.total }, (_, i) => i + 1).filter((n) => !pages.read.includes(n));
  return (
    <section className={styles.card}>
      <h2>読み取りの進み具合</h2>
      <p className={styles.muted}>
        読み取り済み: {pages.read.join("、")} / {pages.total} ページ
      </p>
      {missing.length > 0 ? <p className={styles.warn}>まだ読み取っていないページ: {missing.join("、")}</p> : <p className={styles.muted}>すべてのページを読み取りました。</p>}
      <button type="button" className={styles.linkButton} onClick={onReset}>
        別の手配書を読み取る（ページの記録をリセット）
      </button>
    </section>
  );
}
