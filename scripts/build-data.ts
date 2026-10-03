// M1: ゲームデータから public/data/hunts.json を生成する（docs/PLAN.md §5）
//
// 使い方（Node 22.18 以上。TypeScript をそのまま実行できる）:
//   node scripts/build-data.ts [--datamining <ffxiv-datamining のパス>] [--teamcraft <Teamcraft の json ディレクトリ>]
//                              [--out <出力先>] [--expansions arr,hw,sb | all]
//
// 既定値:
//   --datamining  ../ffxiv-datamining
//   --teamcraft   ../teamcraft/libs/data/src/lib/json
//   --out         public/data/hunts.json
//   --expansions  arr,hw,sb（AGENTS.md の当面の対応範囲）
//
// 準備と再生成の手順は docs/m1/REPORT.md を参照。

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { loadSheet, type Row } from "./lib/datamining.ts";
import type {
  Aetheryte,
  City,
  Expansion,
  HuntData,
  HuntTarget,
  OrderType,
  Region,
  SpawnCluster,
  Zone,
  ZoneExit,
} from "../app/lib/hunt-types.ts";

const SCHEMA_VERSION = 1;
const EXPANSIONS: Expansion[] = ["arr", "hw", "sb", "shb", "ew", "dt"]; // ExVersion 0〜5 の順

/** 出発地の候補の街（PLAN §3.2）。aetheryteId は街へテレポするときのエーテライト */
const CITIES: { id: string; aetheryteId: number; expansion: Expansion }[] = [
  { id: "limsa", aetheryteId: 8, expansion: "arr" },
  { id: "gridania", aetheryteId: 2, expansion: "arr" },
  { id: "uldah", aetheryteId: 9, expansion: "arr" },
  { id: "ishgard", aetheryteId: 70, expansion: "hw" },
  { id: "idyllshire", aetheryteId: 75, expansion: "hw" },
  { id: "rhalgrs-reach", aetheryteId: 104, expansion: "sb" },
  { id: "kugane", aetheryteId: 111, expansion: "sb" },
];

type Overrides = {
  remove: { from: number; to: number }[];
  requiresFlying: { from: number; to: number }[];
  add: (Omit<ZoneExit, "requiresFlying"> & { from: number; requiresFlying?: boolean })[];
};

// ---- 引数 ----

const args = parseArgs(process.argv.slice(2));
const root = path.resolve(import.meta.dirname, "..");
const datamining = path.resolve(args.datamining ?? path.join(root, "..", "ffxiv-datamining"));
const teamcraft = path.resolve(args.teamcraft ?? path.join(root, "..", "teamcraft", "libs", "data", "src", "lib", "json"));
const outFile = path.resolve(args.out ?? path.join(root, "public", "data", "hunts.json"));
const expansions: Expansion[] =
  args.expansions === "all" ? EXPANSIONS : ((args.expansions ?? "arr,hw,sb").split(",") as Expansion[]);
for (const e of expansions) if (!EXPANSIONS.includes(e)) fail(`不明な拡張: ${e}`);
const maxEx = Math.max(...expansions.map((e) => EXPANSIONS.indexOf(e)));

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) out[argv[i].replace(/^--/, "")] = argv[i + 1];
  return out;
}

function fail(message: string): never {
  console.error(`エラー: ${message}`);
  process.exit(1);
}

const warnings: string[] = [];
const warn = (message: string) => warnings.push(message);

// ---- シート ----

const sheet = (name: string) => loadSheet(datamining, name);
const MobHuntTarget = sheet("MobHuntTarget");
const MobHuntOrder = sheet("MobHuntOrder");
const MobHuntOrderType = sheet("MobHuntOrderType");
const BNpcName = sheet("BNpcName");
const PlaceName = sheet("PlaceName");
const MapSheet = sheet("Map");
const MapMarker = sheet("MapMarker");
const Fate = sheet("Fate");
const Aetheryte = sheet("Aetheryte");
const TerritoryType = sheet("TerritoryType");
const EventItem = sheet("EventItem");

const num = (v: string | undefined) => Number(v ?? 0);
const placeName = (id: string | number) => PlaceName.get(id)?.Name ?? "";
const round2 = (v: number) => Math.round(v * 100) / 100;

const territoryOfMap = (mapId: string | number) => {
  const m = MapSheet.get(mapId);
  return m ? TerritoryType.get(m.TerritoryType) : undefined;
};
const exVersionOfMap = (mapId: string | number) => num(territoryOfMap(mapId)?.ExVersion ?? "-1");
const sizeFactorOfMap = (mapId: string | number) => num(MapSheet.get(mapId)?.SizeFactor);

/** エリア名。サブ名があれば「エリア名（サブ名）」 */
function zoneName(mapId: string | number): string {
  const m = MapSheet.get(mapId);
  if (!m) return "";
  const sub = placeName(m.PlaceNameSub);
  return placeName(m.PlaceName) + (sub ? `（${sub}）` : "");
}

// MapMarker は Map.MapMarkerRange を主行 ID とするサブ行の集まり
const markersByRange = new Map<string, Row[]>();
for (const mm of MapMarker.list) {
  const range = mm._id.split(".")[0];
  if (!markersByRange.has(range)) markersByRange.set(range, []);
  markersByRange.get(range)!.push(mm);
}
const markersOfMap = (mapId: string | number): Row[] => {
  const m = MapSheet.get(mapId);
  return (m && num(m.MapMarkerRange) > 0 && markersByRange.get(m.MapMarkerRange)) || [];
};

/** MapMarker のテクスチャ上のピクセル位置 → ゲーム内のマップ座標（PLAN §5.2、M0 で検証済み） */
function markerPosition(mm: Row, mapId: string | number): { x: number; y: number } {
  const c = sizeFactorOfMap(mapId) / 100;
  const conv = (v: number) => round2((41 / c) * (v / 2048) + 1);
  return { x: conv(num(mm.X)), y: conv(num(mm.Y)) };
}

// ---- 手配書の種類と対象 ----

const expansionOfMap = (mapId: string | number): Expansion => EXPANSIONS[exVersionOfMap(mapId)];

const ordersByMain = new Map<string, Row[]>();
for (const o of MobHuntOrder.list) {
  const main = o._id.split(".")[0];
  if (!ordersByMain.has(main)) ordersByMain.set(main, []);
  ordersByMain.get(main)!.push(o);
}

type TargetAcc = { kind: "daily" | "elite"; orderTypeIds: Set<number>; neededKills: Set<number> };
const orderTypes: OrderType[] = [];
const targetAcc = new Map<string, TargetAcc>();

for (const t of MobHuntOrderType.list) {
  const start = num(t.OrderStart);
  const amount = num(t.OrderAmount);
  const kind = num(t.Type) === 1 ? "daily" : num(t.Type) === 2 ? "elite" : null;
  if (!kind || amount === 0) continue;
  const pages = new Set<number>();
  const exs = new Set<Expansion>();
  for (let id = start; id < start + amount; id++) {
    const subs = (ordersByMain.get(String(id)) ?? []).filter((o) => num(o.Target) > 0);
    if (subs.length) pages.add(subs.length);
    for (const o of subs) {
      const target = MobHuntTarget.get(o.Target);
      if (!target) {
        warn(`MobHuntOrder ${o._id} の対象 ${o.Target} が MobHuntTarget に無い`);
        continue;
      }
      exs.add(expansionOfMap(target.Map));
      if (!expansions.includes(expansionOfMap(target.Map))) continue;
      const acc: TargetAcc = targetAcc.get(o.Target) ?? { kind, orderTypeIds: new Set(), neededKills: new Set() };
      if (acc.kind !== kind) warn(`対象 ${o.Target} がデイリーとエリートの両方に載っている`);
      acc.orderTypeIds.add(num(t._id));
      acc.neededKills.add(num(o.NeededKills));
      targetAcc.set(o.Target, acc);
    }
  }
  if (exs.size !== 1) {
    if (exs.size > 1) warn(`手配書 ${t._id} が複数の拡張にまたがっている: ${[...exs].join(",")}`);
    if (exs.size === 0) continue;
  }
  const expansion = [...exs][0];
  if (!expansions.includes(expansion)) continue;
  const item = EventItem.get(t.EventItem);
  orderTypes.push({
    id: num(t._id),
    name: item?.Singular || item?.Name || `手配書 ${t._id}`,
    kind,
    expansion,
    pages: Math.max(...pages),
  });
}

// ---- FATE の位置（Teamcraft、MIT） ----

type TeamcraftFate = { position?: { map: number; x: number; y: number } };
const fatesFile = path.join(teamcraft, "fates.json");
if (!fs.existsSync(fatesFile)) fail(`Teamcraft の fates.json が無い: ${fatesFile}（--teamcraft で指定する）`);
const teamcraftFates = JSON.parse(fs.readFileSync(fatesFile, "utf8")) as Record<string, TeamcraftFate>;

// ---- モブの湧き位置（Teamcraft の実測、MIT） ----

type TeamcraftMonster = { baseid?: number; positions?: { map: number; fate: number; x: number; y: number }[] };
const monstersFile = path.join(teamcraft, "monsters.json");
if (!fs.existsSync(monstersFile)) fail(`Teamcraft の monsters.json が無い: ${monstersFile}（--teamcraft で指定する）`);
const teamcraftMonsters = JSON.parse(fs.readFileSync(monstersFile, "utf8")) as Record<string, TeamcraftMonster>;

/** 同じまとまりとみなす距離（マップ座標） */
const SPAWN_CLUSTER_RADIUS = 4;
/** 地域名ラベルからこの距離（マップ座標）以内のまとまりがあれば、それだけを使う */
const SPAWN_REGION_RADIUS = 12;
/** 1 体につき残すまとまりの数と、最大のまとまりに対する最小の割合 */
const SPAWN_MAX_CLUSTERS = 3;
const SPAWN_MIN_RATIO = 0.15;

/** 実測点を、近いもの同士でまとめた中心にする（同じ座標の重複は除く）。実測点が多い順 */
function clusterSpawns(points: { x: number; y: number }[]): SpawnCluster[] {
  const unique = [...new Map(points.map((p) => [`${p.x},${p.y}`, p])).values()].sort((a, b) => a.x - b.x || a.y - b.y);
  const clusters: { sx: number; sy: number; n: number }[] = [];
  for (const p of unique) {
    let best: (typeof clusters)[number] | undefined;
    let bestD = SPAWN_CLUSTER_RADIUS;
    for (const c of clusters) {
      const d = Math.hypot(c.sx / c.n - p.x, c.sy / c.n - p.y);
      if (d <= bestD) {
        best = c;
        bestD = d;
      }
    }
    if (best) {
      best.sx += p.x;
      best.sy += p.y;
      best.n++;
    } else {
      clusters.push({ sx: p.x, sy: p.y, n: 1 });
    }
  }
  return clusters.map((c) => ({ x: round2(c.sx / c.n), y: round2(c.sy / c.n), n: c.n })).sort((a, b) => b.n - a.n);
}

/** モブの湧き位置のまとまり。実測データが無ければ undefined */
function spawnsOf(bnpcNameId: string, mapId: string, regionPos: { x: number; y: number } | null): SpawnCluster[] | undefined {
  const points = (teamcraftMonsters[bnpcNameId]?.positions ?? []).filter((p) => String(p.map) === mapId && !p.fate);
  if (!points.length) return undefined;
  let clusters = clusterSpawns(points);
  if (regionPos) {
    const near = clusters.filter((c) => Math.hypot(c.x - regionPos.x, c.y - regionPos.y) <= SPAWN_REGION_RADIUS);
    if (near.length) clusters = near;
  }
  return clusters.filter((c) => c.n >= clusters[0].n * SPAWN_MIN_RATIO).slice(0, SPAWN_MAX_CLUSTERS);
}

// ---- 地域名（手配書の「生息場所」） ----

/** 地域名ラベル（MapMarker の DataType 0）の位置。同じラベルが複数あれば平均 */
function regionPosition(mapId: string, regionId: string): { x: number; y: number } | null {
  const labels = markersOfMap(mapId).filter((mm) => num(mm.DataType) === 0 && mm.PlaceNameSubtext === regionId);
  if (!labels.length) return null;
  const ps = labels.map((mm) => markerPosition(mm, mapId));
  return {
    x: round2(ps.reduce((s, p) => s + p.x, 0) / ps.length),
    y: round2(ps.reduce((s, p) => s + p.y, 0) / ps.length),
  };
}

const regions = new Map<number, Region>();
const targets: HuntTarget[] = [];
for (const [id, acc] of [...targetAcc].sort((a, b) => num(a[0]) - num(b[0]))) {
  const t = MobHuntTarget.get(id)!;
  const name = BNpcName.get(t.Name)?.Singular;
  if (!name) warn(`対象 ${id} のモブ名が BNpcName に無い`);
  const target: HuntTarget = {
    id: num(id),
    name: name ?? "",
    zoneId: num(t.Map),
    kind: acc.kind,
    expansion: expansionOfMap(t.Map),
    orderTypeIds: [...acc.orderTypeIds].sort((a, b) => a - b),
    neededKills: [...acc.neededKills].sort((a, b) => a - b),
  };

  let regionPos: { x: number; y: number } | null = null;
  if (num(t.PlaceName) > 0) {
    const regionId = num(t.PlaceName);
    target.regionId = regionId;
    regionPos = regionPosition(t.Map, t.PlaceName);
    if (!regionPos) {
      warn(`対象 ${id}（${name}）の地域名「${placeName(t.PlaceName)}」の地図上のラベルが ${zoneName(t.Map)} に無い`);
    } else if (!regions.has(regionId)) {
      regions.set(regionId, { id: regionId, zoneId: num(t.Map), name: placeName(t.PlaceName), ...regionPos });
    } else if (regions.get(regionId)!.zoneId !== num(t.Map)) {
      warn(`地域名 ${regionId}（${placeName(t.PlaceName)}）が複数のエリアにある`);
    }
  } else if (acc.kind === "daily") {
    warn(`デイリーの対象 ${id}（${name}）に地域名が無い`);
  }

  const spawns = spawnsOf(t.Name, t.Map, regionPos);
  if (spawns) target.spawns = spawns;
  else if (num(t.FATE) === 0) warn(`対象 ${id}（${name}）は Teamcraft に湧き位置が無いので地域名ラベルの位置で代用する`);

  if (num(t.FATE) > 0) {
    const fate = Fate.get(t.FATE);
    const tc = teamcraftFates[t.FATE]?.position;
    // Teamcraft に位置が無い FATE は、地域名ラベルの位置で代用する（PLAN §5.1）
    const pos = tc && String(tc.map) === t.Map ? { x: round2(tc.x), y: round2(tc.y) } : regionPos;
    if (!pos) {
      warn(`FATE ${t.FATE} の位置が取れない`);
    } else {
      if (!tc || String(tc.map) !== t.Map) warn(`FATE ${t.FATE}（${fate?.Name}）は Teamcraft に位置が無いので地域名ラベルの位置で代用した`);
      target.fate = { id: num(t.FATE), name: fate?.Name ?? "", ...pos };
    }
  }
  targets.push(target);
}

// ---- エリアとつながり ----

const overridesFile = path.join(import.meta.dirname, "zone-links.overrides.json");
const overrides = JSON.parse(fs.readFileSync(overridesFile, "utf8")) as Overrides;

/** TerritoryType.Name の 3 文字目: t = 街、f = フィールド、h = ハウジング、p = PvP など */
const territoryLetter = (mapId: string) => territoryOfMap(mapId)?.Name[2];

/** エリアグラフに入れるエリアか。フィールドか街で、対象の拡張以前のもの（ハウジング、PvP、コンテンツの入口は除く） */
const isTraversable = (mapId: string) => {
  const ex = exVersionOfMap(mapId);
  return (territoryLetter(mapId) === "t" || territoryLetter(mapId) === "f") && ex >= 0 && ex <= maxEx;
};

/** エリアの中央（街の出口のように、データから位置が取れないときの代用） */
const centerOf = (mapId: string | number) => round2(1 + 41 / (sizeFactorOfMap(mapId) / 100) / 2);

type RawExit = { from: string; to: string; x: number; y: number };
const exitsFrom = (mapId: string): RawExit[] =>
  markersOfMap(mapId)
    .filter((mm) => num(mm.DataType) === 1)
    .map((mm) => ({ from: mapId, to: mm.DataKey, ...markerPosition(mm, mapId) }));

// 対象のいるエリアから出口をたどって、通れるエリアをすべて集める（街を通らないと行けないエリアが多いため）
const zoneIds = new Set<string>(targets.map((t) => String(t.zoneId)));
for (const city of CITIES) {
  const mapId = Aetheryte.get(city.aetheryteId)?.Map;
  if (mapId && expansions.includes(city.expansion)) zoneIds.add(mapId);
}
const queue = [...zoneIds];
const rawExits = new Map<string, RawExit[]>();
while (queue.length) {
  const mapId = queue.pop()!;
  const exits = exitsFrom(mapId).filter((e) => e.to !== e.from && isTraversable(e.to));
  rawExits.set(mapId, exits);
  for (const e of exits) {
    if (!zoneIds.has(e.to)) {
      zoneIds.add(e.to);
      queue.push(e.to);
    }
  }
}

const removedKey = new Set(overrides.remove.map((r) => `${r.from}->${r.to}`));
const flyingKey = new Set(overrides.requiresFlying.map((r) => `${r.from}->${r.to}`));
for (const key of [...removedKey, ...flyingKey]) {
  const [from, to] = key.split("->");
  if (!(rawExits.get(from) ?? []).some((e) => e.to === to)) warn(`補正リストの ${key} に対応する出口がデータに無い`);
}

// 補正リストの remove を先に適用する
for (const [mapId, exits] of rawExits) {
  rawExits.set(mapId, exits.filter((e) => !removedKey.has(`${e.from}->${e.to}`)));
}

// 戻りの出口のマーカーが無い出口（片方向）は、反対側の出口を補う。
// 反対側での出口の位置は分からないので、エリアの中央で代用する（到着位置は、元の出口の位置）
const syntheticBack = new Set<RawExit>();
for (const exits of [...rawExits.values()]) {
  for (const e of exits) {
    if (syntheticBack.has(e)) continue;
    const backs = rawExits.get(e.to) ?? [];
    if (backs.some((b) => b.to === e.from)) continue;
    if (removedKey.has(`${e.to}->${e.from}`)) continue;
    const back: RawExit = { from: e.to, to: e.from, x: centerOf(e.to), y: centerOf(e.to) };
    syntheticBack.add(back);
    rawExits.set(e.to, [...backs, back]);
  }
}

/** 出口の反対側の到着位置: 行き先のエリアにある「元のエリアへ戻る出口」の位置で代用する（PLAN §5.2） */
function arrivalPosition(e: RawExit): { x: number; y: number } {
  const backs = (rawExits.get(e.to) ?? []).filter((b) => b.to === e.from);
  if (!backs.length) {
    warn(`${zoneName(e.from)} → ${zoneName(e.to)} は戻りの出口が無く、到着位置が分からない（エリアの中央で代用）`);
    return { x: centerOf(e.to), y: centerOf(e.to) };
  }
  if (backs.length === 1) return { x: backs[0].x, y: backs[0].y };
  // 戻りの出口が複数あるときは、境界に沿った座標が近いものを選ぶ（左右の端なら y、上下の端なら x）
  const c = centerOf(e.from);
  const alongBorder = Math.abs(e.x - c) >= Math.abs(e.y - c) ? "y" : "x";
  return backs.reduce((best, b) => (Math.abs(b[alongBorder] - e[alongBorder]) < Math.abs(best[alongBorder] - e[alongBorder]) ? b : best));
}

const zones: Zone[] = [];
const zoneIdList = [...zoneIds].filter((id) => isTraversable(id) || targets.some((t) => String(t.zoneId) === id));

const aetheryteList: Aetheryte[] = [];
for (const mapId of zoneIdList) {
  for (const mm of markersOfMap(mapId)) {
    if (num(mm.DataType) !== 3) continue;
    const a = Aetheryte.get(mm.DataKey);
    if (!a || a.IsAetheryte !== "True") continue;
    aetheryteList.push({ id: num(a._id), zoneId: num(mapId), name: placeName(a.PlaceName), ...markerPosition(mm, mapId) });
  }
}

for (const mapId of zoneIdList.sort((a, b) => num(a) - num(b))) {
  const exits: ZoneExit[] = (rawExits.get(mapId) ?? [])
    .filter((e) => zoneIds.has(e.to))
    .map((e) => {
      const arrival = arrivalPosition(e);
      return {
        toZoneId: num(e.to),
        x: e.x,
        y: e.y,
        arrivalX: arrival.x,
        arrivalY: arrival.y,
        requiresFlying: flyingKey.has(`${e.from}->${e.to}`),
      };
    });
  for (const add of overrides.add.filter((a) => String(a.from) === mapId)) {
    exits.push({
      toZoneId: add.toZoneId,
      x: add.x,
      y: add.y,
      arrivalX: add.arrivalX,
      arrivalY: add.arrivalY,
      requiresFlying: add.requiresFlying ?? false,
    });
  }
  const territory = territoryOfMap(mapId)!;
  zones.push({
    id: num(mapId),
    name: zoneName(mapId),
    expansion: EXPANSIONS[num(territory.ExVersion)],
    kind: territoryLetter(mapId) === "t" ? "town" : "field",
    sizeFactor: sizeFactorOfMap(mapId),
    aetherytes: aetheryteList.filter((a) => a.zoneId === num(mapId)).map((a) => a.id),
    exits,
  });
}

// ---- 街 ----

const cities: City[] = [];
for (const c of CITIES) {
  if (!expansions.includes(c.expansion)) continue;
  const a = aetheryteList.find((x) => x.id === c.aetheryteId);
  if (!a) {
    warn(`街 ${c.id} のエーテライト ${c.aetheryteId} が見つからない`);
    continue;
  }
  cities.push({ id: c.id, name: zoneName(a.zoneId).replace(/：.*$/, ""), aetheryteId: a.id, expansion: c.expansion });
}

// ---- 出力 ----

function gitHead(dir: string): string {
  try {
    const top = path.resolve(dir);
    let cur = top;
    while (!fs.existsSync(path.join(cur, ".git")) && path.dirname(cur) !== cur) cur = path.dirname(cur);
    return execFileSync("git", ["-C", cur, "rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

const data: HuntData = {
  meta: {
    schemaVersion: SCHEMA_VERSION,
    sources: { datamining: gitHead(datamining), teamcraft: gitHead(teamcraft) },
    expansions,
  },
  orderTypes: orderTypes.sort((a, b) => a.id - b.id),
  targets,
  zones,
  regions: [...regions.values()].sort((a, b) => a.id - b.id),
  aetherytes: aetheryteList.sort((a, b) => a.id - b.id),
  cities,
};

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(data) + "\n");

console.log(`出力: ${path.relative(process.cwd(), outFile)}（${(fs.statSync(outFile).size / 1024).toFixed(1)} KB）`);
console.log(`片方向の出口を補ったもの: ${syntheticBack.size} 件`);
console.log(`湧き位置が付いた対象: ${data.targets.filter((t) => t.spawns).length} / ${data.targets.length} 体`);
console.log(
  `手配書 ${data.orderTypes.length} 種類、対象 ${data.targets.length} 体（デイリー ${data.targets.filter((t) => t.kind === "daily").length}、エリート ${data.targets.filter((t) => t.kind === "elite").length}、FATE ${data.targets.filter((t) => t.fate).length}）、` +
    `エリア ${data.zones.length}、出口 ${data.zones.reduce((s, z) => s + z.exits.length, 0)}、地域 ${data.regions.length}、エーテライト ${data.aetherytes.length}、街 ${data.cities.length}`,
);
for (const w of warnings) console.warn(`警告: ${w}`);
