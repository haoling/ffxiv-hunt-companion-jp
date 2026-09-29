#!/usr/bin/env node
// M0: ゲームデータの検証スクリプト（docs/PLAN.md §11, §13）
//
// 使い方:
//   node scripts/m0/verify-data.mjs --datamining <ffxiv-datamining のパス> [--teamcraft <teamcraft の json ディレクトリ>]
//
// xivapi/ffxiv-datamining の日本語 CSV（csv/ja）を読み、次を確かめて Markdown で出力する。
//   1. MobHuntTarget の PlaceName が地域名か（エリア名になっていないか）、地図上にラベルがあるか
//   2. MobHuntOrderType と拡張・手配書の対応、手配書 1 枚あたりのページ数
//   3. エリートの対象の Map / PlaceName
//   4. MapMarker と Level の座標変換式（Teamcraft の座標との突き合わせ）、手配書の FATE の位置
//   5. 手配書の受注場所
//   6. MapMarker のエリアの出口（DataType 1/2）とエリア間のつながり

import fs from "node:fs";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
if (!args.datamining) {
  console.error("usage: verify-data.mjs --datamining <path> [--teamcraft <json dir>]");
  process.exit(1);
}
const csvDir = path.join(args.datamining, "csv", "ja");

// ---- CSV ----

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) out[argv[i].replace(/^--/, "")] = argv[i + 1];
  return out;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

// 行 ID（"12" または サブ行つきの "12.3"）をキーにしたオブジェクトの配列と Map を返す
function loadSheet(name) {
  const text = fs.readFileSync(path.join(csvDir, `${name}.csv`), "utf8").replace(/^﻿/, "");
  const [header, ...body] = parseCsv(text);
  const list = [];
  const byId = new Map();
  for (const cells of body) {
    if (cells.length < header.length) continue;
    const rec = {};
    header.forEach((h, i) => (rec[h] = cells[i]));
    rec._id = rec["#"];
    list.push(rec);
    byId.set(rec._id, rec);
  }
  return { list, byId, get: (id) => byId.get(String(id)) };
}

const num = (v) => Number(v);

// ---- シート ----

const MobHuntTarget = loadSheet("MobHuntTarget");
const MobHuntOrder = loadSheet("MobHuntOrder");
const MobHuntOrderType = loadSheet("MobHuntOrderType");
const BNpcName = loadSheet("BNpcName");
const PlaceName = loadSheet("PlaceName");
const MapSheet = loadSheet("Map");
const MapMarker = loadSheet("MapMarker");
const Fate = loadSheet("Fate");
const Level = loadSheet("Level");
const Aetheryte = loadSheet("Aetheryte");
const TerritoryType = loadSheet("TerritoryType");
const EventItem = loadSheet("EventItem");
const ExVersion = loadSheet("ExVersion");

const placeName = (id) => PlaceName.get(id)?.Name ?? "";
const mapZoneName = (mapId) => {
  const m = MapSheet.get(mapId);
  if (!m) return "";
  const sub = placeName(m.PlaceNameSub);
  return placeName(m.PlaceName) + (sub ? `（${sub}）` : "");
};
const mapExVersion = (mapId) => {
  const m = MapSheet.get(mapId);
  const t = m && TerritoryType.get(m.TerritoryType);
  return t ? num(t.ExVersion) : -1;
};
const exName = (ex) => ExVersion.get(ex)?.Name ?? `ExVersion ${ex}`;

// MapMarker は Map.MapMarkerRange を主行 ID とするサブ行の集まり
const markersByRange = new Map();
for (const mm of MapMarker.list) {
  const [range] = mm._id.split(".");
  if (!markersByRange.has(range)) markersByRange.set(range, []);
  markersByRange.get(range).push(mm);
}
const markersOfMap = (mapId) => {
  const m = MapSheet.get(mapId);
  return (m && num(m.MapMarkerRange) > 0 && markersByRange.get(String(m.MapMarkerRange))) || [];
};

// ---- 座標変換（PLAN.md §5.2） ----

const toMapCoordFromWorld = (value, offset, sizeFactor) => {
  const c = sizeFactor / 100;
  return (41 / c) * (((value + offset) * c + 1024) / 2048) + 1;
};
const toMapCoordFromPixel = (value, sizeFactor) => {
  const c = sizeFactor / 100;
  return (41 / c) * (value / 2048) + 1;
};
const levelToMapCoord = (lv) => {
  const m = MapSheet.get(lv.Map);
  if (!m) return null;
  const sf = num(m.SizeFactor);
  return {
    x: toMapCoordFromWorld(num(lv.X), num(m.OffsetX), sf),
    y: toMapCoordFromWorld(num(lv.Z), num(m.OffsetY), sf),
  };
};
const markerToMapCoord = (mm, mapId) => {
  const sf = num(MapSheet.get(mapId).SizeFactor);
  return { x: toMapCoordFromPixel(num(mm.X), sf), y: toMapCoordFromPixel(num(mm.Y), sf) };
};
const f1 = (v) => v.toFixed(1);
const f2 = (v) => v.toFixed(2);

// ---- 出力 ----

const out = [];
const p = (s = "") => out.push(s);
const table = (headers, rows) => {
  p(`| ${headers.join(" | ")} |`);
  p(`|${headers.map(() => "---").join("|")}|`);
  for (const r of rows) p(`| ${r.map((c) => String(c).replace(/\|/g, "\\|").replace(/\r?\n/g, " ")).join(" | ")} |`);
  p();
};

p("# M0 データ検証の出力");
p();
p(`- データ: xivapi/ffxiv-datamining \`csv/ja\``);
p(`- MobHuntTarget: ${MobHuntTarget.list.length - 1} 行、MobHuntOrder: ${MobHuntOrder.list.length} 行、MobHuntOrderType: ${MobHuntOrderType.list.length} 行`);
p();

// ---- 1. 手配書（MobHuntOrderType）と拡張の対応、ページ数 ----

const ordersByMain = new Map();
for (const o of MobHuntOrder.list) {
  const [main] = o._id.split(".");
  if (!ordersByMain.has(main)) ordersByMain.set(main, []);
  ordersByMain.get(main).push(o);
}

const targetKind = new Map(); // targetId -> Set("daily" | "elite")
const targetOrderTypes = new Map(); // targetId -> Set(orderTypeId)
p("## 1. 手配書の種類（MobHuntOrderType）");
p();
const typeRows = [];
for (const t of MobHuntOrderType.list) {
  const start = num(t.OrderStart);
  const amount = num(t.OrderAmount);
  const kind = num(t.Type) === 1 ? "デイリー" : num(t.Type) === 2 ? "エリート" : `Type ${t.Type}`;
  const pages = new Map();
  const exs = new Map();
  const ranks = new Set();
  let empty = 0;
  for (let id = start; id < start + amount; id++) {
    const subs = (ordersByMain.get(String(id)) ?? []).filter((o) => num(o.Target) > 0);
    if (subs.length === 0) {
      empty++;
      continue;
    }
    pages.set(subs.length, (pages.get(subs.length) ?? 0) + 1);
    for (const o of subs) {
      const tgt = MobHuntTarget.get(o.Target);
      const ex = tgt ? mapExVersion(tgt.Map) : -1;
      exs.set(ex, (exs.get(ex) ?? 0) + 1);
      ranks.add(o.Rank);
      if (!targetKind.has(o.Target)) targetKind.set(o.Target, new Set());
      targetKind.get(o.Target).add(num(t.Type) === 2 ? "elite" : "daily");
      if (!targetOrderTypes.has(o.Target)) targetOrderTypes.set(o.Target, new Set());
      targetOrderTypes.get(o.Target).add(t._id);
    }
  }
  typeRows.push([
    t._id,
    EventItem.get(t.EventItem)?.Singular || EventItem.get(t.EventItem)?.Name || t.EventItem,
    kind,
    `${start}〜${start + amount - 1}`,
    [...pages].map(([k, v]) => `${k} ページ×${v}`).join("、") + (empty ? `、空×${empty}` : ""),
    [...exs].map(([k, v]) => `${exName(k)}×${v}`).join("、"),
    [...ranks].sort().join(","),
    t.Quest === "0" ? "—" : t.Quest,
  ]);
}
table(["ID", "手配書（EventItem）", "種類", "MobHuntOrder", "1 枚あたりの対象数", "対象のエリアの拡張", "Rank", "Quest"], typeRows);

// ---- 2. MobHuntTarget の PlaceName ----

p("## 2. MobHuntTarget の PlaceName（生息場所）");
p();
let sameAsZone = 0;
let noLabel = 0;
let noPlace = 0;
let used = 0;
const targetRows = [];
const zoneNameRows = [];
for (const t of MobHuntTarget.list) {
  if (t._id === "0" || num(t.Name) === 0) continue;
  const inOrders = targetKind.has(t._id);
  if (inOrders) used++;
  const m = MapSheet.get(t.Map);
  const zone = mapZoneName(t.Map);
  const region = placeName(t.PlaceName);
  const hasPlace = num(t.PlaceName) > 0;
  const isZone = hasPlace && m && t.PlaceName === m.PlaceName;
  const labels = hasPlace ? markersOfMap(t.Map).filter((mm) => mm.PlaceNameSubtext === t.PlaceName) : [];
  if (!hasPlace) noPlace++;
  else if (isZone) sameAsZone++;
  else if (!labels.length) noLabel++;
  const fate = num(t.FATE) ? Fate.get(t.FATE) : null;
  const row = [
    t._id,
    BNpcName.get(t.Name)?.Singular ?? t.Name,
    exName(mapExVersion(t.Map)),
    [...(targetKind.get(t._id) ?? ["（未使用）"])].join("/"),
    zone,
    hasPlace ? region : "（0）",
    !hasPlace ? "—" : isZone ? "**エリア名**" : labels.length ? `${labels.length} 件` : "**なし**",
    fate ? `${fate.Name}（${t.FATE}）` : "",
  ];
  targetRows.push(row);
  if (hasPlace && (isZone || !labels.length)) zoneNameRows.push(row);
}
const usedTargets = targetRows.filter((r) => targetKind.has(r[0]));
p(`- 手配書で使われている対象: ${used} 体（MobHuntTarget の有効行 ${targetRows.length}）`);
p(`  - デイリー: ${usedTargets.filter((r) => r[3].includes("daily")).length} 体、エリート: ${usedTargets.filter((r) => r[3].includes("elite")).length} 体`);
p(`- PlaceName が 0（地域名なし）のもの: ${noPlace} 体（種類: ${[...new Set(targetRows.filter((r) => r[5] === "（0）").map((r) => r[3]))].join("、")}）`);
p(`- PlaceName がエリア名と同じ（地域名になっていない）もの: ${sameAsZone} 体`);
p(`- PlaceName の地域名ラベルが、そのエリアの MapMarker に無いもの: ${noLabel} 体`);
p(`- FATE の対象: ${targetRows.filter((r) => r[7]).length} 体（うち手配書で使われている: ${usedTargets.filter((r) => r[7]).length} 体）`);
p(`- 手配書で使われていない行: ${targetRows.filter((r) => !targetKind.has(r[0])).map((r) => `${r[0]} ${r[1]}`).join("、") || "なし"}`);
p();
if (zoneNameRows.length) {
  p("### PlaceName がエリア名、または地図にラベルが無い対象");
  p();
  table(["ID", "モブ", "拡張", "種類", "エリア", "PlaceName", "ラベル", "FATE"], zoneNameRows);
}

// 手配書の例（§3.1）
p("### 手配書の例との照合");
p();
const sample = targetRows.find((r) => r[1] === "ウルハドシ");
p(
  sample
    ? `- ウルハドシ → エリア「${sample[4]}」、地域「${sample[5]}」（手配書の表示: 南ザナラーン サゴリー砂漠）`
    : "- ウルハドシが見つからない",
);
p();

// ---- 3. エリート ----

p("## 3. エリート（B モブ）の Map / PlaceName");
p();
table(
  ["ID", "モブ", "拡張", "エリア", "PlaceName", "ラベル", "FATE"],
  targetRows.filter((r) => r[3].includes("elite")).map((r) => [r[0], r[1], r[2], r[4], r[5], r[6], r[7]]),
);

// ---- 4. 座標変換 ----

p("## 4. 座標変換");
p();
const readTc = (f) => {
  if (!args.teamcraft) return null;
  const file = path.join(args.teamcraft, f);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
};
const tcAetherytes = readTc("aetherytes.json");
const tcFates = readTc("fates.json");
const tcNpcs = readTc("npcs.json");
const tcAetheryteById = new Map((tcAetherytes ?? []).map((a) => [String(a.id), a]));
const percentile = (list, q) => {
  if (!list.length) return NaN;
  const s = [...list].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};
const diffOf = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

// 4.1 MapMarker（ピクセル）→ マップ座標。エーテライトのマーカー（DataType 3）を Teamcraft の座標と比べる
p("### 4.1 MapMarker の座標変換: エーテライトのマーカーと Teamcraft の座標");
p();
const aeRows = [];
const aeDiffs = [];
let aeLevelFound = 0;
let aeTotal = 0;
for (const a of Aetheryte.list) {
  if (a.IsAetheryte !== "True" || num(a.Map) === 0) continue;
  aeTotal++;
  if (Level.get(a["Level[0]"])) aeLevelFound++;
  const mk = markersOfMap(a.Map).find((mm) => num(mm.DataType) === 3 && mm.DataKey === a._id);
  const tc = tcAetheryteById.get(a._id);
  if (!mk || !tc) continue;
  const c = markerToMapCoord(mk, a.Map);
  const d = diffOf(c, tc);
  aeDiffs.push(d);
  aeRows.push([a._id, placeName(a.PlaceName), mapZoneName(a.Map), `${f1(c.x)}, ${f1(c.y)}`, `${f2(tc.x)}, ${f2(tc.y)}`, f2(d)]);
}
p(`- 比べたエーテライト: ${aeDiffs.length} 件、差の中央値 ${f2(percentile(aeDiffs, 0.5))}、95% 点 ${f2(percentile(aeDiffs, 0.95))}、最大 ${f2(Math.max(...aeDiffs))}`);
p(`- 参考: Aetheryte.Level[0] が Level シートにあるもの: ${aeLevelFound} / ${aeTotal} 件`);
p();
const aeBig = aeRows.filter((r) => num(r[5]) >= 0.3);
p(`差が 0.3 以上のもの: ${aeBig.length} 件`);
p();
if (aeBig.length) table(["ID", "エーテライト", "エリア", "MapMarker→座標", "Teamcraft", "差"], aeBig);
p("抜粋:");
p();
table(
  ["ID", "エーテライト", "エリア", "MapMarker→座標", "Teamcraft", "差"],
  aeRows.filter((r) =>
    ["キャンプ・ドライボーン", "リトルアラミゴ", "ファルコンネスト", "アラガーナ", "ユールモア", "ラディスカの樹上", "ワチュン・ペロ"].includes(r[1]),
  ),
);

// 4.2 Level（ワールド座標）→ マップ座標。NPC の Level（Type 8、Object = ENpcResident）を Teamcraft の NPC の座標と比べる
p("### 4.2 Level の座標変換: NPC の Level と Teamcraft の NPC の座標");
p();
const npcDiffs = [];
const npcBig = [];
if (tcNpcs) {
  for (const lv of Level.list) {
    if (num(lv.Type) !== 8) continue;
    const tc = tcNpcs[lv.Object]?.position;
    if (!tc || String(tc.map) !== lv.Map) continue;
    const c = levelToMapCoord(lv);
    if (!c) continue;
    const d = diffOf(c, tc);
    npcDiffs.push(d);
    if (d >= 0.3) npcBig.push([lv._id, lv.Object, tcNpcs[lv.Object]?.ja ?? "", mapZoneName(lv.Map), `${f1(c.x)}, ${f1(c.y)}`, `${f2(tc.x)}, ${f2(tc.y)}`, f2(d)]);
  }
}
p(
  `- 比べた NPC: ${npcDiffs.length} 件、差の中央値 ${f2(percentile(npcDiffs, 0.5))}、95% 点 ${f2(percentile(npcDiffs, 0.95))}、99% 点 ${f2(percentile(npcDiffs, 0.99))}、差 0.1 以下の割合 ${npcDiffs.length ? ((100 * npcDiffs.filter((d) => d <= 0.1).length) / npcDiffs.length).toFixed(1) : "-"}%`,
);
p(`- 差が 0.3 以上のもの: ${npcBig.length} 件（NPC が複数の場所に置かれていて Teamcraft が別の場所を採っている場合を含む）`);
p();
if (npcBig.length) {
  p("差が 0.3 以上のものの抜粋（先頭 10 件）:");
  p();
  table(["Level", "ENpc", "NPC", "エリア", "Level→座標", "Teamcraft", "差"], npcBig.slice(0, 10));
}

// 4.3 手配書の FATE
p("### 4.3 手配書の FATE の位置");
p();
const tcFateById = new Map();
if (tcFates) for (const [id, f] of Object.entries(tcFates)) tcFateById.set(String(id), f);
const fateRows = [];
let fateLevel = 0;
let fateTc = 0;
let fateTcMapMismatch = 0;
const huntFates = MobHuntTarget.list.filter((t) => num(t.FATE) > 0 && targetKind.has(t._id));
for (const t of huntFates) {
  const fate = Fate.get(t.FATE);
  const lv = fate && Level.get(fate.Location);
  if (lv) fateLevel++;
  const tcPos = tcFateById.get(t.FATE)?.position;
  if (tcPos) {
    fateTc++;
    if (String(tcPos.map) !== t.Map) fateTcMapMismatch++;
  }
  // FATE の位置にいちばん近い地域名ラベル
  let nearest = "";
  if (tcPos && String(tcPos.map) === t.Map) {
    let best = Infinity;
    for (const mm of markersOfMap(t.Map)) {
      if (num(mm.PlaceNameSubtext) === 0 || num(mm.DataType) !== 0) continue;
      const d = Math.hypot(markerToMapCoord(mm, t.Map).x - tcPos.x, markerToMapCoord(mm, t.Map).y - tcPos.y);
      if (d < best) {
        best = d;
        nearest = placeName(mm.PlaceNameSubtext);
      }
    }
  }
  fateRows.push([
    t.FATE,
    fate?.Name ?? "",
    mapZoneName(t.Map),
    placeName(t.PlaceName),
    tcPos ? `${f1(tcPos.x)}, ${f1(tcPos.y)}` : "**なし**",
    nearest,
    nearest && nearest !== placeName(t.PlaceName) ? "≠" : "",
  ]);
}
p(`- 手配書の FATE: ${huntFates.length} 件`);
p(`- Fate.Location が Level シートにあるもの: ${fateLevel} 件`);
p(`- Teamcraft に位置があるもの: ${fateTc} 件（うち Map が MobHuntTarget.Map と違うもの: ${fateTcMapMismatch} 件）`);
p(`- FATE の位置にいちばん近い地域名ラベルが MobHuntTarget.PlaceName と違うもの: ${fateRows.filter((r) => r[6]).length} 件`);
p();
table(["FATE", "FATE 名", "エリア", "PlaceName", "Teamcraft の位置", "最寄りの地域名ラベル", ""], fateRows);

// ---- 5. ハント受注場所 ----

p("## 5. 手配書の受注場所");
p();
const QuestSheet = loadSheet("Quest");
const ENpcResident = loadSheet("ENpcResident");
const nearestAetheryte = (mapId, c) => {
  let best = null;
  for (const mm of markersOfMap(mapId)) {
    const dt = num(mm.DataType);
    if (dt !== 3 && dt !== 4) continue;
    const mc = markerToMapCoord(mm, mapId);
    const d = Math.hypot(mc.x - c.x, mc.y - c.y);
    const name = dt === 3 ? placeName(Aetheryte.get(mm.DataKey)?.PlaceName) : placeName(mm.DataKey);
    if (!best || d < best.d) best = { d, name: `${name}${dt === 3 ? "" : "（DT4）"}` };
  }
  return best;
};
const issuerRows = [];
for (const t of MobHuntOrderType.list) {
  const item = EventItem.get(t.EventItem)?.Singular ?? t.EventItem;
  let npc = "";
  let lv = null;
  if (num(t.Quest) > 0) {
    const q = QuestSheet.get(t.Quest);
    npc = ENpcResident.get(q?.IssuerStart)?.Singular ?? q?.IssuerStart ?? "";
    lv = Level.get(q?.IssuerLocation);
  } else {
    // 新生エオルゼアはグランドカンパニーのモブハントボード（EObj）
    npc = "モブハントボード";
    lv = null;
  }
  const c = lv ? levelToMapCoord(lv) : null;
  const near = c ? nearestAetheryte(lv.Map, c) : null;
  issuerRows.push([t._id, item, npc, lv ? mapZoneName(lv.Map) : "", c ? `${f1(c.x)}, ${f1(c.y)}` : "", near ? `${near.name}（${f1(near.d)}）` : ""]);
}
for (const lv of Level.list) {
  if (!["2004438", "2004439", "2004440"].includes(lv.Object)) continue;
  const c = levelToMapCoord(lv);
  const near = nearestAetheryte(lv.Map, c);
  issuerRows.push([`EObj ${lv.Object}`, "モブ手配書／リスキーモブ手配書", "モブハントボード", mapZoneName(lv.Map), `${f1(c.x)}, ${f1(c.y)}`, near ? `${near.name}（${f1(near.d)}）` : ""]);
}
table(["MobHuntOrderType", "手配書", "受注先", "エリア", "座標", "最寄りのエーテライト／エーテネット（距離）"], issuerRows);

// ---- 6. エリアの出口 ----

p("## 6. MapMarker のエリアの出口（DataType 1/2 → Map）");
p();
const dtCount = new Map();
for (const mm of MapMarker.list) dtCount.set(mm.DataType, (dtCount.get(mm.DataType) ?? 0) + 1);
p(`- DataType の分布: ${[...dtCount].sort((a, b) => num(a[0]) - num(b[0])).map(([k, v]) => `${k}=${v}`).join("、")}`);
p();

// 手配書の対象がいるエリア＋出発地の街を対象に、フィールド同士のつながりを見る
const huntMaps = new Set([...MobHuntTarget.list].filter((t) => num(t.Map) > 0).map((t) => t.Map));
const edges = [];
for (const mapId of huntMaps) {
  for (const mm of markersOfMap(mapId)) {
    const dt = num(mm.DataType);
    if (dt !== 1 && dt !== 2) continue;
    edges.push({ from: mapId, to: mm.DataKey, dt, marker: mm, pos: markerToMapCoord(mm, mapId) });
  }
}
const edgeKey = (a, b) => `${a}->${b}`;
const edgeSet = new Set(edges.map((e) => edgeKey(e.from, e.to)));
const exitRows = [];
for (const mapId of [...huntMaps].sort((a, b) => mapExVersion(a) - mapExVersion(b) || num(a) - num(b))) {
  const es = edges.filter((e) => e.from === mapId);
  const t = TerritoryType.get(MapSheet.get(mapId)?.TerritoryType);
  exitRows.push([
    mapId,
    mapZoneName(mapId),
    exName(mapExVersion(mapId)),
    num(t?.AetherCurrentCompFlgSet) > 0 ? "可" : "不可",
    es
      .map((e) => {
        const back = edgeSet.has(edgeKey(e.to, e.from)) ? "" : "（片方向）";
        return `${mapZoneName(e.to)}${e.dt === 2 ? "[DT2]" : ""} @${f1(e.pos.x)},${f1(e.pos.y)}${back}`;
      })
      .join("<br>") || "（なし）",
  ]);
}
p(`- 対象のいるエリア: ${huntMaps.size}、出口マーカー: ${edges.length} 件（うち DataType 2: ${edges.filter((e) => e.dt === 2).length} 件）`);
p(`- 相手側に戻りの出口マーカーが無い（片方向の）もの: ${edges.filter((e) => !edgeSet.has(edgeKey(e.to, e.from))).length} 件（相手が街などで対象外のエリアの場合を含む）`);
p();
table(["Map", "エリア", "拡張", "飛行", "出口（行き先 @座標）"], exitRows);

process.stdout.write(out.join("\n") + "\n");
