// OCR の認識結果（文字列）から、手配書の下部パネルの項目を取り出し、モブ名の辞書と照合する（PLAN §7 の 4〜6、8）。
// ブラウザにも Node にも依存しない純粋関数だけを置く。

import type { HuntIndex } from "./hunt-data";
import type { HuntTarget } from "./hunt-types";

/** OCR で取り出した手配書の項目 */
export type ParsedPanel = {
  /** 「討伐対象」の値（ラベルが見つからなければ undefined） */
  name?: string;
  /** 「討伐体数」の値 */
  kills?: number;
  /** 「生息場所」の値（地域名など） */
  place?: string;
  /** ページ表示（例: 4/5） */
  page?: { current: number; total: number };
  /** 全行（ラベルが読めなかったときの照合に使う） */
  lines: string[];
};

export type Candidate = {
  target: HuntTarget;
  /** 0〜1。モブ名の類似度に、生息場所が合うときの加点を足したもの */
  score: number;
  /** 生息場所の文字列が、このモブの地域名・エリア名と合ったか */
  placeMatched: boolean;
};

/** 紛らわしい文字を同じ文字にそろえる表（PLAN §7 の 5） */
const CONFUSABLE: Record<string, string> = {
  一: "ー",
  "-": "ー",
  "−": "ー",
  "―": "ー",
  "‐": "ー",
  口: "ロ",
  力: "カ",
  卜: "ト",
  二: "ニ",
  工: "エ",
  八: "ハ",
  夕: "タ",
  干: "ケ",
  "〜": "ー",
  "~": "ー",
  "・": "",
  "·": "",
  ".": "",
  "。": "",
  "、": "",
  ",": "",
  "'": "",
  '"': "",
  "|": "",
  "｜": "",
};

/** 照合用の文字列にする。全角半角・かな・空白・紛らわしい文字の違いをなくす */
export function matchKey(text: string): string {
  const folded = text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60))
    .replace(/\s+/g, "");
  let out = "";
  for (const c of folded) out += CONFUSABLE[c] ?? c;
  // ローマ数字の I/V は英字の l・1・| との取り違えが多いので、I にそろえる
  return out.replace(/[l1]/g, "i");
}

/** レーベンシュタイン距離 */
export function levenshtein(a: string, b: string): number {
  const x = [...a];
  const y = [...b];
  if (x.length === 0) return y.length;
  if (y.length === 0) return x.length;
  let prev = Array.from({ length: y.length + 1 }, (_, i) => i);
  for (let i = 1; i <= x.length; i++) {
    const cur = [i];
    for (let j = 1; j <= y.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[y.length];
}

/** needle が haystack のどこかの部分文字列にいちばん近い距離（Sellers のアルゴリズム） */
export function substringDistance(needle: string, haystack: string): number {
  const n = [...needle];
  const h = [...haystack];
  if (n.length === 0) return 0;
  let prev = Array.from({ length: n.length + 1 }, (_, i) => i);
  let best = prev[n.length];
  for (let j = 1; j <= h.length; j++) {
    const cur = [0];
    for (let i = 1; i <= n.length; i++) {
      cur[i] = Math.min(prev[i] + 1, cur[i - 1] + 1, prev[i - 1] + (n[i - 1] === h[j - 1] ? 0 : 1));
    }
    best = Math.min(best, cur[n.length]);
    prev = cur;
  }
  return best;
}

/** 全体の一致度（0〜1） */
function similarity(a: string, b: string): number {
  const len = Math.max([...a].length, [...b].length);
  return len === 0 ? 0 : 1 - levenshtein(a, b) / len;
}

/** 部分一致の一致度（0〜1）。短い名前は偶然一致しやすいので、2 文字以下は求めない */
function containedSimilarity(needle: string, haystack: string): number {
  const len = [...needle].length;
  if (len < 3) return haystack.includes(needle) ? 1 : 0;
  return 1 - substringDistance(needle, haystack) / len;
}

/**
 * ラベルが読めず、全文から名前を探すときの一致度。
 * 短い名前は偶然近い文字列が見つかりやすいので、名前が長いほど点が高くなるようにする。
 */
function fallbackSimilarity(needle: string, haystack: string): number {
  const len = [...needle].length;
  if (len < 3) return haystack.includes(needle) ? 0.4 : 0;
  return ((len - substringDistance(needle, haystack)) / (len + 1.5)) * 0.9;
}

const LABELS = {
  name: "討伐対象",
  kills: "討伐体数",
  place: "生息場所",
} as const;

/** ラベルの文字が 1 つ 2 つ誤認識されても見つかるようにする（ラベルの直後から値が始まる） */
function findLabelEnd(line: string, label: string): number {
  const text = [...line];
  const lab = [...label];
  let bestEnd = -1;
  let bestDist = 2; // 2 文字までの誤りは許す
  for (let start = 0; start + lab.length - 1 <= text.length; start++) {
    for (const width of [lab.length - 1, lab.length, lab.length + 1]) {
      if (width <= 0 || start + width > text.length) continue;
      const d = levenshtein(text.slice(start, start + width).join(""), label);
      if (d < bestDist || (d === bestDist && bestEnd >= 0 && start + width < bestEnd)) {
        bestDist = d;
        bestEnd = start + width;
      }
    }
  }
  return bestDist <= 1 ? bestEnd : -1;
}

/** OCR の全文から、討伐対象・討伐体数・生息場所・ページ表示を取り出す */
export function parsePanelText(text: string): ParsedPanel {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.normalize("NFKC").replace(/\s+/g, ""))
    .filter((l) => l.length > 0);
  const result: ParsedPanel = { lines };

  const valueAfter = (label: string): string | undefined => {
    for (const line of lines) {
      const end = findLabelEnd(line, label);
      if (end >= 0) {
        const value = line.slice(end).replace(/^[:：]/, "");
        if (value.length > 0) return value;
      }
    }
    return undefined;
  };

  result.name = valueAfter(LABELS.name);
  result.place = valueAfter(LABELS.place);

  const killsText = valueAfter(LABELS.kills);
  if (killsText) {
    const m = killsText.replace(/[OoＯ]/g, "0").match(/\d{1,2}/);
    if (m) result.kills = Number(m[0]);
  }

  for (const line of lines) {
    const m = line.match(/(\d)[/／](\d)/);
    if (m && Number(m[1]) <= Number(m[2]) && Number(m[2]) <= 9) {
      result.page = { current: Number(m[1]), total: Number(m[2]) };
      break;
    }
  }
  return result;
}

/** 生息場所の文字列が、対象の地域名・エリア名と合う度合い（0〜1） */
function placeSimilarity(index: HuntIndex, target: HuntTarget, placeKey: string): number {
  if (!placeKey) return 0;
  const region = target.regionId === undefined ? undefined : index.regions.get(target.regionId)?.name;
  const zone = index.zones.get(target.zoneId)?.name;
  // 地域名が合うほうを重く見る（エリア名だけでは同じエリアのモブを区別できない）
  const regionScore = region ? containedSimilarity(matchKey(region), placeKey) : 0;
  const zoneScore = zone ? containedSimilarity(matchKey(zone), placeKey) : 0;
  return Math.max(regionScore, zoneScore * 0.6);
}

export const MAX_CANDIDATES = 3;

/**
 * 認識結果をモブ名の辞書と照合し、候補を点数の高い順に返す。
 * 「討伐対象」の値があればそれと全体を比べ、無ければ（ラベルが読めなかったとき）全行の中から名前を探す。
 */
export function matchTargets(index: HuntIndex, parsed: ParsedPanel, limit = MAX_CANDIDATES): Candidate[] {
  const nameKey = parsed.name ? matchKey(parsed.name) : "";
  const wholeKey = parsed.lines.map(matchKey).join("");
  // 「生息場所」のラベルが読めなかったときは、全文から地域名・エリア名を探す
  const placeKey = parsed.place ? matchKey(parsed.place) : wholeKey;

  const scored = index.data.targets.map((target) => {
    const key = matchKey(target.name);
    let nameScore: number;
    if (nameKey) {
      // ラベルから取れた値は、名前全体との一致を見る。値に余計な文字が混ざる場合に備え、部分一致も少し割り引いて使う
      nameScore = Math.max(similarity(key, nameKey), containedSimilarity(key, nameKey) * 0.95);
    } else {
      nameScore = fallbackSimilarity(key, wholeKey);
    }
    const place = placeSimilarity(index, target, placeKey);
    const placeMatched = place >= 0.7;
    return { target, score: nameScore + (placeKey ? 0.12 * place : 0), placeMatched };
  });

  scored.sort((a, b) => b.score - a.score || a.target.id - b.target.id);
  return scored.slice(0, limit);
}

/** 候補を採用してよい確からしさか（これ未満は「読み取れなかった」として手入力に誘導する） */
export const MIN_ACCEPT_SCORE = 0.5;
