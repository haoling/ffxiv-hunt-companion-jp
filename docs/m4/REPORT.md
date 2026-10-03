# M4 仕上げ レポート

PLAN §11 の M4。ゲーム内確認のチェックリストは作らない。オフライン対応（Service Worker）も行わない。

## 実装したこと

- **ホーム画面に追加**: `public/manifest.webmanifest`（`start_url` などは相対パスなので、GitHub Pages のサブディレクトリでも動く）とアイコン（`public/icons/`。`icon.svg` から PNG を書き出したもの）。`app/layout.tsx` で manifest・アイコン・`theme-color` を指定している。Service Worker は無いので、ホーム画面に追加できるだけでオフラインでは使えない。
- **ダークモード**: 色は `app/globals.css` の CSS 変数にまとめた。既定は端末の設定（`prefers-color-scheme`）に従い、設定画面の「表示」でライト／ダークに固定できる（`UserSettings.theme`、`<html data-theme>`）。保存済みのテーマは `app/layout.tsx` の先頭スクリプトで描画前に適用し、ちらつきを防ぐ。これまでの画面はダーク固定だったので、端末がライトの場合の見た目が変わる。
- **アクセシビリティ**: タブに矢印キー・Home・End の操作とロービング tabindex、`tabpanel` の関連付けを追加。`:focus-visible` の枠、`prefers-reduced-motion` でのアニメーション停止、ライト／ダークのどちらも本文のコントラストを確保。
- **ライセンス表記**: Teamcraft（MIT）の全文を `public/licenses/teamcraft-LICENSE.txt` に置き、フッターと設定画面からリンクした。`© SQUARE ENIX` 表記は従来どおり。

## 備考

- アイコンは `icon.svg` を元にした仮のデザイン（照準）。差し替えるときは `public/icons/` の PNG も書き出し直す。
- OCR の学習データはブラウザの HTTP キャッシュに任せる（Service Worker では持たない）。
