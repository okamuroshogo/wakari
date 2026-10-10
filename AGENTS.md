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

- Cloudflare Pages の静的サイト + Tailwind CSS v4 (`@tailwindcss/cli`)
- `public/` … 公開されるファイル (HTML など)。そのまま配信される
- `src/styles.css` … Tailwind の入力。ビルドで `public/assets/styles.css` を生成 (git 管理外)
- `stg/functions/` … stg 専用の Basic 認証ミドルウェア。stg デプロイ時だけ `./functions` にコピーされる
- `.github/workflows/` … `ci.yml` (PR のビルド確認)、`deploy.yml` (デプロイ)

## コマンド

```sh
npm ci           # 依存のインストール
npm run build    # CSS をビルド
npm run dev      # CSS を watch ビルド
npm run preview  # http://localhost:8788 でプレビュー (別ターミナルで)
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
- 解説記事の数字や事実には出典を付ける。出典のない内容を創作しない
- 本番 (`wakari-prd`) に Functions を足さない。Basic 認証は stg だけ
