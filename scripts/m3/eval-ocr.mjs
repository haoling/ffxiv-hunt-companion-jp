// OCR の正解率を測る。実際の画面（ビルド済みの out/ を一時的なサーバーで配信）をブラウザで動かし、
// フォルダ内の画像を 1 枚ずつ「スキャン」画面に読み込ませて、候補の上位 1 件・上位 3 件に正解があるかを数える。
//
// 使い方（先に npm run build で out/ を作っておく。Playwright が必要）:
//   node scripts/m3/eval-ocr.mjs <画像フォルダ> --labels <正解.json>
//
// 正解.json: { "画像ファイル名": { "name": "ウルハドシ", "place": "サゴリー砂漠" }, ... }
//   place は省略可（同じ名前のモブが複数あるとき、地域名まで一致を見る）。
// 読み取りは画面と同じ処理（スクリーンショットとして、下部の範囲を切り出す）で行う。
//
// 画像は手元のものを使い、リポジトリにはコミットしない（AGENTS.md）。

import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { readdir } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const outDir = join(root, "out");

const args = process.argv.slice(2);
const dir = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--labels");
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const labelsPath = opt("labels");
if (!dir || !labelsPath) {
  console.error("使い方: node scripts/m3/eval-ocr.mjs <画像フォルダ> --labels <正解.json>");
  process.exit(1);
}
if (!existsSync(join(outDir, "index.html"))) {
  console.error("out/ がありません。先に npm run build を実行してください。");
  process.exit(1);
}

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  console.error("playwright が見つかりません。npm i -D playwright するか、NODE_PATH でグローバルの場所を指定してください。");
  process.exit(1);
}

const labels = JSON.parse(readFileSync(labelsPath, "utf8"));
const files = (await readdir(dir)).filter((f) => /\.(png|jpe?g|webp)$/i.test(f)).sort();

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".gz": "application/gzip", ".txt": "text/plain", ".svg": "image/svg+xml" };
const server = createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^(\.\.[/\\])+/, "");
  let file = join(outDir, path);
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
  if (!existsSync(file)) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage({ viewport: { width: 480, height: 900 } });
await page.goto(url);
let top1 = 0;
let top3 = 0;
let total = 0;
const misses = [];

for (const file of files) {
  const expected = labels[file];
  if (!expected) continue;
  total++;
  await page.getByRole("tab", { name: "スキャン" }).click();
  await page.getByTestId("scan-file").setInputFiles(join(dir, file));
  await page.getByTestId("scan-result").waitFor({ timeout: 120000 });
  const names = await page.getByTestId("scan-candidate").evaluateAll((els) => els.map((e) => e.querySelector("span span")?.textContent ?? ""));
  const matches = (n) => n.startsWith(expected.name);
  const ok1 = names[0] !== undefined && matches(names[0]);
  const ok3 = names.slice(0, 3).some(matches);
  if (ok1) top1++;
  if (ok3) top3++;
  if (!ok3 || !ok1) {
    const text = await page.locator("details pre").textContent().catch(() => "");
    misses.push({ file, expected: expected.name, got: names, text: (text ?? "").trim() });
  }
  console.log(`${ok1 ? "◎" : ok3 ? "○" : "×"} ${file}: 正解=${expected.name} 候補=${names.join(" / ")}`);
  await page.reload();
}

console.log(`\n枚数 ${total} / 上位 1 件の正解率 ${((top1 / total) * 100).toFixed(1)}%（${top1}）/ 上位 3 件の正解率 ${((top3 / total) * 100).toFixed(1)}%（${top3}）`);
for (const m of misses) console.log(`\n--- ${m.file}（正解=${m.expected}）\n${m.text}`);
await browser.close();
server.close();
