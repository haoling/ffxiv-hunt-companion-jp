// public/data/hunts.json の型定義（docs/PLAN.md §6）。scripts/build-data.ts が生成し、アプリが読む。

/** 拡張。当面の実装範囲は "arr" / "hw" / "sb"（AGENTS.md） */
export type Expansion = "arr" | "hw" | "sb" | "shb" | "ew" | "dt";

/** 手配書の種類（MobHuntOrderType の 1 行） */
export type OrderType = {
  id: number;
  /** 手配書の名前（例: クラン・モブ手配書：初級） */
  name: string;
  kind: "daily" | "elite";
  expansion: Expansion;
  /** 1 枚の手配書に載っている対象の数（デイリーは 5、エリートは 1） */
  pages: number;
};

/** モブの湧き位置のまとまり（実測の湧き位置をクラスタリングした中心）。x, y はゲーム内のマップ座標 */
export type SpawnCluster = { x: number; y: number; /** まとまりに含まれる実測点の数 */ n: number };

export type HuntTarget = {
  /** MobHuntTarget の行 ID */
  id: number;
  /** モブ名（日本語） */
  name: string;
  /** Map の ID */
  zoneId: number;
  /** PlaceName の ID（手配書の「生息場所」の地域名）。エリートは地域名が無いので省略 */
  regionId?: number;
  /** FATE のボスの場合の FATE。x, y はルート計算だけに使う（表示する地域名は regionId） */
  fate?: { id: number; name: string; x: number; y: number };
  /** 実測の湧き位置の中心（実測点が多い順）。実測データの無いモブは省略し、地域名ラベルの位置で代用する */
  spawns?: SpawnCluster[];
  kind: "daily" | "elite";
  expansion: Expansion;
  /** このモブが載っている手配書の種類（OrderType.id） */
  orderTypeIds: number[];
  /** 手配書に書かれている討伐体数（手配書によって違う場合があるので、取りうる値を昇順で） */
  neededKills: number[];
};

/** エリアの出口（テレポせずに隣のエリアへ行ける地点） */
export type ZoneExit = {
  toZoneId: number;
  /** 出口の位置（ゲーム内のマップ座標） */
  x: number;
  y: number;
  /** 隣のエリアでの到着位置 */
  arrivalX: number;
  arrivalY: number;
  /** 飛行しないと通れない出口か（補正リストで指定。既定は false） */
  requiresFlying: boolean;
};

export type Zone = {
  /** Map の ID */
  id: number;
  name: string;
  expansion: Expansion;
  /** field: フィールド、town: 街 */
  kind: "field" | "town";
  /** Map.SizeFactor。エリア間でワールド単位の距離をそろえるのに使う */
  sizeFactor: number;
  aetherytes: number[];
  exits: ZoneExit[];
};

/** 地域名（手配書の「生息場所」）。x, y は地図上の地域名ラベルの位置 */
export type Region = { id: number; zoneId: number; name: string; x: number; y: number };

export type Aetheryte = { id: number; zoneId: number; name: string; x: number; y: number };

/** 出発地の候補の街 */
export type City = { id: string; name: string; aetheryteId: number; expansion: Expansion };

export type HuntData = {
  meta: {
    /** データ構造が変わったら上げる */
    schemaVersion: number;
    /** 生成元データのコミット */
    sources: { datamining: string; teamcraft: string };
    /** 含めている拡張 */
    expansions: Expansion[];
  };
  orderTypes: OrderType[];
  targets: HuntTarget[];
  zones: Zone[];
  regions: Region[];
  aetherytes: Aetheryte[];
  cities: City[];
};

/** 取り込んだ手配書の 1 行（ユーザーの状態。localStorage に保存する） */
export type BillEntry = {
  targetId: number;
  neededKills: number;
  done: boolean;
  source: "ocr" | "manual";
  /** ISO 日時（追加した時刻） */
  addedAt: string;
};

export type GrandCompany = "maelstrom" | "twinAdder" | "immortalFlames";

/** 移動方法の好み（PLAN §8.1）。テレポ優先／飛行移動／徒歩移動 */
export type TravelPreference = "teleport" | "fly" | "walk";

/** 個人設定（localStorage に保存する） */
export type UserSettings = {
  grandCompany?: GrandCompany;
  /** 最後に使った出発地（City.id） */
  defaultCityId?: string;
  travelPreference: TravelPreference;
  /** 表示テーマ。"auto" は OS の設定に合わせる */
  theme: ThemePreference;
};

export type ThemePreference = "auto" | "light" | "dark";
