// Tesseract.js（日本語）の遅延読み込みと認識（PLAN §4、§7 の 4）。
// 学習データは数 MB あるので、スキャン画面で最初に読み取るときまで読み込まない（AGENTS.md）。
// ワーカー・WASM・学習データは public/ocr/ に同梱したものを使い、外部の CDN には取りに行かない。

import type { Worker } from "tesseract.js";

let workerPromise: Promise<Worker> | undefined;

function basePath(): string {
  return process.env.NEXT_PUBLIC_BASE_PATH ?? "";
}

/** 認識の進み具合の通知（0〜1）と、いま何をしているか */
export type OcrProgress = { status: string; progress: number };

let onProgress: ((p: OcrProgress) => void) | undefined;

async function createWorker(): Promise<Worker> {
  const { createWorker: create, OEM, PSM } = await import("tesseract.js");
  const base = `${window.location.origin}${basePath()}/ocr`;
  const worker = await create("jpn", OEM.LSTM_ONLY, {
    workerPath: `${base}/worker.min.js`,
    corePath: `${base}/core`,
    langPath: `${base}/lang`,
    gzip: true,
    logger: (m) => onProgress?.({ status: m.status, progress: m.progress }),
  });
  // 下部パネルは数行の文章なので、1 つのまとまった文章として読ませる
  await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK, preserve_interword_spaces: "0" });
  return worker;
}

/** 画像（前処理済みの canvas）から文字列を読み取る。ワーカーは使い回す */
export async function recognize(image: HTMLCanvasElement, progress?: (p: OcrProgress) => void): Promise<string> {
  onProgress = progress;
  workerPromise ??= createWorker().catch((e) => {
    workerPromise = undefined;
    throw e;
  });
  const worker = await workerPromise;
  const { data } = await worker.recognize(image);
  return data.text;
}
