// 同梱の hunts.json と、引きやすくした索引。実行時に外部へ取りに行かない（AGENTS.md）。

import huntsJson from "@/public/data/hunts.json";
import type { Aetheryte, HuntData, HuntTarget, Region, Zone } from "./hunt-types";

export const huntData = huntsJson as unknown as HuntData;

export type HuntIndex = {
  data: HuntData;
  targets: Map<number, HuntTarget>;
  zones: Map<number, Zone>;
  regions: Map<number, Region>;
  aetherytes: Map<number, Aetheryte>;
};

function byId<T extends { id: number }>(items: T[]): Map<number, T> {
  return new Map(items.map((item) => [item.id, item]));
}

export function buildIndex(data: HuntData): HuntIndex {
  return {
    data,
    targets: byId(data.targets),
    zones: byId(data.zones),
    regions: byId(data.regions),
    aetherytes: byId(data.aetherytes),
  };
}

export const huntIndex = buildIndex(huntData);

/** 名前の検索用に正規化する（全角半角・大文字小文字・ひらがなとカタカナの違いをなくす） */
export function normalizeName(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60))
    .replace(/\s+/g, "");
}
