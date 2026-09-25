# ffxiv-hunt-companion-jp
スマートフォンのカメラで、モブハントの手配書を自動認識して、最適なルートを導き出して、効率的なハント順を案内してくれるモバイルサイトを作りたい

実現可能性の調査結果と開発計画は [docs/PLAN.md](docs/PLAN.md) にまとめています。

## 開発

```bash
npm install
npm run dev
```

## ビルド

GitHub Pages 向けの静的エクスポートを行います。

```bash
npm run build
```

GitHub Actions のデプロイ workflow では、GitHub Pages が要求するベースパスを環境変数から自動で注入し、`out/` ディレクトリをそのままデプロイできます。ローカルビルドではベースパスなしで確認できます。
