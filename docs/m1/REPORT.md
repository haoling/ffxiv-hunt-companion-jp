# M1 データ生成レポート

[開発計画書](../PLAN.md) の M1（`hunts.json` の生成）の実装内容と、生成結果をまとめる。

- 生成スクリプト: [`scripts/build-data.ts`](../../scripts/build-data.ts)（CSV の読み込みは [`scripts/lib/datamining.ts`](../../scripts/lib/datamining.ts)）
- 補正リスト: [`scripts/zone-links.overrides.json`](../../scripts/zone-links.overrides.json)
- 型定義: [`app/lib/hunt-types.ts`](../../app/lib/hunt-types.ts)
- 出力: [`public/data/hunts.json`](../../public/data/hunts.json)（コミットする。パッチが来たら再生成する）
- ゲーム内での確認: [`CHECKLIST.md`](./CHECKLIST.md)

## 再生成の手順

Node 22.18 以上が必要（TypeScript をそのまま実行する）。

```bash
git clone --depth 1 https://github.com/xivapi/ffxiv-datamining ../ffxiv-datamining
# Teamcraft は fates.json と monsters.json だけ取得する
git clone --depth 1 --filter=blob:none --no-checkout https://github.com/ffxiv-teamcraft/ffxiv-teamcraft ../teamcraft
git -C ../teamcraft sparse-checkout set --no-cone /libs/data/src/lib/json/fates.json /libs/data/src/lib/json/monsters.json
git -C ../teamcraft checkout
npm run build:data
```

- `--datamining`、`--teamcraft`、`--out` でパスを変えられる（既定は上の手順で置いた場所と `public/data/hunts.json`）。
- `--expansions arr,hw,sb`（既定）で、含める拡張を指定する。`--expansions all` で漆黒以降も含める（AGENTS.md の方針により、当面は既定のまま）。
- 警告は標準エラー出力に出る。意図したもの以外が出たらデータの取り違えを疑う。

## 出力の内容

生成元: `ffxiv-datamining` `d9582a62`、Teamcraft `acc77d4`（`meta.sources` にも入る）。

| 項目 | 件数（新生・蒼天・紅蓮） | 全拡張（`--expansions all`、M0 と同じ） |
|---|---|---|
| 手配書の種類（`orderTypes`） | 10 | 22 |
| 対象（`targets`） | 478（デイリー 437、エリート 41） | 798（デイリー 721、エリート 77） |
| FATE のボス | 96 | 96 |
| エリア（`zones`）／出口 | 41 ／ 152 | 67 ／ 202 |
| 地域名（`regions`） | 134 | 258 |
| エーテライト（`aetherytes`） | 50 | 104 |
| 街（`cities`） | 7 | 7 |

- ファイルサイズは約 107 KB（新生〜紅蓮）。
- 全拡張で数えた対象数は M0 レポートの数字（798 体、デイリー 721、エリート 77）と一致した。

### 計画（§6）から変えた・足したところ

- `HuntTarget.regionId` を省略可にした（エリートは地域名が無い）。
- `HuntTarget` に `orderTypeIds`（載っている手配書の種類）と `neededKills`（手配書に書かれた討伐体数。取りうる値）を足した。
- `OrderType`（手配書の種類。名前・デイリー／エリート・拡張・ページ数）を足した。OCR で手配書の見出しから対象を絞るのに使える。
- `Zone` に `expansion`、`kind`（`field` / `town`）、`sizeFactor`（エリア間の距離をそろえるため）を足した。
- `HuntData.meta`（スキーマのバージョン、生成元のコミット、含めている拡張）を足した。

## エリア間のつながり（`Zone.exits`）

### 作り方

1. 対象のいるエリアと出発地の街のエリアから、`MapMarker` の `DataType` 1（出口）をたどって、行ける範囲のエリアを集める。
2. 通れるエリアは、`TerritoryType.Name` の 3 文字目が `t`（街）か `f`（フィールド）で、対象の拡張以前のもの。ハウジング（`h`）、PvP（`p`）、コンテンツの入口、対象外の拡張のエリアは除く。同じエリアへの出口（幻影諸島への船など）も除く。
3. 到着位置は、行き先のエリアにある「元のエリアへ戻る出口」の位置で代用する。戻りの出口が複数あるときは、境界に沿った座標がいちばん近いものを選ぶ。戻りの出口が無い（片方向の）出口は、反対側の出口を自動で補う（位置はエリアの中央で代用。新生〜紅蓮では 0 件、`--expansions all` では 3 件）。
4. `scripts/zone-links.overrides.json` の `remove`（出口を除く）、`requiresFlying`（飛行が必要にする）、`add`（出口を足す）を適用する。

M0 では「街の地図に出口が無いので街を通る経路は取れない」と見ていたが、実際には街の地図にも出口のマーカーがあり（街の区画どうし、フィールドとの間とも）、そのまま使えた。

### 補正リストの中身

`verified` が `false` のものは、ゲーム内での確認がまだ。確認の仕方は [`CHECKLIST.md`](./CHECKLIST.md)。

| 種類 | 内容 | 理由 |
|---|---|---|
| `remove` | 西ザナラーン ↔ リムサ・ロミンサ：下甲板層 | 船（ベスパーベイ） |
| `remove` | リムサ・ロミンサ：下甲板層 ↔ クガネ | 船 |
| `requiresFlying` | クルザス西部高地 ↔ アバラシア雲海 | 飛行が必要（ゲーム内で確認済み。出口のある島まで地面がつながっていない） |

- 飛行が必要かどうかはデータから判別できないので、ゲーム内で確認して直す。高地ドラヴァニア ↔ ドラヴァニア雲海は、推測で入れたが確認で飛行は不要と分かり、補正リストから外した。
- 補正リストに書いていないが、ルート計算の前にゲーム内で確かめたほうがよい出口は CHECKLIST にまとめた（例: アジス・ラーの出口が「イシュガルド：上層」だけになっている）。

### 既知の近似

- 街のエリア内の出口の位置は `MapMarker` の位置（マーカーの置き場所）で、実際の出入り口とずれることがある。
- 位置が取れないものはエリアの中央で代用している。
- FATE 238（血濡れの猛犬「チュパカブラ」）は Teamcraft に位置が無いので、地域名ラベルの位置で代用した（PLAN §5.1 のとおり）。
