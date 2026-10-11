# wakari

**日本の課題を、わかりやすく解説するサイト** — https://wakari.jp

むずかしい話を、前提知識がなくても読める形にすることを目指しています。
このサイトの内容はすべてこのリポジトリで公開されていて、**誰でも Pull Request を出せます**。
誤字の修正ひとつでも、新しい解説記事でも歓迎です。

## 参加のしかた

1. このリポジトリを **Fork** する
2. `develop` からブランチを切る (例: `content/low-birthrate`、`fix/typo-top`)
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

## 記事を追加する

課題は 63 件あり、解説記事がまだない課題は「準備中」ページとして公開されています。
記事は **`content/issues/<slug>.json` を 1 つ足すだけ**で追加できます (HTML は書きません)。

1. [`data/issues.json`](./data/issues.json) で、書きたい課題の `id` と `slug` を確認する (例: `P001` / `low-birthrate`)
2. `content/issues/<slug>.json` を作る。すでにある記事 (例: [`content/issues/low-birthrate.json`](./content/issues/low-birthrate.json)) をコピーして書き換えるのが簡単です
3. `npm run build` を実行する。出典の付け忘れなどがあると、どこが問題かを表示して失敗します
4. `npm run preview` で `http://localhost:8788/issues/<slug>/` を開いて確認する

### 記事ファイルの形

```jsonc
{
  "id": "P001",                  // data/issues.json の id と同じにする
  "h1": "少子化とは？ 日本で何が起きているのか",
  "lead": "2〜3 文の導入。",
  "updated": "2026-10-11",       // データを確認した日
  "stats": [                     // 最重要の数字 1〜3 個。source は必須
    {"value": "…", "unit": "人", "label": "出生数", "period": "2025年 (確定数)", "source": "s1"}
  ],
  "flow": ["原因", "この課題", "波及先"],   // 因果の流れ (省略可)
  "now": ["段落…[^s1]"],         // いま何が起きている？
  "numbers": ["段落…"],          // 数字で見る
  "why": ["段落…"],              // なぜ起きる？
  "connections": [{"id": "P004", "note": "つながりの一言説明。"}],
  "misconceptions": [{"myth": "よくある誤解", "fact": "実際は…[^s2]"}],
  "options": [{"name": "選択肢", "pros": "期待できること", "cons": "負担・副作用"}],   // 省略可
  "indicators": [{"name": "指標名", "desc": "いつ、どこで公表されるか。", "source": "s1"}],
  "sources": [                   // 1 件以上必須
    {"id": "s1", "org": "厚生労働省", "title": "資料名", "url": "https://…",
     "published": "2026-09", "checked": "2026-10-11"}
  ]
}
```

- 本文 (`now` / `numbers` / `why`) は「ブロック」の配列です。文字列は段落になります。ほかに次の 3 種類が使えます
  - `{"type": "list", "items": ["…"]}` — 箇条書き
  - `{"type": "table", "caption": "…", "head": ["年", "出生数"], "rows": [["2023", "…"]], "source": "s1"}` — 表
  - `{"type": "bars", "caption": "…", "unit": "万人", "items": [{"label": "2015年", "value": 100.6}], "source": "s1"}` — 横棒グラフ (`value` は数値)
- 文字列はプレーンテキストです。HTML タグは書けません。使える記法は、出典の `[^s1]` (`sources` の `id`) と `**太字**` だけです
- 数字には「いつの数字か」と「確定値 / 概数 / 推計」の別を書き、一次資料 (官公庁など) の出典を付けてください

### ビルド時にチェックされること

次のどれかに当てはまると `npm run build` (CI も同じ) が失敗します。

- `id` が `data/issues.json` と一致しない、ファイル名に対応する `slug` がない
- `sources` が 1 件もない、本文の `[^sX]` が `sources` にない
- `stats` に `source` がない、表・グラフ・指標の `source` が `sources` にない
- `connections` の `id` が存在しない
- `data/` の `id`・`slug` の重複、`related`・`category`・`tags` の参照切れ

## ローカルで動かす

Node.js 24 以上が必要です。

```sh
npm ci           # 依存のインストール
npm run build    # ページ (HTML) を生成してから CSS をビルド
npm run preview  # http://localhost:8788 でプレビュー
```

編集しながら確認するときは、別のターミナルで `npm run dev` (CSS の watch ビルド) も動かしてください。
`data/`・`content/`・`scripts/` を変えたときは `npm run build:pages` でページを作り直します。

### 構成

- `data/` — 課題 (`issues.json`)、カテゴリ (`categories.json`)、横断タグ (`tags.json`) の一覧
- `content/issues/<slug>.json` — 課題ごとの解説記事。ファイルがない課題は「準備中」ページになる
- `scripts/build.mjs` — `data/` と `content/` を検証して、`public/` に HTML・`sitemap.xml`・`robots.txt` を生成する
- `src/styles.css` — [Tailwind CSS](https://tailwindcss.com/) の入力ファイル
- `public/` — 公開されるファイル。HTML は生成物なので git 管理外 (**手で編集しない**)。手で置くのは `_headers` と `assets/issues-filter.js` だけ
- `stg/functions/` — stg 専用の Basic 認証
- `.github/workflows/` — CI とデプロイ ([Cloudflare Pages](https://pages.cloudflare.com/))

ページのデザインや構成を変えたいときは、HTML ではなく `scripts/build.mjs` を編集します。

AI エージェントで作業する場合は [AGENTS.md](./AGENTS.md) も読んでください。
