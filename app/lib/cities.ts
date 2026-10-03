// 出発地の候補（PLAN §3.2）と、移動方法の表示用の文言。

import { huntIndex } from "./hunt-data";
import type { City, GrandCompany, TravelPreference } from "./hunt-types";

/** 新生エオルゼアの街とグランドカンパニーの対応。所属の本部でしか手配書を受注できない */
const GC_CITY: Record<GrandCompany, string> = {
  maelstrom: "limsa",
  twinAdder: "gridania",
  immortalFlames: "uldah",
};

export const GC_LABELS: Record<GrandCompany, string> = {
  maelstrom: "黒渦団（リムサ・ロミンサ）",
  twinAdder: "双蛇党（グリダニア）",
  immortalFlames: "不滅隊（ウルダハ）",
};

/** 所属を設定しているときは、新生エオルゼアの街を所属の本部だけに絞る */
export function availableCities(grandCompany?: GrandCompany): City[] {
  return huntIndex.data.cities.filter(
    (c) => c.expansion !== "arr" || !grandCompany || c.id === GC_CITY[grandCompany],
  );
}

export const TRAVEL_LABELS: Record<TravelPreference, { name: string; description: string }> = {
  teleport: {
    name: "テレポ優先",
    description: "基本はテレポ。同じエリアの中や、隣のエリアの出口が近いときだけ、テレポせずに移動します。",
  },
  fly: {
    name: "飛行移動",
    description: "テレポせずに行けるエリアは、遠くても飛んで行きます。飛行が必要な区間も通ります。",
  },
  walk: {
    name: "徒歩移動",
    description: "テレポせずに行けるエリアは、地上を通る区間だけで行きます。飛行が必要な区間は通らず、その先へはテレポします。",
  },
};
