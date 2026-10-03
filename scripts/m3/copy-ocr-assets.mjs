// Tesseract.js の実行に必要なファイル（ワーカー、WASM コア、日本語の学習データ）を public/ocr/ にコピーする。
// 実行時に外部の CDN へ取りに行かないため（AGENTS.md「データは同梱」）。生成物は .gitignore 済み。
// npm run dev / build の前（predev / prebuild）に自動で実行される。

import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const out = join(root, "public", "ocr");
mkdirSync(out, { recursive: true });

const files = [
  ["node_modules/tesseract.js/dist/worker.min.js", "worker.min.js"],
  // 使うコアは LSTM 版だけ（ブラウザの対応状況に応じて tesseract.js が選ぶ）
  ["node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js", "core/tesseract-core-lstm.wasm.js"],
  ["node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js", "core/tesseract-core-simd-lstm.wasm.js"],
  ["node_modules/tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js", "core/tesseract-core-relaxedsimd-lstm.wasm.js"],
  ["node_modules/@tesseract.js-data/jpn/4.0.0_best_int/jpn.traineddata.gz", "lang/jpn.traineddata.gz"],
];

for (const [from, to] of files) {
  const src = join(root, from);
  if (!existsSync(src)) throw new Error(`${from} がありません。npm install を実行してください`);
  mkdirSync(dirname(join(out, to)), { recursive: true });
  copyFileSync(src, join(out, to));
}
console.log(`OCR 用ファイルを ${out} にコピーしました`);
