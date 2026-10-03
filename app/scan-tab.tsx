"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { placeText } from "./bill-tab";
import styles from "./hunt-app.module.css";
import { huntIndex } from "./lib/hunt-data";
import type { HuntTarget } from "./lib/hunt-types";
import { cropAndPrepare, DEFAULT_CROP, type CropRect } from "./lib/ocr-image";
import { MIN_ACCEPT_SCORE, matchTargets, parsePanelText, type Candidate, type ParsedPanel } from "./lib/ocr-match";
import { addEntry } from "./lib/user-state";
import { useBills } from "./use-user-state";

/** カメラのプレビューに重ねるガイド枠（下部パネルをこの枠に合わせる） */
const GUIDE: CropRect = { x: 0.04, y: 0.5, w: 0.92, h: 0.46 };

/** 画像の出どころ。画面をカメラで撮った写真は、モアレ対策のぼかしを入れて読む */
type Origin = "camera" | "file";

type Stage =
  | { kind: "start" }
  | { kind: "camera" }
  | { kind: "crop"; photo: boolean; url: string; bitmap: ImageBitmap; crop: CropRect }
  | { kind: "reading"; progress: number; status: string }
  | { kind: "result"; panel: ParsedPanel; candidates: Candidate[]; text: string; preview: string };

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

const STATUS_LABELS: Record<string, string> = {
  "loading tesseract core": "OCR エンジンを読み込み中…",
  "loading language traineddata": "日本語の学習データを読み込み中…（初回だけ時間がかかります）",
  "initializing api": "準備中…",
  "recognizing text": "文字を認識中…",
};

export function ScanTab({ onOpenBills }: { onOpenBills: () => void }) {
  const [stage, setStage] = useState<Stage>({ kind: "start" });
  const [error, setError] = useState<string>();
  /** 読み取り済みのページ（n/5 の n）と、そのページ総数 */
  const [pages, setPages] = useState<{ total: number; read: number[] }>({ total: 0, read: [] });

  const openImage = useCallback(async (blob: Blob, origin: Origin) => {
    setError(undefined);
    try {
      const bitmap = await createImageBitmap(blob);
      setStage({ kind: "crop", photo: origin === "camera", url: URL.createObjectURL(blob), bitmap, crop: origin === "camera" ? GUIDE : DEFAULT_CROP });
    } catch {
      setError("画像を開けませんでした。別の画像を選んでください。");
    }
  }, []);

  // 切り出し画面を離れるとき、画像の URL を解放する
  const cropUrl = stage.kind === "crop" ? stage.url : undefined;
  useEffect(() => {
    return () => {
      if (cropUrl) URL.revokeObjectURL(cropUrl);
    };
  }, [cropUrl]);

  const read = useCallback(async (s: Extract<Stage, { kind: "crop" }>) => {
    setError(undefined);
    setStage({ kind: "reading", progress: 0, status: "準備中…" });
    try {
      const canvas = cropAndPrepare(s.bitmap, s.crop, { blurRadius: s.photo ? 1 : 0 });
      const { recognize } = await import("./lib/ocr-engine");
      const text = await recognize(canvas, (p) =>
        setStage((cur) => (cur.kind === "reading" ? { kind: "reading", progress: p.progress, status: STATUS_LABELS[p.status] ?? p.status } : cur)),
      );
      const panel = parsePanelText(text);
      const candidates = matchTargets(huntIndex, panel);
      if (panel.page) {
        const page = panel.page;
        setPages((p) =>
          p.total === page.total ? { total: p.total, read: [...new Set([...p.read, page.current])].sort() } : { total: page.total, read: [page.current] },
        );
      }
      setStage({ kind: "result", panel, candidates, text, preview: canvas.toDataURL("image/png") });
    } catch (e) {
      console.error(e);
      setError("文字の認識に失敗しました。通信状況を確認して、もう一度お試しください。");
      setStage(s);
    }
  }, []);

  return (
    <>
      <section className={styles.card}>
        <h2>手配書をスキャン</h2>
        <p className={styles.muted}>
          手配書の画面の下にある情報パネル（「討伐対象」「討伐体数」「生息場所」が並ぶ部分）を読み取ります。
          1 ページずつ読み取って、リストに追加してください。
        </p>
        {error && <p className={styles.warn} role="alert">{error}</p>}
        {stage.kind === "start" && <StartPanel onCamera={() => setStage({ kind: "camera" })} onFile={(f) => openImage(f, "file")} />}
        {stage.kind === "camera" && <CameraPanel onCapture={(b) => openImage(b, "camera")} onCancel={() => setStage({ kind: "start" })} onError={(m) => { setError(m); setStage({ kind: "start" }); }} />}
        {stage.kind === "crop" && (
          <CropPanel
            stage={stage}
            onChange={(crop) => setStage({ ...stage, crop })}
            onPhotoChange={(photo) => setStage({ ...stage, photo })}
            onRead={() => read(stage)}
            onBack={() => setStage({ kind: "start" })}
          />
        )}
        {stage.kind === "reading" && (
          <div role="status">
            <p className={styles.muted}>{stage.status}</p>
            <div className={styles.progressBar}>
              <div className={styles.progressFill} style={{ width: `${Math.round(stage.progress * 100)}%` }} />
            </div>
          </div>
        )}
        {stage.kind === "result" && <ResultPanel result={stage} pages={pages} onRetry={() => setStage({ kind: "start" })} onOpenBills={onOpenBills} />}
      </section>
      {pages.total > 0 && stage.kind !== "reading" && (
        <PageProgress pages={pages} onReset={() => setPages({ total: 0, read: [] })} />
      )}
    </>
  );
}

function StartPanel({ onCamera, onFile }: { onCamera: () => void; onFile: (file: File) => void }) {
  return (
    <div className={styles.scanActions}>
      <button type="button" className={styles.primaryButton} onClick={onCamera}>
        カメラで撮影
      </button>
      <label className={styles.secondaryButton} style={{ display: "grid", placeItems: "center", cursor: "pointer" }}>
        スクリーンショット・画像を選ぶ
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
      <p className={styles.note}>スクリーンショットのほうが、カメラで画面を撮るより正確に読み取れます。</p>
    </div>
  );
}

function CameraPanel({ onCapture, onCancel, onError }: { onCapture: (blob: Blob) => void; onCancel: () => void; onError: (message: string) => void }) {
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
        if (!cancelled) onError("カメラを使えませんでした。ブラウザのカメラの許可を確認するか、スクリーンショット・画像を選んでください。");
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
      <div className={styles.stage}>
        <video ref={videoRef} playsInline muted />
        <div className={styles.guideBox} style={{ left: `${GUIDE.x * 100}%`, top: `${GUIDE.y * 100}%`, width: `${GUIDE.w * 100}%`, height: `${GUIDE.h * 100}%` }}>
          <span className={styles.guideLabel}>下部パネルをこの枠に合わせる</span>
        </div>
      </div>
      <button type="button" className={styles.primaryButton} disabled={!ready} onClick={capture}>
        撮影
      </button>
      <button type="button" className={styles.secondaryButton} onClick={onCancel}>
        やめる
      </button>
    </div>
  );
}

function CropPanel({
  stage,
  onChange,
  onPhotoChange,
  onRead,
  onBack,
}: {
  stage: Extract<Stage, { kind: "crop" }>;
  onChange: (crop: CropRect) => void;
  onPhotoChange: (photo: boolean) => void;
  onRead: () => void;
  onBack: () => void;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const start = useRef<{ x: number; y: number } | undefined>(undefined);
  const { crop } = stage;

  const point = (e: React.PointerEvent) => {
    const box = stageRef.current!.getBoundingClientRect();
    return { x: clamp01((e.clientX - box.left) / box.width), y: clamp01((e.clientY - box.top) / box.height) };
  };
  const update = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    onChange({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) });

  return (
    <div className={styles.scanActions}>
      <p className={styles.muted}>情報パネルの部分だけを、指でなぞって囲んでください（余計な部分を含めないほうが正確に読めます）。</p>
      <div
        ref={stageRef}
        className={styles.stage}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          start.current = point(e);
        }}
        onPointerMove={(e) => start.current && update(start.current, point(e))}
        onPointerUp={() => (start.current = undefined)}
        onPointerCancel={() => (start.current = undefined)}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- ローカルの Blob URL なので next/image は使えない */}
        <img src={stage.url} alt="読み取る画像" draggable={false} />
        <div className={styles.cropBox} style={{ left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.w * 100}%`, height: `${crop.h * 100}%` }} />
      </div>
      <label className={styles.check}>
        <input type="checkbox" checked={stage.photo} onChange={(e) => onPhotoChange(e.target.checked)} data-testid="scan-photo" />
        <span className={styles.rowSub}>画面をカメラで撮った写真（モアレ対策のぼかしを入れて読む）</span>
      </label>
      <button type="button" className={styles.primaryButton} disabled={crop.w < 0.05 || crop.h < 0.02} onClick={onRead} data-testid="scan-read">
        読み取る
      </button>
      <button type="button" className={styles.secondaryButton} onClick={onBack}>
        別の画像にする
      </button>
    </div>
  );
}

function ResultPanel({
  result,
  pages,
  onRetry,
  onOpenBills,
}: {
  result: Extract<Stage, { kind: "result" }>;
  pages: { total: number; read: number[] };
  onRetry: () => void;
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
      <h3>読み取り結果</h3>
      {/* eslint-disable-next-line @next/next/no-img-element -- 前処理後の canvas の dataURL */}
      <img className={styles.cropped} src={preview} alt="認識に使った画像" />
      <dl className={styles.parsed}>
        <dt>討伐対象</dt>
        <dd data-testid="scan-name">{panel.name ?? "（読み取れませんでした）"}</dd>
        <dt>討伐体数</dt>
        <dd>{panel.kills ?? "（読み取れませんでした）"}</dd>
        <dt>生息場所</dt>
        <dd>{panel.place ?? "（読み取れませんでした）"}</dd>
        {panel.page && (
          <>
            <dt>ページ</dt>
            <dd>
              {panel.page.current} / {panel.page.total}
            </dd>
          </>
        )}
      </dl>
      {!confident && (
        <p className={styles.warn} role="alert">
          うまく読み取れませんでした。範囲を狭めて撮り直すか、手配書タブの「対象を追加」から探してください。
        </p>
      )}
      <h3>候補（合っているものを選んでください）</h3>
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
      {selected && <AddSelected key={selected.id} target={selected} parsedKills={panel.kills} added={added.has(selected.id)} onAdded={onRetry} />}
      {pages.total > 0 && panel.page && pages.read.length < pages.total && (
        <p className={styles.note}>
          このページを追加したら、手配書の次のページに進めて、続けてスキャンしてください（残り {pages.total - pages.read.length} ページ）。
        </p>
      )}
      <button type="button" className={styles.secondaryButton} onClick={onRetry}>
        別のページ・画像を読み取る
      </button>
      <button type="button" className={styles.linkButton} onClick={onOpenBills}>
        手配書タブで確認・手入力する
      </button>
      <details className={styles.rawText}>
        <summary>認識した文字（デバッグ用）</summary>
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
      {missing.length > 0 ? (
        <p className={styles.warn}>まだ読み取っていないページ: {missing.join("、")}</p>
      ) : (
        <p className={styles.muted}>すべてのページを読み取りました。</p>
      )}
      <button type="button" className={styles.linkButton} onClick={onReset}>
        別の手配書を読み取る（ページの記録をリセット）
      </button>
    </section>
  );
}
