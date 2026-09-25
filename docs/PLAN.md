# FFXIV Hunt Companion JP 開発計画書

## 1. 概要と結論

モブハントのデイリー／ウィークリー手配書をスマホのカメラで読み取り、次のことをするモバイル向け Web サイトを作る。

- 対象モブの名前・エリア・地域名・討伐数を一覧にする
- 対象が FATE のボスなら、その FATE 名を案内する
- 出発する街を選べるようにして、効率のよい回り方を**文字で**案内する
- 倒し終えたモブにチェックを入れて、完了表示にする

**結論: 実現できる。** サーバーは不要で、今のスケルトン（Next.js の静的エクスポート＋GitHub Pages）のまま作れる。

- ゲームのクライアントデータに、モブハント専用のシート（`MobHuntTarget` / `MobHuntOrder` / `MobHuntOrderType`）がある。
  **「どのモブが、どのエリアの、どの地域にいるか」「FATE のボスかどうか、その FATE はどれか」がデータとして引ける。**
- 地域名（例:「サゴリー砂漠」）の地図上の位置は `MapMarker` から、エーテライトの位置は `Aetheryte` と `MapMarker` から取れる。これでルートを計算できる。
- いちばん不確実なのは**カメラ撮影からの文字認識（OCR）の精度**。
  認識結果を「既知のモブ名辞書」とのあいまい一致で補正し、候補から選び直せる UI を用意すれば実用になる見込み。

## 2. 要件ごとの実現方法

| # | 要件 | 実現方法 | データソース | 難易度 |
|---|---|---|---|---|
| 1 | 手配書をカメラで認識してモブ名・エリアを抽出 | `getUserMedia` で撮影（画像アップロードも可）→ Tesseract.js（jpn）で OCR → モブ名辞書とあいまい一致 → 確認・修正 UI | `MobHuntTarget` → `BNpcName` | **高**（精度がいちばんのリスク） |
| 2 | FATE ボスなら FATE 名を案内 | `MobHuntTarget.FATE` が 0 以外なら FATE の対象として、`Fate.Name` を表示 | `MobHuntTarget.FATE` → `Fate` | 低 |
| 3 | エリアとおおよその位置から最適ルート | エリアごとにまとめ、エーテライトを起点にエリア内の回る順番を最適化 | `Map`、`MapMarker`、`Aetheryte`、`Fate` → `Level` | 中 |
| 4 | ルートは文字で表示 | 「テレポ先 → 地域名 → 対象」の手順リストを出す | 上と同じ | 低 |
| 5 | 位置は地域名で表示 | `MobHuntTarget.PlaceName`（手配書の「生息場所」と同じ）を使う。FATE は座標にいちばん近い地域名ラベルを使う | `PlaceName`、`MapMarker` | 低〜中 |
| 6 | 出発地をハント受注できる街から選ぶ | 街の一覧を持ち、各街のエーテライトを起点にする | 手で管理する街リスト＋`Aetheryte` | 低 |
| 7 | 倒し終えたら手動でチェック | チェックボックス＋`localStorage` に保存。日次／週次で自動リセット | — | 低 |

## 3. 手配書の仕様（前提）

### 3.1 種類

- **デイリー手配書**: 拡張ごとにレベル別の手配書がある。1 枚に対象が複数あり、UI ではページ送り（例: `4/5`）で 1 体ずつ表示される。
- **ウィークリー手配書（エリートモブ）**: 週に 1 回受注する。対象は B モブで、決まった湧き地点候補のどこかに出る。

添付画像（新生エオルゼアの不滅隊の手配書）の下部パネルに出る情報:

```
モブ手配書                       4/5
討伐対象   ウルハドシ
討伐体数   1
生息場所   南ザナラーン サゴリー砂漠
討伐報酬   ギル:2,000 同盟記章:20
発行公証人 不滅隊局長 ラウバーン・アルディン
```

→ OCR で読むのは**この下部パネルだけ**でよい。上の羊皮紙風の部分は装飾文字で読めないので使わない。
`生息場所` に「エリア名＋地域名」がそのまま出るのが大きい。

### 3.2 ハントを受注できる街（出発地の候補）

| 拡張 | 街 |
|---|---|
| 新生エオルゼア | リムサ・ロミンサ（黒渦団）／グリダニア（双蛇党）／ウルダハ（不滅隊）※所属するグランドカンパニーの本部だけ |
| 蒼天のイシュガルド | イシュガルド |
| 紅蓮のリベレーター | クガネ／ラールガーズリーチ |
| 漆黒のヴィランズ | クリスタリウム／ユールモア |
| 暁月のフィナーレ | オールド・シャーレアン／ラザハン |
| 黄金のレガシー | トライヨラ／ソリューション・ナイン |

出発地は受注場所と同じでなくてもよい（受注後にテレポしてから回り始めるケースに対応する）。
設定で「最後に使った出発地」を覚えておく。

## 4. アーキテクチャ

- **フロントエンド**: 今の Next.js 16（App Router、`output: "export"`）＋ React 19。全部クライアント側で処理する。
- **ホスティング**: GitHub Pages（既存の `.github/workflows/deploy.yml` をそのまま使う）。
- **データ**: ビルド時に生成した JSON（`public/data/hunts.json`）を同梱し、実行時に外部 API へアクセスしない。
- **OCR**: Tesseract.js（WASM）。`jpn` の学習データは数 MB あるので、スキャン画面を開いたときに遅延読み込みし、Service Worker でキャッシュする。

```
[カメラ/画像] → [切り出し・前処理] → [Tesseract.js] → [辞書照合] → [確認・修正UI]
                                                                  ↓
                          [チェック状態(localStorage)] ← [対象リスト] → [ルート計算] → [文字のルート表示]
                                                                  ↑
                                                    [hunts.json（ビルド時に生成）]
```

## 5. データパイプライン

### 5.1 使うシート

`xivapi/ffxiv-datamining` の CSV（日本語）を取り込む。スキーマは `xivdev/EXDSchema` で確認済み。

| シート | 使う列 | 用途 |
|---|---|---|
| `MobHuntTarget` | `Name`→BNpcName, `FATE`→Fate, `Map`→Map, `PlaceName`→PlaceName, `Icon` | 対象モブの本体データ |
| `MobHuntOrder` | `Target`, `NeededKills`, `Type`, `Rank`, `MobHuntReward` | 手配書ごとの対象と討伐数 |
| `MobHuntOrderType` | `Quest`, `EventItem`, `OrderStart`, `Type`, `OrderAmount` | デイリー／エリートの区別、どの拡張の手配書か |
| `BNpcName` | `Singular` | モブ名（OCR 辞書） |
| `Fate` | `Name`, `Location`→Level | FATE 名と位置 |
| `Level` | `X`, `Z`, `Map` | FATE の座標 |
| `Map` | `SizeFactor`, `OffsetX/Y`, `PlaceName`, `TerritoryType` | 座標変換、エリア名 |
| `MapMarker` | `PlaceNameSubtext`, `X`, `Y`, `DataType`, `DataKey` | 地域名ラベルとエーテライトの位置 |
| `Aetheryte` | `PlaceName`, `Territory`, `IsAetheryte` | テレポ先 |
| `PlaceName` | `Name` | 地域名・エリア名 |

### 5.2 生成スクリプト

- `scripts/build-data.ts`（Node）で CSV を読み、`public/data/hunts.json` を出力する。
- 生成した JSON はリポジトリに commit する（ビルドのたびに外部から取得しない）。パッチが来たら手動で再生成する。
- 座標変換（ゲーム内のマップ座標にそろえる）:
  - `Level` の座標: `c = SizeFactor / 100`、`mapX = 41 / c * ((X + OffsetX) * c + 1024) / 2048 + 1`（Z も同様）
  - `MapMarker` の座標: テクスチャ上のピクセル位置なので `mapX = 41 / c * X / 2048 + 1`
  - どちらも M0 で実際のゲーム内の座標と数点照らし合わせて検証する。

### 5.3 位置の精度についての方針

- 通常モブの湧き位置は**ゲームデータに無い**（サーバー側で決まる）。
  そこで `MobHuntTarget.PlaceName` の**地域名ラベルの位置**を「おおよその位置」として扱う。
- FATE ボスは `Fate` → `Level` の正確な座標を使い、表示用にいちばん近い地域名ラベルを当てる。
- エリート（B モブ）は湧き地点が複数あるので、表示は「エリア＋主な地域名」にとどめる。
  あとで HuntHelper の湧き地点データ（MIT）を取り込んで候補を出せるようにする（任意）。
- さらに精度が要る場合は、Teamcraft の monsters データ（MIT）の実測座標で上書きできるようにする（任意）。

### 5.4 ライセンス表記

- ゲームデータ: FINAL FANTASY XIV Materials Usage License に従い、**非商用**で運用し、`© SQUARE ENIX` を表記する。
- MIT のデータ（HuntHelper、Teamcraft）を使う場合は、著作権表示を `public/licenses/` とフッターに載せる。

## 6. データモデル（案）

```ts
type HuntTarget = {
  id: number;             // MobHuntTarget の行 ID
  name: string;           // モブ名（日本語）
  nameKana?: string;      // あいまい一致の補助（任意）
  zoneId: number;         // Map の ID
  regionId: number;       // PlaceName の ID（地域）
  fate?: { id: number; name: string; x: number; y: number };
  kind: "daily" | "elite";
  expansion: "arr" | "hw" | "sb" | "shb" | "ew" | "dt";
};

type Zone = { id: number; name: string; aetherytes: number[] };
type Region = { id: number; zoneId: number; name: string; x: number; y: number };
type Aetheryte = { id: number; zoneId: number; name: string; x: number; y: number };
type City = { id: string; name: string; aetheryteId: number; expansion: HuntTarget["expansion"] };

// 取り込んだ手配書の 1 行（ユーザーの状態）
type BillEntry = {
  targetId: number;
  neededKills: number;
  done: boolean;
  source: "ocr" | "manual";
  addedAt: string;        // ISO 日時。リセットの判定に使う
};
```

## 7. OCR の設計

1. **入力**: カメラのプレビュー（`getUserMedia`、背面カメラ）で撮影する。PC のスクリーンショットの取り込み（`<input type="file" accept="image/*">`）にも対応する。スクリーンショットのほうが精度はずっと高い。
2. **切り出し**: プレビューに「下部パネルをこの枠に合わせる」ガイド枠を重ね、枠の中だけを切り出す。
3. **前処理**（Canvas）: グレースケール → 2〜3 倍に拡大 → コントラスト補正 → 二値化（大津の方法）。モニターを撮ったときのモアレ対策に、軽くぼかしてから二値化する。
4. **認識**: Tesseract.js（`jpn`）。行ごとに「討伐対象」「討伐体数」「生息場所」「n/5」のラベルを手がかりに値を取り出す。
5. **正規化**: 全角・半角の統一、紛らわしい文字（`ー`/`一`、`ロ`/`口`、`カ`/`力` など）をそろえる。
6. **辞書照合**: 対象モブ名の辞書（数百件）と、文字 n-gram の類似度やレーベンシュタイン距離で照合し、上位 3 件を候補にする。「生息場所」の文字列でも照合して候補を絞る。
7. **確認・修正 UI**: 認識結果を候補つきで表示し、タップで選び直せるようにする。エリア→モブの順に選べる手入力モードも常に用意する。
8. **取り込み漏れの警告**: `n/5` を読み取り、手配書 1 枚ぶんのページがそろっていなければ知らせる。

将来の選択肢: ユーザーが自分の API キーを入れた場合だけ、画像認識できる LLM で読み取るモードを追加する（既定ではオフ）。

## 8. ルート計算

1. 選んだ街のエーテライトを出発点にする。
2. 未完了の対象をエリアごとにまとめる。
3. エリアごとに、入口にするエーテライト（エリア内の対象までの合計距離が最小になるもの）を決める。
   出発する街から歩いて行ける隣のエリア（例: ウルダハ → 西／中央ザナラーン）は「徒歩」として先に回す。
4. エリア内の回る順番は、対象が少ない（多くても 10 前後）ので全順列で最短を探す。多いときは最近傍法＋2-opt に切り替える。
5. エリアの間はテレポなので、順番は「徒歩で行けるエリア → 同じ拡張のエリアをまとめる」の順に並べる。
6. 出力（文字のみ）:

```
出発: ウルダハ
1. テレポ: キャンプ・ドライボーン（南ザナラーン）
   → サゴリー砂漠（東へ）: ウルハドシ ×1
   → ○○: △△ ×3  ※FATE「□□」のボス
2. テレポ: …
```

- 方角（北東へ など）は、直前の地点から次の地点へのベクトルで決める。
- FATE の対象には「FATE が発生していないときは待つか、後回しにする」と注記する。

## 9. 進捗管理

- 各対象にチェックボックスを付け、チェックしたら完了表示（取り消し線、グレーアウト）にして、ルートから外す。
- 状態は `localStorage` に保存する（端末ごと。読み書きは try/catch で囲み、使えない環境でも画面は動くようにする）。
- 日次・週次のリセット時刻を過ぎていたら、該当する手配書の状態を自動でクリアする（時刻は §12 の未確認事項）。

## 10. 画面構成

1. **ホーム**: 今日の手配書リストと進捗、「スキャン」「手入力」ボタン、出発地の選択
2. **スキャン**: カメラのプレビュー＋ガイド枠、撮影、画像の取り込み
3. **確認・修正**: 認識結果と候補、討伐数の修正、「リストに追加」
4. **ルート**: 出発地を選ぶ → 手順リスト（各行にチェックボックス）
5. **設定**: 所属グランドカンパニー、既定の出発地、データのバージョン表示、ライセンス表記

## 11. マイルストーン

| ID | 内容 | 完了条件 |
|---|---|---|
| M0 | データの検証 | `MobHuntTarget.PlaceName` が手配書の「生息場所」の地域名と一致すること、座標変換がゲーム内の座標と合うことを数件で確認する |
| M1 | データ生成 | `scripts/build-data.ts` で `hunts.json` を生成し、全拡張のデイリー／エリートの対象が入っている |
| M2 | 手入力＋ルート（最小版） | 手入力で対象を追加でき、出発地を選ぶと文字のルートが出る。チェックと自動リセットが動く。**OCR なしでも使える状態** |
| M3 | OCR | スクリーンショットで上位 1 件の正解率 95% 以上、スマホ撮影で上位 3 件の正解率 90% 以上（サンプル 30 枚以上） |
| M4 | 仕上げ | PWA 化（オフライン対応、ホーム画面に追加）、ダークモード、アクセシビリティ、ライセンス表記 |

## 12. リスクと対策

| リスク | 影響 | 対策 |
|---|---|---|
| スマホ撮影の OCR 精度が低い（モアレ、反射、傾き） | 高 | 下部パネルだけ切り出す、前処理、辞書照合、候補からの選択、手入力モード、スクショ取り込み |
| Tesseract の学習データが重い | 中 | 遅延読み込み＋Service Worker でキャッシュ。初回だけダウンロードに時間がかかる旨を表示する |
| パッチで対象や名前が変わる | 中 | 生成スクリプトで再生成できるようにし、データのバージョンを画面に出す |
| 地域名ラベルの位置と実際の湧き位置がずれる | 低〜中 | 「おおよその位置」と明記する。必要なら Teamcraft の実測座標で上書きする |
| 新生エオルゼアの手配書は所属グランドカンパニーでしか受注できない | 低 | 設定で所属を選び、出発地の候補を絞る |
| データの利用条件 | 中 | 非商用、`© SQUARE ENIX` 表記、MIT データのクレジット |

## 13. 未確認事項（M0 で確認する）

- `MobHuntTarget.PlaceName` が手配書の「生息場所」の地域名と常に一致するか（エリアの場合がないか）
- エリートの対象の `PlaceName` と `Map` がどう入っているか
- `MobHuntOrderType` と拡張・手配書（デイリー Lv 別／エリート）の対応
- デイリー手配書のページ数（拡張や手配書によって違うか）
- デイリー／ウィークリーのリセット時刻（日次は 15:00 UTC = 0:00 JST、週次は火曜 8:00 UTC = 17:00 JST の想定）
- `MapMarker` の座標変換式の検証
- 各拡張のハント受注 NPC の正確な場所（街の中のどのエーテライト／エーテライトプラザが最寄りか）

## 14. 参考

- 既存の調査レポート: [`research_materials/FFXIV Monster/Mob Spawn Information API and Local Database Research Report.md`](../research_materials/FFXIV%20Monster/Mob%20Spawn%20Information%20API%20and%20Local%20Database%20Research%20Report.md)
- EXDSchema（シート定義）: https://github.com/xivdev/EXDSchema
- ffxiv-datamining（CSV）: https://github.com/xivapi/ffxiv-datamining
- Tesseract.js: https://github.com/naptha/tesseract.js
- FFXIV Teamcraft（MIT）: https://github.com/ffxiv-teamcraft/ffxiv-teamcraft
- HuntHelper（MIT）: https://github.com/img02/HuntHelper
