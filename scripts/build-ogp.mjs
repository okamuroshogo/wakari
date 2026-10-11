#!/usr/bin/env node
// wakari.jp の OGP 画像 (1200x630 PNG) の生成。
// assets/ogp/background.svg の上に、白いカード・タイトル・サイト名・カテゴリ名を SVG で重ね、
// @resvg/resvg-js で PNG にして public/ogp/ に書き出す。ヘッドレスブラウザは使わない。
// 画像のパスは scripts/build.mjs の ogImagePath() と同じ規則 (ページの URL → /ogp/<URL>.png)。
// `node scripts/build-ogp.mjs --list` は画像を書かずに、タイトルごとの文字サイズと折り返しだけを表示する。

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Resvg } from "@resvg/resvg-js";

const ROOT = join(import.meta.dirname, "..");
const DATA_DIR = join(ROOT, "data");
const CONTENT_DIR = join(ROOT, "content", "issues");
const OUT_DIR = process.env.WAKARI_OUT_DIR || join(ROOT, "public");
const OGP_DIR = join(OUT_DIR, "ogp");
const FONT_FILE = join(ROOT, "assets", "fonts", "NotoSansJP-Bold.otf");
const FONT_FAMILY = "Noto Sans JP";
const BACKGROUND_FILE = join(ROOT, "assets", "ogp", "background.svg");

const SITE_NAME = "日本の課題をわかりやすく解説";
const TOP_TITLE = "日本の課題を\nわかりやすく解説\n「ワカリJP」";
const TOP_LABEL = "wakari.jp";
// トップの画像はタイトルがサイト名なので、左下にはサイト名ではなくキャッチを入れる
const TOP_FOOTER = "63 の課題を、つながりで読む。";

// ---------------------------------------------------------------------------
// レイアウト
// ---------------------------------------------------------------------------

const W = 1200;
const H = 630;
const CARD = { x: 52, y: 52, w: 1096, h: 526, r: 28 };
const PAD_X = 68;
const TEXT_X = CARD.x + PAD_X;
const TEXT_W = CARD.w - PAD_X * 2;
const TITLE_TOP = CARD.y + 48;
const TITLE_H = 340; // タイトルを置ける高さ。この中で上下中央にそろえる
const RULE_Y = CARD.y + CARD.h - 112;
const FOOTER_Y = CARD.y + CARD.h - 56; // フッターの上下中央

// 大きい順に試し、最初に収まった文字サイズを使う
const TITLE_SIZES = [104, 96, 88, 80, 72, 64, 56, 48, 42];
const LINE_HEIGHT = 1.32;
const MAX_LINES = 4;
// 記事の h1 に使う文字サイズ。画像ごとの差が大きくならないように範囲をしぼる
const SPLIT_TITLE_SIZES = [72, 64, 56];
// 各部分が 1 行に収まらず折り返すときは、これ以下のサイズにして 1 行に入る字数を確保する
const SPLIT_TITLE_WRAPPED_MAX = 64;
// かっこの中で折り返すときの減点
const INSIDE_BRACKET_PENALTY = 40;
const OPEN_BRACKETS = new Set("「『（(［[【〈《");
const CLOSE_BRACKETS = new Set("」』）)］]】〉》");
// 漢字・かなの字面は、ベースラインから上に 0.88em、下に 0.12em
const CJK_ASCENT = 0.88;

// カテゴリごとの色相 (HSL)。背景と差し色に使う。emerald (160) を基準に、緑〜青の範囲でずらす。
const DEFAULT_HUE = 160;
const CATEGORY_HUES = {
  "population-family": 160,
  "economy-living": 172,
  "education-children": 200,
  "health-care": 186,
  "regions-infrastructure": 146,
  "climate-disaster": 128,
  "food-energy": 104,
  "technology-future": 222,
  "politics-institutions": 210,
  "world-security": 236,
};

// ---------------------------------------------------------------------------
// フォントの字幅 (折り返しの計算用に、フォントファイルの cmap / hmtx を直接読む)
// ---------------------------------------------------------------------------

function loadFontMetrics(file) {
  const buf = readFileSync(file);
  const tables = new Map();
  const numTables = buf.readUInt16BE(4);
  for (let i = 0; i < numTables; i++) {
    const at = 12 + i * 16;
    tables.set(buf.toString("latin1", at, at + 4), buf.readUInt32BE(at + 8));
  }
  for (const tag of ["head", "hhea", "hmtx", "cmap"]) {
    if (!tables.has(tag)) throw new Error(`${file}: ${tag} テーブルがありません`);
  }
  const unitsPerEm = buf.readUInt16BE(tables.get("head") + 18);
  const numHMetrics = buf.readUInt16BE(tables.get("hhea") + 34);
  const hmtx = tables.get("hmtx");

  // cmap は format 12 (全 Unicode) のサブテーブルを使う
  const cmap = tables.get("cmap");
  let groupsAt = -1;
  let numGroups = 0;
  for (let i = 0; i < buf.readUInt16BE(cmap + 2); i++) {
    const sub = cmap + buf.readUInt32BE(cmap + 4 + i * 8 + 4);
    if (buf.readUInt16BE(sub) === 12) {
      numGroups = buf.readUInt32BE(sub + 12);
      groupsAt = sub + 16;
      break;
    }
  }
  if (groupsAt < 0) throw new Error(`${file}: cmap に format 12 のサブテーブルがありません`);

  function glyphId(codePoint) {
    let lo = 0;
    let hi = numGroups - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const at = groupsAt + mid * 12;
      if (codePoint < buf.readUInt32BE(at)) hi = mid - 1;
      else if (codePoint > buf.readUInt32BE(at + 4)) lo = mid + 1;
      else return buf.readUInt32BE(at + 8) + (codePoint - buf.readUInt32BE(at));
    }
    return 0;
  }

  const missing = new Set();
  // 文字列の幅 (em 単位)。カーニングは見ないので、実際の描画より少しだけ広めに出ることがある。
  function width(text) {
    let units = 0;
    for (const ch of text) {
      const gid = glyphId(ch.codePointAt(0));
      if (gid === 0) missing.add(ch);
      units += buf.readUInt16BE(hmtx + Math.min(gid, numHMetrics - 1) * 4);
    }
    return units / unitsPerEm;
  }
  return { width, missing };
}

// ---------------------------------------------------------------------------
// 折り返し (日本語の禁則つき)
// ---------------------------------------------------------------------------

// 行頭に置かない文字 / 行末に置かない文字
const NO_LINE_START = new Set("、。，．・：；？！」』）］｝〉》】〕’”ー～…‥々ゝゞヽヾ゛゜ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮ,.!?)]}:;%％");
const NO_LINE_END = new Set("「『（［｛〈《【〔‘“([{");
// 後ろの語につく 1 文字の漢字 (再稼働、非正規、低成長 など)
const KANJI_PREFIX = new Set("再非不未無低高新旧全各超反被両総偽");
const HIRAGANA_ONLY = /^\p{sc=Hiragana}+$/u;
const HIRAGANA_END = /\p{sc=Hiragana}$/u;
const PUNCTUATION_END = /[\s・、。，．：；？！,.!?:;]$/;
const CLAUSE_END = /[、。，．]$/;
const HIRAGANA_START = /^\p{sc=Hiragana}/u;
const DIGIT_START = /^[0-9０-９]/;
const KANJI_ONLY = /^[\p{sc=Han}々]$/u;
const KANJI_END = /[\p{sc=Han}々]$/u;
const KANJI_OR_KATAKANA_START = /^[\p{sc=Han}\p{sc=Katakana}]/u;
// 「・」(U+30FB) はカタカナに数えない
const KATAKANA_END = /[\p{sc=Katakana}ー]$/u;
const KATAKANA_START = /^[\p{sc=Katakana}ー]/u;
const DIGIT_END = /[0-9０-９]$/;
// この文字の後ろは、折り返しても読みやすい
const GOOD_BREAK_AFTER = /[\s・、。，．：；？！」』）］｝〉》】〕／,.!?:;)\]}\/]$/;

const wordSegmenter = new Intl.Segmenter("ja", { granularity: "word" });
const graphemeSegmenter = new Intl.Segmenter("ja", { granularity: "grapheme" });
const firstChar = (s) => String.fromCodePoint(s.codePointAt(0));
const lastChar = (s) => [...s].at(-1);

// 禁則に反する切れ目をなくすように、前の要素へつなげる
function joinForbidden(parts, alsoJoin = () => false) {
  const out = [];
  for (const part of parts) {
    const prev = out.at(-1);
    if (prev !== undefined && (NO_LINE_START.has(firstChar(part)) || NO_LINE_END.has(lastChar(prev)) || alsoJoin(part, prev))) {
      out[out.length - 1] = prev + part;
    } else {
      out.push(part);
    }
  }
  return out;
}

// 文字列を「途中で折り返さないかたまり」に分ける。
// Intl.Segmenter の単語分割をもとに、読みにくい切れ目 (カタカナ語の途中、助詞・送りがなの前、
// 「化」「力」のような 1 文字の接尾語の前、「再」「非」のような接頭語の後ろ) をつなげる。
function unbreakableUnits(text) {
  const words = [...wordSegmenter.segment(text)].map((s) => s.segment);
  for (let i = 0; i < words.length - 1; i++) {
    if (KANJI_PREFIX.has(words[i]) && KANJI_OR_KATAKANA_START.test(words[i + 1])) {
      words.splice(i, 2, words[i] + words[i + 1]);
    }
  }
  return joinForbidden(
    words,
    (part, prev) =>
      (KATAKANA_START.test(part) && KATAKANA_END.test(prev)) ||
      (part.length <= 2 && HIRAGANA_ONLY.test(part) && prev.trim() !== "" && !PUNCTUATION_END.test(prev)) ||
      (KANJI_ONLY.test(part) && (KANJI_END.test(prev) || DIGIT_END.test(prev))),
  );
}

// unit と next の間で折り返すときの減点。区切り記号の後ろ < 助詞の後ろ < 語と語の間。
// ひらがなで始まる行 (「どれ / くらい」「化学物質 / による」) は、語や文節の途中になりやすいので強く避ける。
// 数字の前 (「3.6人に / 1人」) は、数のまとまりが分かれるので少し避ける。
function breakPenalty(unit, next = "") {
  // 読点・句点の後ろは、行の長さが少し不ぞろいになっても優先する
  if (CLAUSE_END.test(unit)) return -6;
  if (GOOD_BREAK_AFTER.test(unit)) return 0;
  if (HIRAGANA_START.test(next)) return 40;
  if (!HIRAGANA_END.test(unit)) return 16;
  return DIGIT_START.test(next) ? 16 : 3;
}

// units を maxEm (em 単位の幅) に収まる最少の行数に分ける。
// 同じ行数の分け方のうち、切れ目の減点が小さく、各行の長さがそろうものを選ぶ。
function breakLines(units, maxEm, width) {
  const n = units.length;
  if (n === 0) return { lines: [], penalty: 0 };
  const lineAt = (from, to) => units.slice(from, to).join("").trim();

  // 前から詰めていくと、最少の行数がわかる
  let count = 1;
  for (let from = 0, to = 1; to <= n; to++) {
    if (to - from > 1 && width(lineAt(from, to)) > maxEm) {
      count++;
      from = to - 1;
    }
  }

  // best[i] = units[0..i) を k 行に分けたときの最小コスト
  const mean = width(lineAt(0, n)) / count;
  // depth[i] = units[0..i) の後ろで、まだ閉じていないかっこの数。かっこの中では折り返しにくくする
  const depth = [0];
  for (const unit of units) {
    const opened = [...unit].filter((ch) => OPEN_BRACKETS.has(ch)).length;
    const closed = [...unit].filter((ch) => CLOSE_BRACKETS.has(ch)).length;
    depth.push(Math.max(0, depth.at(-1) + opened - closed));
  }
  const penaltyAt = (to) => (to < n ? breakPenalty(units[to - 1], units[to]) + (depth[to] > 0 ? INSIDE_BRACKET_PENALTY : 0) : 0);
  let best = Array.from({ length: n + 1 }, (_, i) => (i === 0 ? { cost: 0, penalty: 0, lines: [] } : null));
  for (let k = 1; k <= count; k++) {
    const next = Array.from({ length: n + 1 }, () => null);
    for (let to = 1; to <= n; to++) {
      for (let from = to - 1; from >= 0; from--) {
        const line = lineAt(from, to);
        const w = width(line);
        if (w > maxEm && to - from > 1) break;
        if (!best[from]) continue;
        const penalty = penaltyAt(to);
        const cost = best[from].cost + (w - mean) ** 2 + penalty;
        if (!next[to] || cost < next[to].cost) {
          next[to] = { cost, penalty: best[from].penalty + penalty, lines: [...best[from].lines, line] };
        }
      }
    }
    best = next;
  }
  return { lines: best[n].lines.filter((line) => line !== ""), penalty: best[n].penalty };
}

// maxEm に収まるように折り返す。"\n" は必ず改行する。
// forced は、1 行に入らない長い語を文字単位で切ったかどうか (禁則は守る)。
// penalty は、折り返した位置の減点の合計 (小さいほど読みやすい切れ目)。
function wrapText(text, maxEm, width) {
  const lines = [];
  let forced = false;
  let penalty = 0;
  for (const paragraph of text.split("\n")) {
    const units = unbreakableUnits(paragraph).flatMap((unit) => {
      if (width(unit.trim()) <= maxEm) return [unit];
      forced = true;
      return joinForbidden([...graphemeSegmenter.segment(unit)].map((s) => s.segment));
    });
    const broken = breakLines(units, maxEm, width);
    lines.push(...broken.lines);
    penalty += broken.penalty;
  }
  return { lines, forced, penalty };
}

// タイトルの文字サイズと行を決める。大きいサイズから試し、幅と高さの両方に収まったものを返す。
// まず語の途中で切らずに済むサイズを探し、なければ語の途中で切ることを許す。
function fitTitle(title, width, article = false) {
  const fits = (size, lines) =>
    lines.length <= MAX_LINES && lines.length * size * LINE_HEIGHT <= TITLE_H && lines.every((l) => width(l) * size <= TEXT_W);
  // 記事の h1 (article) は、文字サイズを SPLIT_TITLE_SIZES にそろえる。
  // まず、分けた各部分が 1 行に収まるサイズを探す。なければ折り返すが、いちばん大きいサイズではなく、
  // 切れ目がいちばん自然になるサイズを選ぶ (大きさを優先すると「どれ / くらい」のように読みにくい位置で折れる)。
  const paragraphs = title.split("\n").length;
  if (article) {
    const candidates = SPLIT_TITLE_SIZES.map((size) => ({ size, ...wrapText(title, TEXT_W / size, width) })).filter(
      (c) => !c.forced && fits(c.size, c.lines),
    );
    const unwrapped = candidates.find((c) => c.lines.length === paragraphs);
    if (unwrapped) return { size: unwrapped.size, lines: unwrapped.lines, truncated: false };
    const wrapped = candidates
      .filter((c) => c.size <= SPLIT_TITLE_WRAPPED_MAX)
      .sort((a, b) => a.lines.length - b.lines.length || a.penalty - b.penalty || b.size - a.size)[0];
    if (wrapped) return { size: wrapped.size, lines: wrapped.lines, truncated: false };
  }
  for (const allowForced of [false, true]) {
    for (const size of TITLE_SIZES) {
      const { lines, forced } = wrapText(title, TEXT_W / size, width);
      if ((allowForced || !forced) && fits(size, lines)) return { size, lines, truncated: false };
    }
  }
  // どのサイズでも収まらない長さのときは、最小サイズで入るところまで出して「…」で切る
  const size = TITLE_SIZES.at(-1);
  const lines = wrapText(title, TEXT_W / size, width).lines.slice(0, MAX_LINES);
  let last = lines.at(-1);
  while (last !== "" && width(`${last}…`) * size > TEXT_W) last = [...last].slice(0, -1).join("");
  lines[lines.length - 1] = `${last}…`;
  return { size, lines, truncated: true };
}

// ---------------------------------------------------------------------------
// SVG の組み立て
// ---------------------------------------------------------------------------

function esc(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function hsl(h, s, l) {
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const channel = (n) => {
    const k = (n + h / 30) % 12;
    const v = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(v * 255).toString(16).padStart(2, "0");
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

// background.svg の <svg> の中身だけを取り出して、合成用の SVG に埋め込む
function loadBackground(file) {
  const svg = readFileSync(file, "utf8").replace(/<!--[\s\S]*?-->/g, "");
  const m = /<svg\b[^>]*>([\s\S]*)<\/svg>\s*$/.exec(svg);
  if (!m) throw new Error(`${file}: <svg> が見つかりません`);
  return m[1];
}

function composeSvg({ title, label, hue = DEFAULT_HUE, accentLastLine = false, article = false, footer = SITE_NAME }, background, width) {
  const fitted = fitTitle(title, width, article);
  const { size, lines } = fitted;
  const lineH = size * LINE_HEIGHT;
  const top = TITLE_TOP + (TITLE_H - lines.length * lineH) / 2;
  const ink = "#1c1917"; // stone-900
  const accent = hsl(hue, 88, 25);
  const titleText = lines
    .map((line, i) => {
      const y = top + i * lineH + (lineH - size) / 2 + size * CJK_ASCENT;
      const fill = accentLastLine && i === lines.length - 1 ? accent : ink;
      // 「 で始まる行は、かっこの左の余白 (約半角分) だけ左に出して、ほかの行と字の左端をそろえる
      const x = OPEN_BRACKETS.has(line[0]) && line[0] !== "(" && line[0] !== "[" ? TEXT_X - size * 0.5 : TEXT_X;
      return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-size="${size}" fill="${fill}">${esc(line)}</text>`;
    })
    .join("\n    ");

  // フッター: 左にサイト名、右にカテゴリ名など (角丸のラベル)
  const nameSize = 34;
  const labelSize = 26;
  const labelPadX = 24;
  const labelH = 52;
  const labelW = width(label) * labelSize + labelPadX * 2;
  const labelX = CARD.x + CARD.w - PAD_X - labelW;
  const mark = { x: TEXT_X + 17, y: FOOTER_Y };

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT_FAMILY}" font-weight="700">
  <g>${background}</g>
  ${hue === DEFAULT_HUE ? "" : `<rect width="${W}" height="${H}" fill="${hsl(hue, 85, 40)}" style="mix-blend-mode:hue" />`}
  <rect x="${CARD.x}" y="${CARD.y + 10}" width="${CARD.w}" height="${CARD.h}" rx="${CARD.r}" fill="#0c0a09" fill-opacity="0.16" />
  <rect x="${CARD.x}" y="${CARD.y}" width="${CARD.w}" height="${CARD.h}" rx="${CARD.r}" fill="#ffffff" />
  <g>
    ${titleText}
  </g>
  <rect x="${TEXT_X}" y="${RULE_Y}" width="${TEXT_W}" height="2" fill="#e7e5e4" />
  <g>
    <path d="M${mark.x - 9} ${mark.y + 8} L${mark.x + 9} ${mark.y - 8}" stroke="${accent}" stroke-width="5" stroke-linecap="round" />
    <circle cx="${mark.x - 9}" cy="${mark.y + 8}" r="8" fill="${accent}" />
    <circle cx="${mark.x + 9}" cy="${mark.y - 8}" r="8" fill="${hsl(hue, 70, 45)}" />
    <text x="${TEXT_X + 46}" y="${(FOOTER_Y + nameSize * 0.33).toFixed(1)}" font-size="${nameSize}" fill="${ink}">${esc(footer)}</text>
  </g>
  <g>
    <rect x="${labelX.toFixed(1)}" y="${FOOTER_Y - labelH / 2}" width="${labelW.toFixed(1)}" height="${labelH}" rx="${labelH / 2}" fill="${hsl(hue, 70, 94)}" />
    <text x="${(labelX + labelPadX).toFixed(1)}" y="${(FOOTER_Y + labelSize * (CJK_ASCENT - 0.5)).toFixed(1)}" font-size="${labelSize}" fill="${accent}">${esc(label)}</text>
  </g>
</svg>`;
  return { svg, ...fitted };
}

// ---------------------------------------------------------------------------
// 生成
// ---------------------------------------------------------------------------

function readJson(name) {
  const data = JSON.parse(readFileSync(join(DATA_DIR, name), "utf8"));
  if (!Array.isArray(data)) throw new Error(`data/${name}: 配列にしてください`);
  return data;
}

// 課題ページの画像に入れるタイトル。記事があればその h1 (article: true)、なければ課題名。
// h1 は「少子化とは？ 日本で何が起きているのか」のように前半と後半に分かれているので、最初の文末で必ず改行する。
function issueTitle(issue) {
  const file = join(CONTENT_DIR, `${issue.slug}.json`);
  if (!existsSync(file)) return { title: issue.title };
  const h1 = JSON.parse(readFileSync(file, "utf8")).h1;
  if (typeof h1 !== "string" || h1.trim() === "") return { title: issue.title };
  return { title: h1.trim().replace(/([？?。！!])[ \u3000]*(?=.)/u, "$1\n"), article: true };
}

function main() {
  const started = performance.now();
  const issues = readJson("issues.json");
  const categories = readJson("categories.json");
  const tags = readJson("tags.json");
  const categoryBySlug = new Map(categories.map((c) => [c.slug, c]));

  // file はページの URL から決まる: "/" → index.png、"/issues/<slug>/" → issues/<slug>.png
  const targets = [
    { file: "index.png", title: TOP_TITLE, label: TOP_LABEL, accentLastLine: true, footer: TOP_FOOTER },
    { file: "issues.png", title: "課題一覧", label: `${issues.length} の課題` },
    { file: "about.png", title: "このサイトについて", label: "編集方針と参加方法" },
    ...issues.map((issue) => ({
      file: `issues/${issue.slug}.png`,
      ...issueTitle(issue),
      label: categoryBySlug.get(issue.category)?.name ?? "課題",
      hue: CATEGORY_HUES[issue.category],
    })),
    ...categories.map((c) => ({ file: `categories/${c.slug}.png`, title: c.name, label: "カテゴリ", hue: CATEGORY_HUES[c.slug] })),
    ...tags.map((t) => ({ file: `tags/${t.slug}.png`, title: t.name, label: "横断タグ" })),
  ];

  const metrics = loadFontMetrics(FONT_FILE);
  const background = loadBackground(BACKGROUND_FILE);
  const resvgOptions = {
    font: { fontFiles: [FONT_FILE], loadSystemFonts: false, defaultFontFamily: FONT_FAMILY },
    fitTo: { mode: "width", value: W },
  };

  if (process.argv.includes("--list")) {
    for (const target of targets) {
      const { size, lines } = fitTitle(target.title, metrics.width, target.article);
      console.log(`${target.file}\t${size}px\t${lines.join(" / ")}\t[${target.label}]`);
    }
    return;
  }

  const warnings = [];
  const rendered = targets.map((target) => {
    const { svg, truncated } = composeSvg(target, background, metrics.width);
    if (truncated) warnings.push(`${target.file}: タイトルが長すぎるため「…」で切りました (${target.title.replaceAll("\n", "")})`);
    return { file: target.file, png: new Resvg(svg, resvgOptions).render().asPng() };
  });
  if (metrics.missing.size > 0) {
    warnings.push(`フォント (${FONT_FAMILY}) にない文字があり、画像では表示されません: ${[...metrics.missing].join(" ")}`);
  }

  // 前回の生成物を消してから書く (消えた課題の画像が残らないように)
  rmSync(OGP_DIR, { recursive: true, force: true });
  let bytes = 0;
  for (const { file, png } of rendered) {
    const path = join(OGP_DIR, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, png);
    bytes += png.length;
  }

  // build:pages の後に実行されたときは、各ページの og:image が指す画像がそろっているか確かめる
  const errors = [];
  const htmlFiles = existsSync(OUT_DIR) ? readdirSync(OUT_DIR, { recursive: true }).filter((f) => f.endsWith(".html")) : [];
  for (const file of htmlFiles) {
    const m = /<meta property="og:image" content="https?:\/\/[^/"]+(\/[^"]*)"/.exec(readFileSync(join(OUT_DIR, file), "utf8"));
    if (m && !existsSync(join(OUT_DIR, decodeURI(m[1])))) errors.push(`public/${file}: og:image の ${m[1]} が生成されていません`);
  }

  for (const w of warnings) console.warn(`warning: ${w}`);
  if (errors.length > 0) {
    console.error(`\nOGP 画像のエラー (${errors.length} 件)\n`);
    for (const e of errors) console.error(`  ✗ ${e}`);
    console.error("");
    process.exit(1);
  }
  console.log(
    `wakari: OGP 画像を ${rendered.length} 枚生成しました ` +
      `(計 ${(bytes / 1024 / 1024).toFixed(1)} MB、${((performance.now() - started) / 1000).toFixed(1)} 秒)`,
  );
}

main();
