# FFXIV モンスター/モブ出現情報のAPI・ローカルデータベース調査レポート

モンスターの出現座標・出現時間帯・出現条件をひとまとめに提供する公式API、あるいは単一のコミュニティAPIやJSONデータセットは、現時点で存在しません。実用的には、次の3種類のソースを自分で組み合わせる必要があります。(1) XIVAPI v2 や datamining CSV から取るクライアント由来の静的データ(FATEの位置、Level座標、Weather など)。(2) プレイヤーが実測した座標データ(Teamcraft の monsters データ、HuntHelper のモブ出現地点データ)。(3) 人手で書かれたテキストの条件情報(S-rankのトリガー、FATEの天候・前提条件など)。

## TL;DR
- **公式APIは無い。** Square Enix はゲームデータ用の公開APIを提供していません。コミュニティ標準は XIVAPI v2(v2.xivapi.com)で、稼働・保守中です。ただしXIVAPIが返すのは「ゲームクライアントファイルにあるデータ」だけです。通常モブの出現地点はサーバー側で決まるため含まれず、FATEの位置(Level 参照)や天候テーブルは取得できます。
- **座標データの本命は実測データ。** 通常モブの座標は FFXIV Teamcraft のプレイヤー報告データ(MIT)、ハントモブのB/A/S出現地点は HuntHelper(img02、MIT)のデータが事実上の標準です。どちらもGitHubから取ってローカルで使えます。Garland Tools の mob データは、Square Enix 公式FAQによると2019年4月23日にサービスを終了した Libra Eorzea(アプリ更新はパッチ4.2まで)に依存していたため、古いままの部分があります。
- **出現条件の構造化データは無い。** S-rankの湧き条件やFATE連鎖・天候条件を機械可読で配布する公開データセットは見つかりませんでした。Faloop・Sonar には公開・文書化されたAPIがありません。条件はガイドサイトやWikiから自分でJSON化するのが現実的です。

## Key Findings(ソース別サマリー)

| ソース | 種別 | 形式 | 出現関連で取れるもの | 保守状況 | ライセンス/注意 |
|---|---|---|---|---|---|
| Square Enix 公式 | なし | — | 公開ゲームデータAPIは無い | — | Materials Usage License(非商用) |
| XIVAPI v2 | ライブAPI | JSON | Fate / Level / Map / TerritoryType / BNpcName / WeatherRate 等の全シート | 稼働中。7.0以降の全パッチを保持 | ライブラリはMIT。データの権利は Square Enix |
| XIVAPI v1 Mappy | レガシーAPI | JSON | 旧来の実測 NPC/Enemy 座標 | v1は非推奨。Mappy本体は2021年にアーカイブ | 鮮度が低い |
| xivapi/ffxiv-datamining | 静的DL | CSV | Level.csv、Fate、TreasureSpot 等 | 2026年9月17日更新 | 権利表示に注意 |
| EXDSchema | 静的DL | YAML | シート/列の定義(スキーマ) | 2026年に更新あり | データ本体は含まない |
| Garland Tools | 半公開のJSONエンドポイント | JSON | fate(zoneId, coords, type)、mob、weather | サイトは稼働。mobデータは一部古い | 公式APIではない。キャッシュ必須 |
| FFXIV Teamcraft | 静的(GitHub/CDN) | JSON | 通常モブの実測座標(zone/map/x,y/レベル/FATE紐付け) | リポジトリは2026年9月15日更新 | MIT |
| HuntHelper(img02) | 静的(プラグイン同梱) | JSON(推定) | B/A/Sハントモブの出現地点座標 | 継続利用。派生プロジェクトあり | MIT © 2022 imaginary-png |
| Turtle Scout | 静的(GitHub) | JS/JSON/CSV | HuntHelper由来の spawn points、zones/mobs | OSS | リポジトリのライセンスに従う |
| Faloop | Web+非公開フィード | Socket.IO(非公開) | S-rankの死亡時刻・湧き報告(POI ID) | 活発 | 公開APIなし。要ログイン |
| Sonar | Dalamud プラグイン | 内部リソース | ハント/FATE/ゾーンDB、リアルタイム中継 | 2026年8月更新 | ライセンス "Other"。公開APIなし |
| FFXIV Console Games Wiki | Wiki | HTML(MediaWiki) | FATEの天候・前提条件、S-rank条件の記述 | 活発 | 構造化ダンプは未確認 |

## Details

### 1. 公式API(Square Enix)
- 公開のゲームデータAPIは確認できませんでした。XIVAPI 自身が「クライアントファイル内のデータしか提供できず、プレイヤーやFCといったサーバー側情報や、インベントリ等のランタイム情報にはアクセスできない」と明記しています。出現地点のようなサーバー側情報を公式に取る手段がないことを裏付けています。
- Lodestone は公式APIではありません。XIVAPI v1 はかつて Lodestone をスクレイピングしていましたが、過剰利用によってエラー率が上がり、最終的には Lodestone 側から完全にブロックされました。v2 に復活させる予定はないとしています。
- コンパニオンアプリの内部APIは解析記事が存在するものの、ban の注意書き付きです。公開APIとして扱うべきではありません。
- 利用条件は FINAL FANTASY XIV Materials Usage License(非商用・コミュニティ支援目的、© SQUARE ENIX 表記が必要、取り消し可能)です。データを使った公開ツールは非商用が前提になります。

### 2. XIVAPI(xivapi.com)の現状
- **状態:v2 が稼働・保守中、v1 は非推奨。** v2 は後方互換を持たない「ゼロからの再実装」です。スキーマには SaintCoinach の後継である EXDSchema を採用しています。公式 JS ラッパー `@xivapi/js` も v1.0.x で v2 対応となり、「XIVAPI v1 is now deprecated」と明記しています。なお、ご質問にある「Sagie 運営のコミュニティAPI」という名称は今回の調査では確認できませんでした。確認できたのは、v2 が xivapi GitHub 組織による再実装で、v2.xivapi.com でホストされているという事実です。
- **機能:**
  - パッチ公開後まもなく自動で更新されます。
  - スキーマ版・ゲーム版を固定(ピン留め)できます。
  - 7.0 以降の全パッチのデータを保持しています。
  - 全シートのどの列でも検索できます。
  - `/api/openapi.json` に OpenAPI 定義があります。
  - 例:`https://v2.xivapi.com/api/sheet/Item/37362?fields=Name,Description`
- **出現関連で取れるもの:**
  - `Fate` シート(FATE名、レベル、アイコン、位置を指す Level 参照など)
  - `Level` シート(X/Y/Z、半径、Map、Territory。FATEや宝の地図地点 `TreasureSpot` などが参照)
  - `Map` / `TerritoryType`(座標変換用の SizeFactor/Offset)
  - `BNpcBase` / `BNpcName`(モブのID・名前)
  - `WeatherRate` / `Weather`(天候予報の計算用)
- **取れないもの:**
  - 通常モブの出現座標。サーバー側情報のため含まれません。
  - ハントの湧き条件。
  - v1 にあった GameContentLinks(逆参照)。v2 には現時点で無く、将来追加を検討中とされています。
- **Mappy(旧実測座標):** v1 の `https://xivapi.com/mappy/json`(全ダンプ)と `/mappy/map/{id}` で、コミュニティが集めた NPC・敵・採集点の座標を配布していました。ただし収集ツール xivapi-mappy は 2021年9月19日にアーカイブされており、Mappy は Teamcraft に統合されたと説明されています。新規プロジェクトの依存先には向きません。

### 3. Garland Tools
- **アクセス方法:** 形式は `https://www.garlandtools.org/db/doc/{type}/{lang}/{version}/{id}.json` です。type は achievement, action, fate, fishing, item, leve, map, mob, node, npc, quest など。version は item/leve/core が 3、それ以外が 2 です。検索は `https://garlandtools.org/api/search.php`、全マップの天候は `./weather.php`、コア索引は `db/doc/core/en/3/data.json` で取れます。Node(`garlandtools-api`)、Python、Rust の非公式ラッパーがあり、mob・fate の個別取得/全件取得に対応しています。
- **出現関連フィールド:** FATE の部分オブジェクトに `z`(zoneId)、`c`(座標)、`t`(種別。Notorious Monster、EurekaNM、Bozjan NM などを含む)、`l`(レベル)があります。mob も地域や座標を持ちます。
- **注意点:**
  - 非公式ドキュメント(CyanClay)に「Libra Eorzea のサービス終了で mob データの供給が途絶え、4.x までしかない」との記述があります。Square Enix 公式フォーラムの告知によると Libra Eorzea のアプリ更新はパッチ4.2で止まり(4.3以降は Lodestone のエオルゼアデータベースで閲覧)、サービス自体は公式サポートFAQによると2019年4月23日に終了しました。記事自体が古いため現状は要検証ですが、mob 座標の網羅性は期待しないほうが安全です。
  - GarlandTools のソース(ufx/GarlandTools)を見ると、mob の所在は Sapphire(サーバーエミュレータ)のDBと、手動管理のスプレッドシートを TSV にした Supplemental データから来ています。クライアント抽出データではなく、実測・手入力データです。
  - 公式APIではなく、利用規約も明示されていません。レート制限への配慮とキャッシュが必須です。

### 4. SaintCoinach / Teamcraft / datamining 系
- **SaintCoinach / EXDSchema:**
  - SaintCoinach は歴史的な抽出ツールで、スキーマを JSON(ex.json)で持っていました。現在の標準スキーマは xivdev/EXDSchema(YAML)で、XIVAPI v2 のデフォルトでもあります。
  - どちらもシート定義であり、BNpc の出現座標は含みません。
  - ローカル抽出には Lumina(C#)、ironworks(Rust)、EXDViewer/XIViewer、Alpha(EXDSchema 対応)が使えます。
- **xivapi/ffxiv-datamining:**
  - SaintCoinach の rawexd や XIVData Oxidizer で抽出した全シートの CSV を、言語別(en/ja/de/fr、ko/cn/tc はサブモジュール)に保管しています。
  - GitHub 上で 2026年9月17日に更新されており、保守中です。
  - `Level.csv`、`Fate.csv`、`TreasureSpot.csv`(Location → Level 参照)などがあり、FATE 位置の計算に使えます。
  - パッチ履歴は xivapi/ffxiv-datamining-patches(1.23〜現行)にあります。代替の CSV として skyborn-industries/xiv-data(FFXIV Collect 用、パッチ日に更新)もあります。
- **重要な制約:** ゲームファイルには通常モブの出現場所が書かれていません。Wayfarer プロジェクトの PR でも「no game file says where an ordinary monster spawns」と明言されています。BNpcBase/BNpcName を JSON 化しても、座標は付きません。
- **FFXIV Teamcraft(ffxiv-teamcraft/ffxiv-teamcraft、MIT、デフォルトブランチ staging、2026年9月15日更新):**
  - パケットキャプチャ付きデスクトップアプリ(旧 Mappy 統合)による、プレイヤーの実測モブ位置データを持っています。
  - データは `https://cdn.ffxivteamcraft.com/assets/data/{contentName}.{hash}.json` 形式で配信され、ffxiv-teamcraft/data-api が遅延読み込みAPIの層を提供します(`/:hash/:contentName/:ids`)。
  - 規模の目安として、Wayfarer は「Hunty の討伐手帳データと Teamcraft のプレイヤー報告(いずれも MIT)から、1,059 体の討伐対象のうち 972 体、11,595 地点」を得たと報告しています。
  - **未検証の点:** リポジトリ内の正確なパス(`libs/data/src/lib/json/monsters.json` と推定)とフィールド構造(BNpcBase ID をキーに `baseid`/`zoneid`/`positions[{x,y,zoneid,map,level,fate}]` と推定)。GitHub の raw ファイルを直接確認してください。

### 5. ハント(S/A/B・SS)関連ツール
- **HuntHelper(github.com/img02/HuntHelper、MIT © 2022 imaginary-png):**
  - Dalamud プラグインで、マップレーダー、A-rank トレインの記録、出現地点の記録(`/hhr`)、S-rank トリガーのカウンターを備えます。
  - 同梱の出現地点データ(ゾーン別の B/A/S 候補座標とテリトリーID)が事実上のコミュニティ標準で、HuntHelperEvolved や Turtle Scout が MIT に基づいて再利用しています。
  - 外部連携として公開されているのはゲーム内 IPC(`HH.GetTrainList`、`HH.GetVersion` など)だけで、HTTP API はありません。
  - JSON の正確なパスは未確認です。作者の旧作 a-ffxiv-hunt-tracker では、Data フォルダ内の JSON でモブデータを編集できました。
  - マップ画像は img02/HuntHelper-Resources にあり、Dawntrail のデータは `ireallywanttostayatyourhou.se/dawntrail` で閲覧できます。
- **Turtle Scout(pm-wobbuffet/scout):** 最も手軽に使える「すでにファイル化されたコピー」です。
  - `resources/json/zones.js`:拡張・ゾーン・モブ
  - `resources/json/spawn_points_hunthelper.js`:HuntHelper 由来の出現地点
  - `resources/csv/SPAWN_POINT_MOBS.csv`:旧拡張の地点とモブの対応
  - 新拡張向けの抽出スクリプト `get_hunts.py` も付属しています。
- **HuntHelperEvolved:** HuntHelper の出現地点データを継承しています。SS の取り巻き・本体の座標(既知の SS 取り巻き地点 72 か所)は Faloop 由来です。S-rank の湧き窓(ウィンドウ)を表示するボードもあります。
- **Faloop(faloop.app):**
  - TheGamer のインタビュー記事で「ハントと FATE のリソースの頂点(the pinnacle)」と評される最大手のトラッカーで、S-rank の死亡時刻(ToD)とウィンドウを共有します。
  - 公開・文書化されたAPIはありません。
  - リバースエンジニアリングされたクライアント(ssoe/Faloop-discord-feed)によると、Socket.IO フィードにはログイントークンが必要で、取得できるのは自リージョンの S-rank だけです。位置は X/Y 座標ではなく `zonePoiIds` で届くため、独自の対応表が必要になります。
  - アカウント認証や権限付与の運用があるため、スクレイピングは規約・コミュニティ運用上避けるべきです。
- **Sonar(FFXIV-Sonar/SonarDistrib):**
  - クラウドソースでハント/FATE の発見を自動中継する Dalamud プラグインです。
  - 共有ライブラリに「Hunts, Fates, Zones, Worlds and Data Centers」のDBを持ち、SonarResources がハント・FATE・マップのリソースを生成します。
  - ソースは公開されていますが、ライセンスは "Other"(MIT ではない)で、公開された中継APIもありません。HuntTrainAssistant などはゲーム内で連携しています。
- **その他:** conductor-helper は BearTracker・SirenHunts・PrimeHunts・Turtle Scout のテキスト報告をマクロに変換するツールで、これらのサイトが公開APIを持たないことを示唆しています。Dhoro Iloh 系・Mobbers・Snipe 系 Discord bot の公開APIや JSON 配布は、今回の調査では確認できませんでした。
- **湧き条件と時間窓:** 構造化データはなく、ガイドサイト(ffxivhunt.com、srankguide.carrd.co、ffxivhunt.carrd.co)の記述が中心です。
  - 例:Burfurlur は Tiny Troll を出して日中かつ快晴/晴れ(Gamer Guides の S-Rank 一覧。ffxivhunt.com は日中を ET 9:00〜17:00 と記載)。
  - 例:Croque-mitaine は ET 19:00〜22:00 に特定の採掘点。
  - 例:Garlok は雨/暴雨の後に天候変化が雨以外で連続すること。
  - 条件は「地雷型(地点+ミニオン等)」「討伐数型」「月齢・天候・時間型」などに分類できます。
  - 湧き窓は、Game Rant の Dawntrail ガイドや Gamer Guides の Endwalker 一覧によると、S-rank が通常 84〜132 時間、メンテ明け 50〜80 時間とされます(いずれもコミュニティ由来の値)。
  - これらは「theory(推定)」を含むコミュニティの経験則で、公式仕様ではありません。

### 6. FATE データ
- **位置(静的):** `Fate` シートの位置 → `Level`(X/Y/Z・Map・Territory)で算出できます(XIVAPI v2 / datamining CSV)。Garland の fate JSON もゾーンと座標を持ちます。
- **ランタイム:** Dalamud の `IFate` が Position、Radius、Level、Progress などを提供します。自分でプラグインを作れば実測できます。
- **発生条件(連鎖・天候):** 機械可読の公開DBは見つかりませんでした。Console Games Wiki の FATE 一覧が最も整理されています。
  - 例:Steel Reign(オーディン)は天候「Tension」。
  - 例:A Horse Outside(イクシオン)は天候「Quick Levin」。
  - 例:Ttokrrone は前提 FATE が 4 つ。
  - Sonar も内部に FATE DB を持ちますが、外部公開はされていません。
- **Faloop 上の扱い:** AetherHunts の案内によると、ボス FATE(ワールドボス級)は Faloop で告知できますが、アチーブメント FATE は Faloop で告知できず、Faloop bot でも配信されません。

### 7. ディープダンジョン等
- DeepDungeonDex(Strati)はアーカイブ済みで、データはプラグインにハードコードされていました。
- 後継の MonsterDex(wolfcomp)はデータを Web から読み込みます。
- OfDungeonsDeep は ddcompendium.com のデータを許可を得て使用しています。
- いずれも出現座標よりも、モブの行動・危険度情報が中心です。

### 8. コミュニティWiki
- FFXIV Console Games Wiki は MediaWiki ベースです。構造化データの一括ダンプは確認できませんでした。
- BeastieBuddy(rail2025)は「Data sourced from the community-maintained FFXIV Wiki」として、Wiki をスクレイピング・整形したモブ所在データを軽量APIで配信しています。ローカルのスクレイパーでオフライン化することもできます。ただし BeastieBuddy はプロプライエタリで、ソースは閲覧用に公開されているだけです。
- Gamer Escape のデータダンプは確認できませんでした。Wiki を二次利用する場合は、各 Wiki のコンテンツライセンスを個別に確認してください。

## Recommendations
1. **土台:** ffxiv-datamining の CSV(オフライン)または XIVAPI v2(バージョンをピン留め)で、`Fate`・`Level`・`Map`・`TerritoryType`・`BNpcName`・`WeatherRate` を取得し、ローカル JSON/SQLite に変換します。天候予報や ET の計算は、WeatherRate と既知のアルゴリズムで自前実装します。
2. **通常モブ座標:** Teamcraft の monsters データ(MIT)を取り込みます。取り込む前に、raw ファイルでパスとフィールドを確認してください。
3. **ハントモブ:** HuntHelper の出現地点データ(MIT)を使います。すぐに使えるファイルが欲しい場合は、Turtle Scout の `spawn_points_hunthelper.js` / `zones.js` を利用します。
4. **条件データ:** S-rank の湧き条件と FATE の天候・前提条件は、ガイドや Wiki を出典にして自前の JSON スキーマ(例:`{mobId, rank, zone, windowHours, windowAfterMaint, triggers:[{type:"weather"|"et"|"minion"|"killCount"|"moon", value}]}`)で手動管理します。記述には「推定」フラグを付けます。
5. **リアルタイム性が必要な場合:** Faloop・Sonar の非公開フィードは使わず、Dalamud プラグインを自作して IFate や周囲オブジェクトを取得する方法が、規約面でも技術面でも最も安全です。
6. **公開時:** Materials Usage License に従い、非商用で © SQUARE ENIX を表記します。再利用した MIT データの著作権表示も同梱してください。

## Caveats
- Teamcraft の monsters データの正確なパスとフィールド名、HuntHelper の JSON の正確なパスは、GitHub のディレクトリを閲覧できなかったため未検証です(推定として記載)。
- Garland の「mob データは 4.x(公式告知ではアプリ更新はパッチ4.2)まで」という記述は古い非公式ドキュメントに基づくもので、現状は変わっている可能性があります。
- 「Sagie」運営という前提は確認できませんでした。
- ハントの湧き条件・湧き窓はコミュニティの経験則で、パッチで変わることがあります。
- Faloop のフィード構造はリバースエンジニアリングに基づく情報で、予告なく変更される可能性があります。