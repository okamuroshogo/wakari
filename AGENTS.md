# AGENTS.md

AI エージェント (Claude Code / Codex など) と人間の両方に向けた、このリポジトリでの作業ルールです。

## ⚠️ これは public リポジトリです

コミットした内容は、履歴も含めて全世界に公開されます。あとから消しても取り消せません。

**絶対にコミット・PR・Issue・ログ出力に含めないもの**

- API トークン、パスワード、秘密鍵、Cookie、Webhook URL
- Cloudflare の API トークン / アカウント ID、stg の Basic 認証の ID・パスワード
- `.env` / `.dev.vars` の中身
- 個人情報 (メールアドレス、電話番号、住所など)、非公開の社内情報

**守ること**

- 秘匿値は GitHub Secrets と Cloudflare Pages の Secret にだけ置く。コード・ドキュメント・コミットメッセージに実値を書かない (例示が必要ならプレースホルダーを使う)
- コミット前に `git diff --staged` を確認する。`git add -A` / `git add .` で意図しないファイルを巻き込まない
- コマンド出力をそのまま貼るときは、トークンや ID が含まれていないか確認する
- `.github/workflows/ci.yml` は fork からの PR でも動く。Secret を参照させない。`pull_request_target` に変更しない
- もし秘匿情報をコミット・push してしまったら、削除で済ませず、まずその値を無効化 (ローテーション) して @okamuroshogo に報告する

## プロジェクト概要

「日本の課題をわかりやすく解説するサイト」 wakari.jp のソースです。誰でも Pull Request を出せます。

- Cloudflare Pages の静的サイト。HTML は `scripts/build.mjs` (Node.js 24、依存なし) が生成し、OGP 画像は `scripts/build-ogp.mjs` (`@resvg/resvg-js`)、CSS は Tailwind CSS v4 (`@tailwindcss/cli`)
- `data/issues.json` `data/categories.json` `data/tags.json` … 63 課題・10 カテゴリ・11 横断タグのマスターデータ
- `content/issues/<slug>.json` … 課題ごとの解説記事。ない課題は「準備中」ページになる。スキーマは README の「記事を追加する」
- `scripts/build.mjs` … データを検証し、`public/` に全ページ・`sitemap.xml`・`robots.txt` を生成する。検証に失敗すると exit 1
- `scripts/build-ogp.mjs` … ページごとの OGP 画像 (1200x630 PNG) を `public/ogp/` に生成する。`assets/ogp/background.svg` (背景) の上に白いカード・タイトル・サイト名・カテゴリ名を SVG で重ね、resvg で PNG にする。タイトルの折り返し (禁則) と文字サイズの調整は自前。ヘッドレスブラウザは使わない
  - 画像のパスはページの URL から決まる: `/` → `/ogp/index.png`、`/issues/<slug>/` → `/ogp/issues/<slug>.png` (`build.mjs` の `ogImageUrl()` と同じ規則。変えるときは両方直す)
  - 課題ページの画像に入れるのは、記事があればその `h1` (「少子化とは？ 日本で何が起きているのか」)、準備中なら `data/issues.json` の `title`。`og:title` / `og:description` も同じく、記事ありなら `h1` / `lead`、準備中なら `title` / `summary`
  - `h1` は最初の「？」「。」の後ろで必ず改行し、文字サイズは 72 / 64 / 56px のどれかにそろえる。前半・後半が 1 行ずつに収まらないときは 64px 以下で折り返し、切れ目がいちばん自然になる組み方を選ぶ
  - `node scripts/build-ogp.mjs --list` で、全タイトルの文字サイズと折り返しを画像なしで確認できる。記事の `h1` や課題名を足したり変えたりしたら見ておく
- `assets/ogp/background.svg` … OGP 画像の背景 (タイトルなし、オリジナル)。写真や他者の素材・ロゴを入れない
- `assets/fonts/NotoSansJP-Bold.otf` … OGP 画像用のフォント (SIL OFL 1.1、ライセンス文は同じ場所の `OFL.txt`)。[notofonts/noto-cjk](https://github.com/notofonts/noto-cjk) の `Sans/SubsetOTF/JP/` から取得したものをそのまま置いている。CI (ubuntu-latest) には日本語フォントがないので、システムフォントには頼らない
- `public/` … 公開されるファイル。**HTML・`sitemap.xml`・`robots.txt`・`assets/styles.css`・`ogp/` は生成物で git 管理外。手で編集しない。** 手書きは `_headers`、`assets/issues-filter.js` (/issues/ の絞り込み)、favicon (`favicon.svg` `favicon.ico` `apple-touch-icon.png`) だけ
- `src/styles.css` … Tailwind の入力。クラス名は `public/` と `scripts/` から拾う
- `stg/functions/` … stg 専用の Basic 認証ミドルウェア。stg デプロイ時だけ `./functions` にコピーされる
- `.github/workflows/` … `ci.yml` (PR のビルド確認)、`deploy.yml` (デプロイ)。どちらも `npm run build` を実行する

生成される URL: `/`、`/issues/`、`/issues/<slug>/`、`/categories/<slug>/`、`/tags/<slug>/`、`/about/`、`404.html`。
ページの見た目や構成を変えるときは `scripts/build.mjs` のテンプレートを編集する。

## コマンド

```sh
npm ci               # 依存のインストール
npm run build        # ページ生成 (検証つき) → OGP 画像 → CSS ビルド
npm run build:pages  # ページ生成だけ
npm run build:ogp    # OGP 画像だけ (public/ogp/)
npm run dev          # ページ生成 → CSS を watch ビルド
npm run preview      # http://localhost:8788 でプレビュー (別ターミナルで)
```

## ブランチとデプロイ

| ブランチ | 環境 | Cloudflare Pages プロジェクト | 備考 |
| --- | --- | --- | --- |
| `develop` (default) | stg | `wakari-stg` | Basic 認証あり |
| `main` | prd | `wakari-prd` | https://wakari.jp |

- 作業ブランチは `develop` から切り、PR も `develop` に向ける
- `main` へは `develop` からのマージのみ。マージされると本番公開される
- `main` / `develop` へ直接 push・マージできるのは @okamuroshogo だけ。それ以外は @okamuroshogo の承認が必要
- エージェントは、明示的に頼まれない限り `main` / `develop` へ直接 push しない

## 書き方のルール

- コミットメッセージと PR のルールは [README.md](./README.md) に従う
- 解説記事の数字や事実には出典を付ける。出典のない内容を創作しない。`[^s1]` で `sources` を参照し、`stats` には必ず `source` を付ける (ビルドで検証される)
- 本番 (`wakari-prd`) に Functions を足さない。Basic 認証は stg だけ
- **ダークテーマは作らない。** サイトは明るいライトテーマだけにする。`dark:` のクラスや `prefers-color-scheme: dark` のスタイルを足さない
