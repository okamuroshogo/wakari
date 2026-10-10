# wakari

**日本の課題を、わかりやすく解説するサイト** — https://wakari.jp

むずかしい話を、前提知識がなくても読める形にすることを目指しています。
このサイトの内容はすべてこのリポジトリで公開されていて、**誰でも Pull Request を出せます**。
誤字の修正ひとつでも、新しい解説記事でも歓迎です。

## 参加のしかた

1. このリポジトリを **Fork** する
2. `develop` からブランチを切る (例: `content/shoshika`、`fix/typo-top`)
3. 変更してコミットする ([コミットガイドライン](#コミットガイドライン))
4. **`develop` に向けて** Pull Request を出す ([PR の出し方](#pull-request-の出し方))
5. [@okamuroshogo](https://github.com/okamuroshogo) がレビューし、承認されるとマージされます

何を書けばいいか迷ったら、まず [Issue](https://github.com/okamuroshogo/wakari/issues) で相談してください。

## 内容のルール

- **わかりやすく** — 専門用語には説明を添える。中学生でも読めるくらいが目安
- **出典を付ける** — 数字や事実には、一次情報 (官公庁の統計など) へのリンクを付ける
- **事実と意見を分ける** — 立場が分かれる話題は、複数の見方を公平に紹介する
- 他者の文章や画像を無断で転載しない

## コミットガイドライン

`<type>: <変更の要約>` の形で書きます。日本語で構いません。

| type | 使うとき |
| --- | --- |
| `content` | 解説記事の追加・更新 |
| `fix` | 誤字、事実誤り、リンク切れ、表示崩れの修正 |
| `feat` | サイトの機能・デザインの追加 |
| `docs` | README など、ドキュメントの変更 |
| `chore` | ビルド、CI、依存パッケージなどの変更 |

```
content: 少子化の解説記事を追加
fix: トップページの誤字を修正
```

- 1 コミットには 1 つの変更だけを入れる
- 要約は「何をしたか」が一目でわかるように、50 文字程度まで
- 理由の説明が必要なら、1 行空けて本文に書く
- **パスワード、API キー、個人情報などの秘匿情報を絶対にコミットしない** (このリポジトリは public です)

## Pull Request の出し方

- マージ先 (base) は **`develop`** にする (`main` には出さない)
- 1 つの PR には 1 つのテーマだけ。大きな変更は分ける
- タイトルはコミットと同じ `<type>: <要約>` の形にする
- テンプレートに沿って「何を」「なぜ」変えたかを書く
- CI (`build`) が通っていることを確認する
- レビューの指摘には、同じブランチに追加コミットして対応する (force push は避ける)

### マージの権限

- `main` / `develop` に直接 push・マージできるのは [@okamuroshogo](https://github.com/okamuroshogo) だけです
- それ以外の人の変更は、**@okamuroshogo が承認した PR だけ**がマージされます

## ブランチとデプロイ

| ブランチ | 環境 | 説明 |
| --- | --- | --- |
| `develop` (default) | stg | 確認用。Basic 認証がかかっています |
| `main` | prd | 本番。https://wakari.jp で公開されます |

`develop` にマージ → stg に反映 → @okamuroshogo が `develop` を `main` にマージ → 本番公開、という流れです。

## ローカルで動かす

Node.js 24 以上が必要です。

```sh
npm ci           # 依存のインストール
npm run build    # CSS をビルド
npm run preview  # http://localhost:8788 でプレビュー
```

編集しながら確認するときは、別のターミナルで `npm run dev` (CSS の watch ビルド) も動かしてください。

### 構成

- `public/` — 公開されるファイル (HTML など)
- `src/styles.css` — [Tailwind CSS](https://tailwindcss.com/) の入力ファイル
- `stg/functions/` — stg 専用の Basic 認証
- `.github/workflows/` — CI とデプロイ ([Cloudflare Pages](https://pages.cloudflare.com/))

AI エージェントで作業する場合は [AGENTS.md](./AGENTS.md) も読んでください。
