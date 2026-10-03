// ルート計算（PLAN §8、§8.1）。純粋関数だけで、画面や localStorage には依存しない。

import type { HuntIndex } from "./hunt-data";
import type { HuntTarget, TravelPreference, Zone } from "./hunt-types";

export type RouteOptions = {
  preference: TravelPreference;
  /** 徒歩移動でエリアをまたぐときの、直線距離に掛ける係数（地形で遠回りする分） */
  walkFactor: number;
  /** テレポの固定コスト（読み込み＋エーテライトからの移動を距離に換算したもの） */
  teleportCost: number;
};

export const DEFAULT_ROUTE_OPTIONS: Omit<RouteOptions, "preference"> = {
  walkFactor: 1.3,
  teleportCost: 30,
};

/** エリアをまたぐ 1 区間 */
export type MoveLeg = {
  fromZoneName: string;
  toZoneName: string;
  /** 出口の位置（ゲーム内のマップ座標） */
  exitX: number;
  exitY: number;
  /** この区間の出発エリアで飛行できるか（街の中は飛行できない） */
  canFly: boolean;
};

export type TravelPart =
  | { kind: "teleport"; aetheryteName: string }
  | { kind: "move"; mode: TravelPreference; legs: MoveLeg[] };

export type RouteStop = {
  key: string;
  /** 地域名。エリートは地域名が無いので省略 */
  regionName?: string;
  /** 直前の地点から見た方角（近いときは省略） */
  direction?: string;
  /** 湧き位置の中心座標（実測データがあるときだけ。ゲーム内のマップ座標） */
  center?: Point;
  targets: HuntTarget[];
};

export type RouteStep = {
  zoneId: number;
  zoneName: string;
  /** このエリアへの行き方。今いるエリアのときは空 */
  travel: TravelPart[];
  stops: RouteStop[];
};

export type Route = {
  steps: RouteStep[];
  /** ルートを組めなかった対象（エーテライトが無く、地上でもたどれないエリア） */
  unreachable: HuntTarget[];
};

type Point = { x: number; y: number };
/** エリア内の位置（ゲーム内のマップ座標） */
export type Position = Point & { zoneId: number };
type StopData = Point & {
  key: string;
  regionName?: string;
  /** 実測の湧き位置の中心から決めた位置か（表示する座標） */
  fromSpawns: boolean;
  /** fromSpawns のとき、位置の平均を出すための合計と件数 */
  sumX: number;
  sumY: number;
  count: number;
  targets: HuntTarget[];
};

/** 湧き位置の中心が近い対象を同じ立ち寄り先にまとめる距離（マップ座標） */
const SPAWN_MERGE_DISTANCE = 4;

const EPS = 1e-9;

/** マップ座標の距離を、エリアの縮尺をそろえたワールド単位にする（PLAN §8.1） */
function scaleOf(zone: Zone | undefined): number {
  return (zone?.sizeFactor ?? 100) / 100;
}

function dist(a: Point, b: Point, scale: number): number {
  return Math.hypot(a.x - b.x, a.y - b.y) * scale;
}

/** start から全ての点を回る最短の経路（終点は自由）。点が少ないときは全探索（Held-Karp）、多いときは最近傍法＋2-opt */
export function shortestTour(start: Point, points: Point[], scale: number): { order: number[]; length: number } {
  const n = points.length;
  if (n === 0) return { order: [], length: 0 };
  if (n <= 10) return exactTour(start, points, scale);
  return heuristicTour(start, points, scale);
}

function exactTour(start: Point, points: Point[], scale: number): { order: number[]; length: number } {
  const n = points.length;
  const full = 1 << n;
  const d = points.map((a) => points.map((b) => dist(a, b, scale)));
  const dp = new Float64Array(full * n).fill(Infinity);
  const parent = new Int8Array(full * n).fill(-1);
  for (let j = 0; j < n; j++) dp[(1 << j) * n + j] = dist(start, points[j], scale);
  for (let mask = 1; mask < full; mask++) {
    for (let last = 0; last < n; last++) {
      const cur = dp[mask * n + last];
      if (!(mask & (1 << last)) || cur === Infinity) continue;
      for (let next = 0; next < n; next++) {
        if (mask & (1 << next)) continue;
        const nm = mask | (1 << next);
        const v = cur + d[last][next];
        if (v < dp[nm * n + next] - EPS) {
          dp[nm * n + next] = v;
          parent[nm * n + next] = last;
        }
      }
    }
  }
  let best = 0;
  for (let j = 1; j < n; j++) if (dp[(full - 1) * n + j] < dp[(full - 1) * n + best] - EPS) best = j;
  const order: number[] = [];
  let mask = full - 1;
  let cur = best;
  while (cur !== -1) {
    order.push(cur);
    const p = parent[mask * n + cur];
    mask &= ~(1 << cur);
    cur = p;
  }
  order.reverse();
  return { order, length: dp[(full - 1) * n + best] };
}

function pathLength(start: Point, points: Point[], order: number[], scale: number): number {
  let length = 0;
  let prev = start;
  for (const i of order) {
    length += dist(prev, points[i], scale);
    prev = points[i];
  }
  return length;
}

function heuristicTour(start: Point, points: Point[], scale: number): { order: number[]; length: number } {
  const left = new Set(points.map((_, i) => i));
  const order: number[] = [];
  let prev = start;
  while (left.size) {
    let best = -1;
    for (const i of left) if (best === -1 || dist(prev, points[i], scale) < dist(prev, points[best], scale)) best = i;
    order.push(best);
    left.delete(best);
    prev = points[best];
  }
  let length = pathLength(start, points, order, scale);
  for (let improved = true; improved; ) {
    improved = false;
    for (let i = 0; i < order.length - 1; i++) {
      for (let j = i + 1; j < order.length; j++) {
        const next = [...order.slice(0, i), ...order.slice(i, j + 1).reverse(), ...order.slice(j + 1)];
        const l = pathLength(start, points, next, scale);
        if (l < length - EPS) {
          order.splice(0, order.length, ...next);
          length = l;
          improved = true;
        }
      }
    }
  }
  return { order, length };
}

type GraphNode = Position & { dist: number; prev?: string; viaExit?: { fromZoneId: number; x: number; y: number } };

const nodeKey = (p: Position) => `${p.zoneId}:${p.x},${p.y}`;

/** from から出口をたどって行ける地点（各出口の到着位置）への最短距離。飛行が必要な出口は allowFlying のときだけ通る */
function reachableNodes(index: HuntIndex, from: Position, allowFlying: boolean, factor: number): Map<string, GraphNode> {
  const nodes = new Map<string, GraphNode>();
  const done = new Set<string>();
  nodes.set(nodeKey(from), { ...from, dist: 0 });
  for (;;) {
    let curKey: string | undefined;
    for (const [key, node] of nodes) {
      if (!done.has(key) && (curKey === undefined || node.dist < nodes.get(curKey)!.dist)) curKey = key;
    }
    if (curKey === undefined) break;
    done.add(curKey);
    const cur = nodes.get(curKey)!;
    const zone = index.zones.get(cur.zoneId);
    if (!zone) continue;
    for (const exit of zone.exits) {
      if (exit.requiresFlying && !allowFlying) continue;
      if (!index.zones.has(exit.toZoneId)) continue;
      const arrival: Position = { zoneId: exit.toZoneId, x: exit.arrivalX, y: exit.arrivalY };
      const key = nodeKey(arrival);
      const d = cur.dist + dist(cur, exit, scaleOf(zone)) * factor;
      const known = nodes.get(key);
      if (!known || d < known.dist - EPS) {
        nodes.set(key, { ...arrival, dist: d, prev: curKey, viaExit: { fromZoneId: cur.zoneId, x: exit.x, y: exit.y } });
      }
    }
  }
  return nodes;
}

function legsTo(index: HuntIndex, nodes: Map<string, GraphNode>, key: string): MoveLeg[] {
  const legs: MoveLeg[] = [];
  for (let node = nodes.get(key); node?.prev !== undefined && node.viaExit; node = nodes.get(node.prev)) {
    legs.push({
      fromZoneName: index.zones.get(node.viaExit.fromZoneId)?.name ?? "",
      toZoneName: index.zones.get(node.zoneId)?.name ?? "",
      exitX: node.viaExit.x,
      exitY: node.viaExit.y,
      canFly: index.zones.get(node.viaExit.fromZoneId)?.kind === "field",
    });
  }
  return legs.reverse();
}

/** 対象を倒した場所（チェックを入れたときの現在地）。ルートの再計算はここから始める。位置の決め方は buildStops と同じ */
export function targetPosition(index: HuntIndex, t: HuntTarget): Position {
  const spawn = t.fate ? undefined : t.spawns?.[0];
  const region = t.regionId === undefined ? undefined : index.regions.get(t.regionId);
  const c = 1 + 20.5 / scaleOf(index.zones.get(t.zoneId));
  const point: Point = t.fate ?? spawn ?? region ?? { x: c, y: c };
  return { zoneId: t.zoneId, x: point.x, y: point.y };
}

/**
 * 対象の位置を決めてまとめる。FATE のボスは FATE の位置、湧き位置の実測があれば最も多い中心、
 * なければ地域名ラベルの位置（同じ地域名の対象は 1 つの立ち寄り先）、それも無ければエリアの中央
 */
function buildStops(index: HuntIndex, zone: Zone, targets: HuntTarget[]): StopData[] {
  const stops = new Map<string, StopData>();
  for (const t of targets) {
    const region = t.regionId === undefined ? undefined : index.regions.get(t.regionId);
    let key: string;
    let point: Point;
    const spawn = t.fate ? undefined : t.spawns?.[0];
    if (spawn) {
      // 中心が近い対象は同じ立ち寄り先にまとめる（中心は平均して更新する）
      const near = [...stops.values()].find((s) => s.fromSpawns && Math.hypot(s.x - spawn.x, s.y - spawn.y) <= SPAWN_MERGE_DISTANCE);
      if (near) {
        near.targets.push(t);
        near.sumX += spawn.x;
        near.sumY += spawn.y;
        near.count++;
        near.x = near.sumX / near.count;
        near.y = near.sumY / near.count;
        near.regionName ??= region?.name;
      } else {
        key = `s:${t.id}`;
        stops.set(key, { key, ...spawn, regionName: region?.name, fromSpawns: true, sumX: spawn.x, sumY: spawn.y, count: 1, targets: [t] });
      }
      continue;
    }
    if (t.fate) {
      key = `f:${t.fate.id}`;
      point = t.fate;
    } else if (region) {
      key = `r:${region.id}`;
      point = region;
    } else {
      // エリートなど位置が分からない対象は、エリアの中央で代用する（表示では方角を出さない）
      key = `z:${t.id}`;
      const c = 1 + 20.5 / scaleOf(zone);
      point = { x: c, y: c };
    }
    const stop = stops.get(key);
    if (stop) stop.targets.push(t);
    else stops.set(key, { key, ...point, regionName: region?.name, fromSpawns: false, sumX: 0, sumY: 0, count: 0, targets: [t] });
  }
  return [...stops.values()];
}

const DIRECTIONS = ["東", "北東", "北", "北西", "西", "南西", "南", "南東"];

/** from から to への方角。マップは上が北、y は南へ増える。近いときは undefined */
export function directionText(from: Point, to: Point): string | undefined {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.hypot(dx, dy) < 3) return undefined;
  const angle = Math.atan2(-dy, dx);
  return DIRECTIONS[(Math.round(angle / (Math.PI / 4)) + 8) % 8];
}

type Option = {
  /** 今の位置からこのエリアの最初の立ち寄り先に着くまでの移動コスト */
  reachCost: number;
  /** 移動＋エリア内を回る距離 */
  total: number;
  travel: TravelPart[];
  entry: Point;
  order: number[];
};

/** 今の位置から、地上・空でたどって行く場合 */
function moveOption(
  index: HuntIndex,
  nodes: Map<string, GraphNode>,
  zone: Zone,
  stops: StopData[],
  mode: TravelPreference,
): Option | undefined {
  let best: Option | undefined;
  for (const [key, node] of nodes) {
    if (node.zoneId !== zone.id) continue;
    const tour = shortestTour(node, stops, scaleOf(zone));
    const total = node.dist + tour.length;
    if (!best || total < best.total - EPS) {
      best = { reachCost: node.dist, total, travel: [{ kind: "move", mode, legs: legsTo(index, nodes, key) }], entry: node, order: tour.order };
    }
  }
  return best;
}

/** このエリアのエーテライトへテレポする場合 */
function teleportOption(index: HuntIndex, zone: Zone, stops: StopData[], teleportCost: number): Option | undefined {
  let best: Option | undefined;
  for (const id of zone.aetherytes) {
    const a = index.aetherytes.get(id);
    if (!a) continue;
    const tour = shortestTour(a, stops, scaleOf(zone));
    const total = teleportCost + tour.length;
    if (!best || total < best.total - EPS) {
      best = { reachCost: teleportCost, total, travel: [{ kind: "teleport", aetheryteName: a.name }], entry: a, order: tour.order };
    }
  }
  return best;
}

/** どこかのエーテライトへテレポしてから、地上・空でたどって行く場合（そのエリアに行く手段が他に無いときの最後の手段） */
function teleportThenMoveOption(
  index: HuntIndex,
  zone: Zone,
  stops: StopData[],
  allowFlying: boolean,
  mode: TravelPreference,
  opts: RouteOptions,
): Option | undefined {
  const factor = mode === "walk" ? opts.walkFactor : 1;
  let best: Option | undefined;
  for (const a of index.aetherytes.values()) {
    const move = moveOption(index, reachableNodes(index, { zoneId: a.zoneId, x: a.x, y: a.y }, allowFlying, factor), zone, stops, mode);
    if (!move) continue;
    const total = opts.teleportCost + move.total;
    if (!best || total < best.total - EPS) {
      best = { ...move, reachCost: opts.teleportCost, total, travel: [{ kind: "teleport", aetheryteName: a.name }, ...move.travel] };
    }
  }
  return best;
}

/** これ以下のエリア数なら、回る順番をすべて試して最短を選ぶ */
const MAX_FULL_SEARCH = 6;
/** エリアが多いときに先読みするエリア数 */
const LOOKAHEAD_DEPTH = 2;

/**
 * 出発地（エーテライトの位置、または最後に倒した場所）から、未完了の対象を回るルートを計算する。
 * - エリアごとにまとめ、エリア内は最短の順番（PLAN §8 の 4.）
 * - エリア間の移動は preference に従う（PLAN §8.1）
 */
export function computeRoute(
  index: HuntIndex,
  targets: HuntTarget[],
  start: Position | undefined,
  opts: RouteOptions,
): Route {
  const groups = new Map<number, HuntTarget[]>();
  for (const t of targets) {
    if (!index.zones.has(t.zoneId)) continue;
    groups.set(t.zoneId, [...(groups.get(t.zoneId) ?? []), t]);
  }
  const steps: RouteStep[] = [];
  const unreachable: HuntTarget[] = [];
  if (!start) {
    for (const g of groups.values()) unreachable.push(...g);
    return { steps, unreachable };
  }

  const allowFlying = opts.preference !== "walk";
  const factor = opts.preference === "walk" ? opts.walkFactor : 1;
  const moveMode = opts.preference;
  let pos: Position = start;

  /** pos から各エリアへ行く手段（移動またはテレポ）。preference に従って 1 つに絞る */
  const candidatesFrom = (from: Position, remaining: Map<number, HuntTarget[]>) => {
    const nodes = reachableNodes(index, from, allowFlying, factor);
    const list: { zone: Zone; stops: StopData[]; option: Option; canMove: boolean }[] = [];
    for (const [zoneId, groupTargets] of remaining) {
      const zone = index.zones.get(zoneId)!;
      const stops = buildStops(index, zone, groupTargets);
      const move = moveOption(index, nodes, zone, stops, moveMode);
      const teleport = teleportOption(index, zone, stops, opts.teleportCost);
      let option: Option | undefined;
      if (opts.preference === "teleport") {
        option = move && teleport ? (move.total <= teleport.total + EPS ? move : teleport) : (move ?? teleport);
      } else {
        // 飛行移動・徒歩移動: たどれるエリアは、遠くてもテレポしない
        option = move ?? teleport;
      }
      if (option) list.push({ zone, stops, option, canMove: !!move });
    }
    return list;
  };

  const endPosition = (c: { zone: Zone; stops: StopData[]; option: Option }): Position => {
    const last = c.stops[c.option.order[c.option.order.length - 1]];
    return { zoneId: c.zone.id, x: last.x, y: last.y };
  };
  const poolOf = (list: ReturnType<typeof candidatesFrom>) =>
    opts.preference !== "teleport" && list.some((c) => c.canMove) ? list.filter((c) => c.canMove) : list;
  const memo = new Map<string, number>();
  /** from から remaining を depth 個のエリアぶん回るときの、移動の手間の最小値 */
  const restCost = (from: Position, remaining: Map<number, HuntTarget[]>, depth: number): number => {
    if (depth <= 0 || !remaining.size) return 0;
    const key = `${from.zoneId}:${from.x},${from.y}|${[...remaining.keys()].sort((x, y) => x - y).join(",")}|${depth}`;
    const known = memo.get(key);
    if (known !== undefined) return known;
    const pool = poolOf(candidatesFrom(from, remaining));
    let best = 0;
    if (pool.length) {
      best = Infinity;
      for (const c of pool) {
        const next = new Map(remaining);
        next.delete(c.zone.id);
        best = Math.min(best, c.option.reachCost + restCost(endPosition(c), next, depth - 1));
      }
    }
    memo.set(key, best);
    return best;
  };

  while (groups.size) {
    const currentExpansion = index.zones.get(pos.zoneId)?.expansion;
    const candidates = candidatesFrom(pos, groups);
    // 飛行移動・徒歩移動では、たどれるエリアが残っているあいだはテレポしない
    const pool = opts.preference !== "teleport" && candidates.some((c) => c.canMove) ? candidates.filter((c) => c.canMove) : candidates;
    if (!pool.length) {
      // どのエリアにも行く手段が無いとき。どこかへテレポしてからたどる
      let fallback: (typeof candidates)[number] | undefined;
      for (const [zoneId, groupTargets] of groups) {
        const zone = index.zones.get(zoneId)!;
        const stops = buildStops(index, zone, groupTargets);
        const option = teleportThenMoveOption(index, zone, stops, true, "fly", opts);
        if (option && (!fallback || option.total < fallback.option.total)) fallback = { zone, stops, option, canMove: false };
      }
      if (!fallback) {
        for (const g of groups.values()) unreachable.push(...g);
        break;
      }
      pool.push(fallback);
    }
    // 近い順に行くだけだと、あとで大きく戻ることになる（例: 先に遠いエリアへ行って、通り過ぎた近くのエリアへ引き返す）。
    // そこで「そのエリアへ行く手間 ＋ 残りを回る手間」で比べる。残りが少ないときは最後まで、多いときは 2 手先まで見る
    const depth = groups.size <= MAX_FULL_SEARCH ? groups.size : LOOKAHEAD_DEPTH;
    const score = new Map<number, number>();
    for (const c of pool) {
      const remaining = new Map(groups);
      remaining.delete(c.zone.id);
      score.set(c.zone.id, c.option.reachCost + restCost(endPosition(c), remaining, depth - 1));
    }
    pool.sort((a, b) => {
      const sa = score.get(a.zone.id)!;
      const sb = score.get(b.zone.id)!;
      if (Math.abs(sa - sb) > EPS) return sa - sb;
      if (Math.abs(a.option.reachCost - b.option.reachCost) > EPS) return a.option.reachCost - b.option.reachCost;
      const sameA = a.zone.expansion === currentExpansion ? 0 : 1;
      const sameB = b.zone.expansion === currentExpansion ? 0 : 1;
      if (sameA !== sameB) return sameA - sameB;
      if (Math.abs(a.option.total - b.option.total) > EPS) return a.option.total - b.option.total;
      return a.zone.id - b.zone.id;
    });
    const { zone, stops, option } = pool[0];

    let prev: Point = option.entry;
    const routeStops: RouteStop[] = option.order.map((i) => {
      const s = stops[i];
      const stop: RouteStop = { key: s.key, regionName: s.regionName, targets: s.targets };
      if (s.fromSpawns) stop.center = { x: Math.round(s.x * 10) / 10, y: Math.round(s.y * 10) / 10 };
      if (s.regionName || s.fromSpawns || s.targets[0].fate) stop.direction = directionText(prev, s);
      prev = s;
      return stop;
    });
    steps.push({ zoneId: zone.id, zoneName: zone.name, travel: option.travel, stops: routeStops });
    pos = { zoneId: zone.id, x: prev.x, y: prev.y };
    groups.delete(zone.id);
  }
  return { steps, unreachable };
}
