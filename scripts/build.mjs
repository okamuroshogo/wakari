#!/usr/bin/env node
// wakari.jp の静的ページ生成。
// data/*.json と content/issues/*.json を読み、検証してから public/ に HTML を書き出す。
// 依存パッケージなし (Node.js 24 以上)。検証に失敗したら何も書かずに exit 1 する。

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const DATA_DIR = join(ROOT, "data");
// テスト用に上書きできる (通常は指定しない)
const CONTENT_DIR = process.env.WAKARI_CONTENT_DIR || join(ROOT, "content", "issues");
const OUT_DIR = process.env.WAKARI_OUT_DIR || join(ROOT, "public");

const SITE = {
  name: "日本の課題をわかりやすく解説",
  origin: "https://wakari.jp",
  tagline: "63 の課題を、つながりで読む。",
  claim: "日本の問題は、ひとつずつ起きているわけではありません。つながっています。",
  description:
    "このサイトは、日本の課題を公的な統計をもとに、原因とほかの課題とのつながりまでわかりやすく解説するオープンなサイトです。",
  repo: "https://github.com/okamuroshogo/wakari",
  operator: { name: "岡室庄悟", url: "https://okamu.ro" },
};
// OGP 画像の大きさ。画像そのものは scripts/build-ogp.mjs が public/ogp/ に生成する。
const OG_IMAGE = { width: 1200, height: 630 };
const CONTRIBUTE_URL = `${SITE.repo}#${encodeURIComponent("記事を追加する")}`;

// トップページの「主因果の流れ」。各ステップから該当する課題ページへリンクする。
const MAIN_CHAIN = [
  { label: "人口が減る", links: [{ id: "P003" }, { id: "P001" }] },
  { label: "働く人が減る", links: [{ id: "P004" }] },
  { label: "支える人が足りない", links: [{ id: "P015" }] },
  {
    label: "地域・医療・交通・財政が難しくなる",
    links: [
      { id: "P006", text: "地域" },
      { id: "P026", text: "医療" },
      { id: "P032", text: "交通" },
      { id: "P012", text: "財政" },
    ],
  },
];

// ---------------------------------------------------------------------------
// 読み込み
// ---------------------------------------------------------------------------

const errors = [];
const warnings = [];

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    errors.push(`${rel(path)}: JSON として読めません (${e.message})`);
    return null;
  }
}

function rel(path) {
  return path.startsWith(ROOT) ? path.slice(ROOT.length + 1) : path;
}

const issues = readJson(join(DATA_DIR, "issues.json")) ?? [];
const categories = readJson(join(DATA_DIR, "categories.json")) ?? [];
const tags = readJson(join(DATA_DIR, "tags.json")) ?? [];

const articles = new Map(); // slug -> 記事
const articleFiles = existsSync(CONTENT_DIR)
  ? readdirSync(CONTENT_DIR).filter((f) => f.endsWith(".json")).sort()
  : [];
for (const file of articleFiles) {
  const article = readJson(join(CONTENT_DIR, file));
  if (article) articles.set(file.replace(/\.json$/, ""), article);
}

const issueById = new Map(issues.map((i) => [i.id, i]));
const issueBySlug = new Map(issues.map((i) => [i.slug, i]));
const categoryBySlug = new Map(categories.map((c) => [c.slug, c]));
const tagBySlug = new Map(tags.map((t) => [t.slug, t]));

// ---------------------------------------------------------------------------
// 検証
// ---------------------------------------------------------------------------

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SOURCE_ID_RE = /^[A-Za-z0-9_-]+$/;
const CITE_RE = /\[\^([^\]]*)\]/g;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function findDuplicates(values) {
  const seen = new Set();
  const dup = new Set();
  for (const v of values) (seen.has(v) ? dup : seen).add(v);
  return [...dup];
}

function isText(v) {
  return typeof v === "string" && v.trim() !== "";
}

function validateData() {
  for (const [name, list, key] of [
    ["data/issues.json", issues, "id"],
    ["data/issues.json", issues, "slug"],
    ["data/categories.json", categories, "slug"],
    ["data/tags.json", tags, "slug"],
  ]) {
    for (const dup of findDuplicates(list.map((x) => x[key]))) {
      errors.push(`${name}: ${key} "${dup}" が重複しています`);
    }
  }
  for (const item of [...issues, ...categories, ...tags]) {
    if (!SLUG_RE.test(item.slug ?? "")) {
      errors.push(`data: slug "${item.slug}" は半角小文字・数字・ハイフンで書いてください`);
    }
  }
  for (const issue of issues) {
    const at = `data/issues.json ${issue.id}`;
    for (const key of ["id", "slug", "title", "summary", "category"]) {
      if (!isText(issue[key])) errors.push(`${at}: ${key} がありません`);
    }
    if (!categoryBySlug.has(issue.category)) {
      errors.push(`${at}: category "${issue.category}" が data/categories.json にありません`);
    }
    for (const tag of issue.tags ?? []) {
      if (!tagBySlug.has(tag)) errors.push(`${at}: tag "${tag}" が data/tags.json にありません`);
    }
    for (const id of issue.related ?? []) {
      if (!issueById.has(id)) errors.push(`${at}: related "${id}" という課題はありません`);
      if (id === issue.id) errors.push(`${at}: related に自分自身が入っています`);
    }
  }
  for (const step of MAIN_CHAIN) {
    for (const link of step.links) {
      if (!issueById.has(link.id)) {
        errors.push(`scripts/build.mjs: MAIN_CHAIN の "${link.id}" という課題はありません`);
      }
    }
  }
}

// 記事の中の文字列をすべてたどる (sources の中は除く)
function walkStrings(value, visit) {
  if (typeof value === "string") visit(value);
  else if (Array.isArray(value)) value.forEach((v) => walkStrings(v, visit));
  else if (value && typeof value === "object") Object.values(value).forEach((v) => walkStrings(v, visit));
}

function validateBlocks(blocks, at, sourceIds) {
  if (!Array.isArray(blocks) || blocks.length === 0) {
    errors.push(`${at}: 1 つ以上のブロックが必要です`);
    return;
  }
  blocks.forEach((block, i) => {
    const where = `${at}[${i}]`;
    if (typeof block === "string") return;
    if (!block || typeof block !== "object") return errors.push(`${where}: 文字列かオブジェクトにしてください`);
    if (block.source !== undefined && !sourceIds.has(block.source)) {
      errors.push(`${where}: source "${block.source}" が sources にありません`);
    }
    if (block.type === "list") {
      if (!Array.isArray(block.items) || block.items.length === 0) errors.push(`${where}: list の items がありません`);
    } else if (block.type === "table") {
      if (!Array.isArray(block.head) || !Array.isArray(block.rows)) {
        errors.push(`${where}: table には head と rows が必要です`);
      } else if (block.rows.some((r) => !Array.isArray(r) || r.length !== block.head.length)) {
        errors.push(`${where}: table の各行の列数を head (${block.head.length} 列) にそろえてください`);
      }
    } else if (block.type === "bars") {
      if (!Array.isArray(block.items) || block.items.length === 0) {
        errors.push(`${where}: bars の items がありません`);
      } else if (block.items.some((it) => !isText(it?.label) || typeof it.value !== "number" || !Number.isFinite(it.value))) {
        errors.push(`${where}: bars の items は {label, value(数値)} にしてください`);
      }
    } else {
      errors.push(`${where}: type "${block.type}" は使えません (list / table / bars)`);
    }
  });
}

function validateArticle(slug, article) {
  const at = `content/issues/${slug}.json`;
  const issue = issueBySlug.get(slug);
  if (!issue) {
    errors.push(`${at}: ファイル名に対応する slug が data/issues.json にありません`);
    return;
  }
  if (article === null || typeof article !== "object" || Array.isArray(article)) {
    errors.push(`${at}: オブジェクトにしてください`);
    return;
  }
  if (article.id !== issue.id) {
    errors.push(`${at}: id "${article.id}" が data/issues.json の id "${issue.id}" と一致しません`);
  }
  for (const key of ["h1", "lead"]) {
    if (!isText(article[key])) errors.push(`${at}: ${key} がありません`);
  }
  if (!DATE_RE.test(article.updated ?? "")) errors.push(`${at}: updated は YYYY-MM-DD で書いてください`);

  // sources
  const sources = Array.isArray(article.sources) ? article.sources : [];
  if (sources.length === 0) errors.push(`${at}: sources が 1 件もありません`);
  const sourceIds = new Set();
  sources.forEach((s, i) => {
    const where = `${at} sources[${i}]`;
    if (!SOURCE_ID_RE.test(s?.id ?? "")) return errors.push(`${where}: id がありません (半角英数字で書く)`);
    if (sourceIds.has(s.id)) errors.push(`${where}: id "${s.id}" が重複しています`);
    sourceIds.add(s.id);
    for (const key of ["org", "title", "url"]) {
      if (!isText(s[key])) errors.push(`${where}: ${key} がありません`);
    }
    if (isText(s.url) && !/^https?:\/\/\S+$/.test(s.url)) errors.push(`${where}: url は http(s):// で始めてください`);
  });

  // 本文の [^sX]
  const { sources: _ignored, ...body } = article;
  walkStrings(body, (text) => {
    for (const [, id] of text.matchAll(CITE_RE)) {
      if (!sourceIds.has(id)) errors.push(`${at}: 本文の [^${id}] が sources にありません`);
    }
  });

  // stats
  const stats = article.stats;
  if (!Array.isArray(stats) || stats.length < 1 || stats.length > 3) {
    errors.push(`${at}: stats は 1〜3 個にしてください`);
  }
  (Array.isArray(stats) ? stats : []).forEach((s, i) => {
    const where = `${at} stats[${i}]`;
    if (!isText(String(s?.value ?? ""))) errors.push(`${where}: value がありません`);
    if (!isText(s?.label)) errors.push(`${where}: label がありません`);
    if (!isText(s?.source)) errors.push(`${where}: source がありません`);
    else if (!sourceIds.has(s.source)) errors.push(`${where}: source "${s.source}" が sources にありません`);
  });

  if (article.flow !== undefined) {
    if (!Array.isArray(article.flow) || article.flow.length < 2 || !article.flow.every(isText)) {
      errors.push(`${at}: flow は文字列の配列 (3〜5 個) にしてください`);
    }
  }
  for (const key of ["now", "numbers", "why"]) validateBlocks(article[key], `${at} ${key}`, sourceIds);

  // connections
  const connections = article.connections ?? [];
  if (!Array.isArray(connections)) errors.push(`${at}: connections は配列にしてください`);
  else {
    for (const dup of findDuplicates(connections.map((c) => c?.id))) {
      errors.push(`${at}: connections の id "${dup}" が重複しています`);
    }
    for (const c of connections) {
      if (!issueById.has(c?.id)) errors.push(`${at}: connections の "${c?.id}" という課題はありません`);
      else if (c.id === issue.id) errors.push(`${at}: connections に自分自身が入っています`);
      else if (!(issue.related ?? []).includes(c.id)) {
        warnings.push(`${at}: connections の ${c.id} は data/issues.json の related に入っていません`);
      }
    }
  }

  // 省略できる / できない配列
  const shapes = [
    ["misconceptions", ["myth", "fact"], true],
    ["options", ["name", "pros", "cons"], false],
    ["indicators", ["name", "desc"], true],
  ];
  for (const [key, fields, required] of shapes) {
    const list = article[key];
    if (list === undefined && !required) continue;
    if (!Array.isArray(list) || (required && list.length === 0)) {
      errors.push(`${at}: ${key} は${required ? " 1 件以上の" : ""}配列にしてください`);
      continue;
    }
    list.forEach((item, i) => {
      for (const f of fields) if (!isText(item?.[f])) errors.push(`${at} ${key}[${i}]: ${f} がありません`);
      if (item?.source !== undefined && !sourceIds.has(item.source)) {
        errors.push(`${at} ${key}[${i}]: source "${item.source}" が sources にありません`);
      }
    });
  }
}

// data/ が壊れていると記事の検証結果が当てにならないので、その場合は data/ のエラーだけ出す
const dataFiles = [issues, categories, tags].every((list) => Array.isArray(list) && list.length > 0);
if (!dataFiles) errors.push("data/: issues.json / categories.json / tags.json は 1 件以上の配列にしてください");
const errorsBeforeData = errors.length;
if (dataFiles) validateData();
if (dataFiles && errors.length === errorsBeforeData) {
  for (const [slug, article] of articles) validateArticle(slug, article);
}

for (const w of warnings) console.warn(`warning: ${w}`);
if (errors.length > 0) {
  console.error(`\n検証エラー (${errors.length} 件)。ページは生成していません。\n`);
  for (const e of errors) console.error(`  ✗ ${e}`);
  console.error("");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 描画の部品
// ---------------------------------------------------------------------------

function esc(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// 記法 ([^s1] と **太字**) を取り除いた素の文字列。title や meta 用。
function plain(text) {
  return String(text).replace(CITE_RE, "").replace(/\*\*(.+?)\*\*/g, "$1").replace(/\s+/g, " ").trim();
}

function truncate(text, max = 120) {
  const t = plain(text);
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

function formatDate(value) {
  const m = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/.exec(String(value ?? ""));
  if (!m) return String(value ?? "");
  return `${m[1]}年${m[2] ? `${Number(m[2])}月` : ""}${m[3] ? `${Number(m[3])}日` : ""}`;
}

const formatNumber = (n) => n.toLocaleString("ja-JP", { maximumFractionDigits: 10 });

const issueUrl = (issue) => `/issues/${issue.slug}/`;
const categoryUrl = (category) => `/categories/${category.slug}/`;
const tagUrl = (tag) => `/tags/${tag.slug}/`;
const hasArticle = (issue) => articles.has(issue.slug);
// ページの URL から OGP 画像の絶対 URL を決める: "/" → /ogp/index.png、"/issues/<slug>/" → /ogp/issues/<slug>.png
// (scripts/build-ogp.mjs が同じ規則でファイルを書き出す)
const ogImageUrl = (path) => `${SITE.origin}/ogp${path.replace(/\/$/, "") || "/index"}.png`;

const C = {
  container: "mx-auto w-full max-w-5xl px-5 sm:px-8",
  prose: "mx-auto w-full max-w-3xl px-5 sm:px-8",
  eyebrow: "text-sm font-medium text-emerald-700",
  muted: "text-stone-600",
  link: "underline decoration-stone-300 underline-offset-4 hover:decoration-emerald-600",
  card: "rounded-2xl border border-stone-200 bg-white",
  cardHover:
    "transition-colors hover:border-emerald-600 focus-within:border-emerald-600",
  chip: "inline-flex items-center gap-1.5 rounded-full border border-stone-300 bg-white px-3.5 py-1.5 text-sm text-stone-700 hover:border-emerald-600 hover:text-emerald-800",
  chipActive:
    "aria-selected:border-stone-900 aria-selected:bg-stone-900 aria-selected:text-white aria-pressed:border-emerald-700 aria-pressed:bg-emerald-700 aria-pressed:text-white",
  h2: "text-2xl leading-snug font-bold tracking-tight",
  sectionTop: "border-t border-stone-200",
  buttonPrimary:
    "inline-block rounded-full bg-stone-900 px-6 py-3 text-sm font-medium text-white hover:bg-stone-700",
  buttonSecondary:
    "inline-block rounded-full border border-stone-300 px-6 py-3 text-sm font-medium hover:bg-stone-100",
};

function statusBadge(issue) {
  return hasArticle(issue)
    ? `<span class="shrink-0 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-800">記事あり</span>`
    : `<span class="shrink-0 rounded-full bg-stone-100 px-2.5 py-0.5 text-xs font-medium text-stone-600">準備中</span>`;
}

// 課題カード。カード全体がリンクになる。
function issueCard(issue, { note = "", showCategory = false, heading = "h3", attrs = "" } = {}) {
  const category = categoryBySlug.get(issue.category);
  return `<li${attrs} class="flex">
  <article class="relative flex w-full flex-col p-5 ${C.card} ${C.cardHover}">
    ${showCategory ? `<p class="text-xs ${C.muted}">${esc(category.name)}</p>` : ""}
    <div class="flex items-start justify-between gap-3">
      <${heading} class="text-lg leading-snug font-bold">
        <a href="${issueUrl(issue)}" class="after:absolute after:inset-0 after:rounded-2xl focus-visible:outline-none">${esc(issue.title)}</a>
      </${heading}>
      ${statusBadge(issue)}
    </div>
    <p class="mt-2 text-sm leading-7 ${C.muted}">${note || esc(issue.summary)}</p>
  </article>
</li>`;
}

function issueGrid(list, options = {}) {
  return `<ul class="grid gap-4 sm:grid-cols-2${options.wide ? " lg:grid-cols-3" : ""}">${list.map((i) => issueCard(i, options)).join("\n")}</ul>`;
}

function tagChips(list, { count = true } = {}) {
  return `<ul class="flex flex-wrap gap-2">${list
    .map((tag) => {
      const n = issues.filter((i) => (i.tags ?? []).includes(tag.slug)).length;
      return `<li><a href="${tagUrl(tag)}" class="${C.chip}" title="${esc(tag.description)}"><span aria-hidden="true" class="text-emerald-700">#</span>${esc(tag.name)}${
        count ? `<span class="text-xs text-stone-500">${n}</span>` : ""
      }</a></li>`;
    })
    .join("")}</ul>`;
}

function breadcrumb(items) {
  return `<nav aria-label="パンくずリスト" class="text-sm ${C.muted}">
  <ol class="flex flex-wrap items-center gap-x-2 gap-y-1">
    ${items
      .map((item, i) => {
        const sep = i > 0 ? `<span aria-hidden="true" class="mr-2 text-stone-400">/</span>` : "";
        return item.url
          ? `<li>${sep}<a href="${item.url}" class="hover:underline underline-offset-4">${esc(item.name)}</a></li>`
          : `<li aria-current="page">${sep}<span class="text-stone-900">${esc(item.name)}</span></li>`;
      })
      .join("\n    ")}
  </ol>
</nav>`;
}

function breadcrumbJsonLd(items, path) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      item: SITE.origin + (item.url ?? path),
    })),
  };
}

const NAV = [
  { key: "issues", href: "/issues/", label: "課題一覧" },
  { key: "categories", href: "/#categories", label: "カテゴリ" },
  { key: "about", href: "/about/", label: "このサイトについて" },
  { key: "github", href: SITE.repo, label: "GitHub" },
];

function layout({
  path,
  title,
  description,
  body,
  nav = "",
  ogType = "website",
  ogTitle = title.replace(` | ${SITE.name}`, ""), // SNS のカードにはサイト名が別に出るので、サイト名を付けない
  ogDescription = description,
  ogImage = ogImageUrl(path),
  jsonLd = [],
  noindex = false,
  scripts = [],
}) {
  const url = SITE.origin + path;
  const ogImageAlt = ogTitle.includes(SITE.name) ? ogTitle : `${ogTitle} — ${SITE.name}`;
  const navLinks = NAV.map(
    (item) =>
      `<li><a href="${item.href}"${item.key === nav ? ' aria-current="page"' : ""} class="inline-block py-1 text-stone-600 underline-offset-4 hover:text-stone-900 hover:underline aria-[current=page]:font-bold aria-[current=page]:text-stone-900">${esc(item.label)}</a></li>`,
  ).join("\n          ");
  const ld = jsonLd
    .map((data) => `<script type="application/ld+json">${JSON.stringify(data).replaceAll("<", "\\u003c")}</script>`)
    .join("\n    ");
  return `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="only light" />
    <title>${esc(title)}</title>
    <meta name="description" content="${esc(description)}" />
    ${noindex ? `<meta name="robots" content="noindex" />` : `<link rel="canonical" href="${esc(url)}" />`}
    <meta property="og:site_name" content="${esc(SITE.name)}" />
    <meta property="og:title" content="${esc(ogTitle)}" />
    <meta property="og:description" content="${esc(ogDescription)}" />
    <meta property="og:type" content="${ogType}" />
    <meta property="og:url" content="${esc(url)}" />
    <meta property="og:locale" content="ja_JP" />
    <meta property="og:image" content="${esc(ogImage)}" />
    <meta property="og:image:type" content="image/png" />
    <meta property="og:image:width" content="${OG_IMAGE.width}" />
    <meta property="og:image:height" content="${OG_IMAGE.height}" />
    <meta property="og:image:alt" content="${esc(ogImageAlt)}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${esc(ogTitle)}" />
    <meta name="twitter:description" content="${esc(ogDescription)}" />
    <meta name="twitter:image" content="${esc(ogImage)}" />
    <meta name="twitter:image:alt" content="${esc(ogImageAlt)}" />
    <link rel="icon" href="/favicon.ico" sizes="32x32" />
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <meta name="theme-color" content="#059669" />
    <meta name="author" content="${esc(SITE.operator.name)}" />
    <link rel="stylesheet" href="/assets/styles.css" />
    ${ld}
  </head>
  <body class="flex min-h-screen flex-col bg-stone-50 font-sans text-stone-900 antialiased">
    <a href="#main" class="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-10 focus:rounded-full focus:bg-stone-900 focus:px-4 focus:py-2 focus:text-sm focus:text-white">本文へ移動</a>
    <header class="border-b border-stone-200">
      <div class="${C.container} flex flex-wrap items-center justify-between gap-x-6 gap-y-1 py-4">
        <a href="/" class="text-base font-bold tracking-tight sm:text-xl">${esc(SITE.name)}</a>
        <nav aria-label="サイト内メニュー">
          <ul class="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
          ${navLinks}
          </ul>
        </nav>
      </div>
    </header>

    <main id="main" class="flex-1">
${body}
    </main>

    <footer class="mt-20 border-t border-stone-200">
      <div class="${C.container} grid gap-8 py-10 text-sm sm:grid-cols-[2fr_1fr_1fr]">
        <div>
          <p class="text-base font-bold">${esc(SITE.name)}</p>
          <p class="mt-2 leading-7 ${C.muted}">${esc(SITE.tagline)}<br />数字には出典を付け、誰でも確かめられるようにしています。</p>
        </div>
        <nav aria-label="フッターメニュー">
          <ul class="space-y-2 ${C.muted}">
            <li><a href="/issues/" class="hover:underline underline-offset-4">課題一覧</a></li>
            <li><a href="/#categories" class="hover:underline underline-offset-4">カテゴリ</a></li>
            <li><a href="/#tags" class="hover:underline underline-offset-4">横断タグ</a></li>
            <li><a href="/about/" class="hover:underline underline-offset-4">このサイトについて</a></li>
          </ul>
        </nav>
        <nav aria-label="参加する">
          <ul class="space-y-2 ${C.muted}">
            <li><a href="${SITE.repo}" class="hover:underline underline-offset-4">GitHub</a></li>
            <li><a href="${CONTRIBUTE_URL}" class="hover:underline underline-offset-4">記事を書く</a></li>
            <li><a href="${SITE.repo}/issues" class="hover:underline underline-offset-4">誤りを報告する</a></li>
          </ul>
        </nav>
      </div>
      <div class="${C.container} flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 pb-10 text-xs text-stone-500">
        <p>wakari.jp — 内容はすべて GitHub で公開されています。</p>
        <p>運営 <a href="${SITE.operator.url}" rel="author" class="ml-1 hover:underline underline-offset-4">${esc(SITE.operator.name)}</a></p>
      </div>
    </footer>
    ${scripts.map((src) => `<script src="${src}" defer></script>`).join("\n    ")}
  </body>
</html>
`;
}

// 一覧系ページの見出し部分
function pageHeader({ crumbs, eyebrow, h1, lead }) {
  return `      <div class="${C.container} pt-6">
        ${breadcrumb(crumbs)}
      </div>
      <div class="${C.container} pt-10 pb-10 sm:pt-14">
        ${eyebrow ? `<p class="${C.eyebrow}">${esc(eyebrow)}</p>` : ""}
        <h1 class="mt-3 text-3xl leading-tight font-bold tracking-tight sm:text-4xl">${esc(h1)}</h1>
        <p class="mt-5 max-w-3xl text-base leading-8 text-stone-700 sm:text-lg sm:leading-9">${esc(lead)}</p>
      </div>`;
}

// ---------------------------------------------------------------------------
// 記事本文の描画
// ---------------------------------------------------------------------------

function createArticleRenderer(article) {
  const sourceNo = new Map(article.sources.map((s, i) => [s.id, i + 1]));
  const sourceById = new Map(article.sources.map((s) => [s.id, s]));

  const inline = (text) =>
    esc(text)
      .replace(/\*\*(.+?)\*\*/g, '<strong class="font-bold">$1</strong>')
      .replace(
        CITE_RE,
        (_, id) =>
          `<sup class="ml-0.5 text-xs leading-none"><a href="#src-${id}" class="text-emerald-700 hover:underline" aria-label="出典 ${sourceNo.get(id)}">[${sourceNo.get(id)}]</a></sup>`,
      );

  const sourceLine = (id) => {
    if (!id) return "";
    const s = sourceById.get(id);
    return `<p class="mt-3 text-xs leading-6 text-stone-500">出典: <a href="#src-${id}" class="${C.link}">${esc(s.org)}「${esc(s.title)}」</a></p>`;
  };

  const figure = (block, inner) => `<figure class="mt-8 p-5 ${C.card}">
  ${block.caption ? `<figcaption class="mb-4 text-sm font-bold leading-6">${inline(block.caption)}</figcaption>` : ""}
  ${inner}
  ${sourceLine(block.source)}
</figure>`;

  const blockHtml = (block) => {
    if (typeof block === "string") {
      return `<p class="mt-5 leading-8 sm:text-[1.0625rem] sm:leading-9">${inline(block)}</p>`;
    }
    if (block.type === "list") {
      return `<ul class="mt-5 list-disc space-y-2 pl-6 leading-8 marker:text-emerald-600 sm:text-[1.0625rem]">${block.items
        .map((item) => `<li>${inline(item)}</li>`)
        .join("")}</ul>`;
    }
    if (block.type === "table") {
      return figure(
        block,
        `<div class="-mx-5 overflow-x-auto px-5">
    <table class="w-full min-w-max border-collapse text-left text-sm">
      <thead><tr class="border-b border-stone-300">${block.head
        .map((h) => `<th scope="col" class="py-2 pr-6 font-bold whitespace-nowrap last:pr-0">${inline(h)}</th>`)
        .join("")}</tr></thead>
      <tbody>${block.rows
        .map(
          (row) =>
            `<tr class="border-b border-stone-200 last:border-0">${row
              .map((cell, i) =>
                i === 0
                  ? `<th scope="row" class="py-2 pr-6 font-medium whitespace-nowrap">${inline(cell)}</th>`
                  : `<td class="py-2 pr-6 tabular-nums last:pr-0">${inline(cell)}</td>`,
              )
              .join("")}</tr>`,
        )
        .join("")}</tbody>
    </table>
  </div>`,
      );
    }
    // bars: 横棒グラフ。値は文字でも読めるようにし、棒は装飾として扱う。
    const max = Math.max(...block.items.map((it) => Math.abs(it.value)), 0) || 1;
    const unit = block.unit ? esc(block.unit) : "";
    return figure(
      block,
      `<ul class="grid grid-cols-[minmax(0,auto)_minmax(3rem,1fr)_auto] items-center gap-x-3 gap-y-3 text-sm">${block.items
        .map((it) => {
          const width = Math.max(0, Math.min(100, (Math.abs(it.value) / max) * 100)).toFixed(1);
          return `<li class="col-span-3 grid grid-cols-subgrid items-center">
      <span class="${C.muted}">${inline(it.label)}</span>
      <span aria-hidden="true" class="block h-4 rounded-sm bg-stone-100"><span class="block h-4 min-w-0.5 rounded-sm bg-emerald-600" style="width:${width}%"></span></span>
      <span class="text-right font-bold whitespace-nowrap tabular-nums">${esc(formatNumber(it.value))}${unit ? `<span class="ml-0.5 text-xs font-normal">${unit}</span>` : ""}</span>
    </li>`;
        })
        .join("")}</ul>`,
    );
  };

  return { inline, sourceLine, sourceNo, blocks: (list) => list.map(blockHtml).join("\n") };
}

function flowDiagram(flow, issue, inline) {
  const arrow = `<li aria-hidden="true" class="flex justify-center text-xl leading-none text-emerald-600 sm:items-center"><span class="sm:hidden">↓</span><span class="hidden sm:inline">→</span></li>`;
  const items = flow
    .map((step) => {
      const current = plain(step) === issue.title;
      return `<li class="flex flex-1 items-center justify-center rounded-xl border px-4 py-3 text-center text-sm leading-6 font-medium ${
        current
          ? "border-emerald-600 bg-emerald-50 text-emerald-900"
          : "border-stone-200 bg-white"
      }"${current ? ' aria-current="true"' : ""}>${inline(step)}</li>`;
    })
    .join(arrow);
  return `<section aria-labelledby="flow-heading" class="mt-10">
  <h2 id="flow-heading" class="text-sm font-bold">原因から影響までの流れ</h2>
  <ol class="mt-3 flex flex-col gap-2 sm:flex-row sm:items-stretch">${items}</ol>
  <p class="mt-3 text-xs leading-6 text-stone-500">矢印は、統計的に証明された因果関係ではなく、主な伝わり方を示しています。</p>
</section>`;
}

// つながり: related の順に並べ、connections にしかない課題を後ろに足す
function connectionCards(issue, article, inline = esc) {
  const notes = new Map((article?.connections ?? []).map((c) => [c.id, c.note]));
  const ids = [...new Set([...(issue.related ?? []), ...notes.keys()])];
  return `<ul class="grid gap-4 sm:grid-cols-2">${ids
    .map((id) => issueCard(issueById.get(id), { showCategory: true, note: notes.get(id) ? inline(notes.get(id)) : "" }))
    .join("\n")}</ul>`;
}

// ---------------------------------------------------------------------------
// ページ
// ---------------------------------------------------------------------------

const pages = []; // { path, html, lastmod, noindex }

function addPage(path, html, { lastmod, noindex = false, file } = {}) {
  pages.push({ path, html, lastmod, noindex, file: file ?? join(path, "index.html") });
}

function issueMeta(issue, margin = "mt-8") {
  const category = categoryBySlug.get(issue.category);
  const issueTags = (issue.tags ?? []).map((slug) => tagBySlug.get(slug));
  return `<dl class="${margin} flex flex-col gap-3 text-sm">
  <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
    <dt class="w-16 shrink-0 ${C.muted}">カテゴリ</dt>
    <dd><a href="${categoryUrl(category)}" class="${C.chip}">${esc(category.name)}</a></dd>
  </div>
  ${
    issueTags.length
      ? `<div class="flex flex-wrap items-start gap-x-3 gap-y-2">
    <dt class="w-16 shrink-0 pt-1.5 ${C.muted}">横断タグ</dt>
    <dd>${tagChips(issueTags, { count: false })}</dd>
  </div>`
      : ""
  }
</dl>`;
}

function issueCrumbs(issue) {
  const category = categoryBySlug.get(issue.category);
  return [
    { name: "トップ", url: "/" },
    { name: "課題一覧", url: "/issues/" },
    { name: category.name, url: categoryUrl(category) },
    { name: issue.title },
  ];
}

function articleJsonLd(issue, { headline, description, updated }) {
  const path = issueUrl(issue);
  const org = { "@type": "Organization", name: SITE.name, url: `${SITE.origin}/` };
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline,
    description,
    inLanguage: "ja",
    mainEntityOfPage: { "@type": "WebPage", "@id": SITE.origin + path },
    url: SITE.origin + path,
    image: [ogImageUrl(path)],
    ...(updated ? { dateModified: updated } : {}),
    articleSection: categoryBySlug.get(issue.category).name,
    keywords: (issue.tags ?? []).map((slug) => tagBySlug.get(slug).name).join(","),
    author: org,
    publisher: org,
  };
}

function publishedIssuePage(issue, article) {
  const path = issueUrl(issue);
  const r = createArticleRenderer(article);
  const crumbs = issueCrumbs(issue);
  const h1 = plain(article.h1);
  const description = truncate(article.lead);

  const sections = [
    { id: "now", title: "いま何が起きている？", html: r.blocks(article.now) },
    { id: "numbers", title: "数字で見る", html: r.blocks(article.numbers) },
    { id: "why", title: "なぜ起きる？", html: r.blocks(article.why) },
    {
      id: "misconceptions",
      title: "よくある誤解",
      html: `<div class="mt-6 space-y-4">${article.misconceptions
        .map(
          (m) => `<div class="p-5 ${C.card}">
  <p class="text-xs font-bold text-stone-500">よくある誤解</p>
  <p class="mt-1 text-lg leading-8 font-bold">「${r.inline(m.myth)}」</p>
  <p class="mt-4 text-xs font-bold text-emerald-700">実際は</p>
  <p class="mt-1 leading-8">${r.inline(m.fact)}</p>
</div>`,
        )
        .join("\n")}</div>`,
    },
    article.options?.length && {
      id: "options",
      title: "どんな選択肢がある？",
      html: `<p class="mt-5 text-sm leading-7 ${C.muted}">どれかひとつが正解というわけではありません。それぞれに、期待できることと、負担や副作用があります。</p>
<div class="mt-6 space-y-4">${article.options
        .map(
          (o) => `<div class="p-5 ${C.card}">
  <h3 class="text-lg leading-snug font-bold">${r.inline(o.name)}</h3>
  <dl class="mt-4 grid gap-4 sm:grid-cols-2">
    <div>
      <dt class="text-xs font-bold text-emerald-700">期待できること</dt>
      <dd class="mt-1 text-sm leading-7">${r.inline(o.pros)}</dd>
    </div>
    <div>
      <dt class="text-xs font-bold text-stone-500">負担・副作用</dt>
      <dd class="mt-1 text-sm leading-7">${r.inline(o.cons)}</dd>
    </div>
  </dl>
</div>`,
        )
        .join("\n")}</div>`,
    },
    {
      id: "indicators",
      title: "これから見るべき指標",
      html: `<dl class="mt-6 divide-y divide-stone-200 border-y border-stone-200">${article.indicators
        .map(
          (ind) => `<div class="py-4">
  <dt class="font-bold">${r.inline(ind.name)}</dt>
  <dd class="mt-1 text-sm leading-7 ${C.muted}">${r.inline(ind.desc)}${r.sourceLine(ind.source)}</dd>
</div>`,
        )
        .join("\n")}</dl>`,
    },
    {
      id: "connections",
      title: "ほかの問題とのつながり",
      html: `<p class="mt-5 text-sm leading-7 ${C.muted}">この課題は、次の課題の原因や結果になっています。つながりは「主な伝わり方」であり、統計的に証明された因果関係とは限りません。</p>
<div class="mt-6">${connectionCards(issue, article, r.inline)}</div>`,
    },
    {
      id: "sources",
      title: "出典・更新日",
      html: `<p class="mt-5 text-sm leading-7 ${C.muted}">データ確認日: <time datetime="${esc(article.updated)}">${formatDate(article.updated)}</time></p>
<ol class="mt-4 space-y-4 text-sm leading-7">${article.sources
        .map(
          (s) => `<li id="src-${s.id}" class="flex scroll-mt-6 gap-3 rounded-lg target:bg-emerald-50">
  <span class="shrink-0 text-stone-500 tabular-nums">[${r.sourceNo.get(s.id)}]</span>
  <span class="min-w-0">
    ${esc(s.org)}「<a href="${esc(s.url)}" rel="noopener external" class="${C.link} break-words">${esc(s.title)}</a>」
    <span class="block text-xs text-stone-500">${[
      s.published ? `公表: ${formatDate(s.published)}` : "",
      s.checked ? `確認: ${formatDate(s.checked)}` : "",
    ]
      .filter(Boolean)
      .join(" / ")}</span>
  </span>
</li>`,
        )
        .join("\n")}</ol>
<p class="mt-8 text-sm leading-7 ${C.muted}">誤りや古い数字を見つけたら、<a href="${SITE.repo}/blob/develop/content/issues/${issue.slug}.json" class="${C.link}">GitHub でこの記事のデータ</a>を直して Pull Request を出すか、<a href="${SITE.repo}/issues" class="${C.link}">Issue</a> で教えてください。</p>`,
    },
  ].filter(Boolean);

  const stats = `<ul class="mt-10 grid gap-4 ${article.stats.length > 1 ? (article.stats.length === 2 ? "sm:grid-cols-2" : "sm:grid-cols-3") : ""}">${article.stats
    .map(
      (s) => `<li class="flex flex-col p-5 ${C.card}">
  <p class="text-sm leading-6 ${C.muted}">${r.inline(s.label)}</p>
  <p class="mt-2 text-4xl leading-none font-bold tracking-tight text-emerald-800 tabular-nums">${esc(s.value)}${s.unit ? `<span class="ml-1 text-base font-bold tracking-normal">${esc(s.unit)}</span>` : ""}</p>
  ${s.period ? `<p class="mt-3 text-xs leading-5 ${C.muted}">${r.inline(s.period)}</p>` : ""}
  <div class="mt-auto">${r.sourceLine(s.source)}</div>
</li>`,
    )
    .join("\n")}</ul>`;

  const body = `      <div class="${C.prose} pt-6">
        ${breadcrumb(crumbs)}
      </div>
      <article class="${C.prose} pt-10 sm:pt-14">
        <header>
          <p class="${C.eyebrow}">${esc(categoryBySlug.get(issue.category).name)}</p>
          <h1 class="mt-3 text-3xl leading-tight font-bold tracking-tight sm:text-4xl">${esc(h1)}</h1>
          <p class="mt-6 text-lg leading-9 text-stone-700">${r.inline(article.lead)}</p>
          <p class="mt-4 text-xs ${C.muted}">データ確認日: <time datetime="${esc(article.updated)}">${formatDate(article.updated)}</time></p>
        </header>

        ${stats}

        ${article.flow?.length ? flowDiagram(article.flow, issue, r.inline) : ""}

        <nav aria-labelledby="toc-heading" class="mt-10 p-5 ${C.card}">
          <h2 id="toc-heading" class="text-sm font-bold">このページの内容</h2>
          <ol class="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            ${sections.map((s) => `<li><a href="#${s.id}" class="${C.link}">${s.title}</a></li>`).join("\n            ")}
          </ol>
        </nav>

        ${sections
          .map(
            (s) => `<section aria-labelledby="${s.id}" class="mt-14 pt-10 ${C.sectionTop}">
          <h2 id="${s.id}" class="scroll-mt-6 ${C.h2}">${s.title}</h2>
          ${s.html}
        </section>`,
          )
          .join("\n\n        ")}

        <footer class="mt-14 pt-8 ${C.sectionTop}">
          <h2 class="text-sm font-bold">この課題の分類</h2>
          ${issueMeta(issue, "mt-4")}
        </footer>
      </article>`;

  addPage(
    path,
    layout({
      path,
      title: `${h1} | ${SITE.name}`,
      description,
      body,
      nav: "issues",
      ogType: "article",
      jsonLd: [articleJsonLd(issue, { headline: h1, description, updated: article.updated }), breadcrumbJsonLd(crumbs, path)],
    }),
    { lastmod: article.updated },
  );
}

function draftIssuePage(issue) {
  const path = issueUrl(issue);
  const crumbs = issueCrumbs(issue);
  const description = truncate(`${issue.title}: ${issue.summary}`);
  const related = (issue.related ?? []).length > 0;

  const body = `      <div class="${C.prose} pt-6">
        ${breadcrumb(crumbs)}
      </div>
      <article class="${C.prose} pt-10 sm:pt-14">
        <header>
          <p class="flex items-center gap-3"><span class="${C.eyebrow}">${esc(categoryBySlug.get(issue.category).name)}</span>${statusBadge(issue)}</p>
          <h1 class="mt-3 text-3xl leading-tight font-bold tracking-tight sm:text-4xl">${esc(issue.title)}</h1>
        </header>

        <section aria-labelledby="summary" class="mt-8">
          <h2 id="summary" class="text-sm font-bold ${C.muted}">概要</h2>
          <p class="mt-2 text-lg leading-9 text-stone-700">${esc(issue.summary)}</p>
          <p class="mt-6 rounded-xl bg-stone-100 px-4 py-3 text-sm leading-7 ${C.muted}">このページの解説記事は準備中です。出典を確認できた数字だけを載せる方針のため、いまは概要と、ほかの課題とのつながりだけを掲載しています。</p>
        </section>

        <section aria-labelledby="taxonomy" class="mt-12 pt-10 ${C.sectionTop}">
          <h2 id="taxonomy" class="${C.h2}">分類</h2>
          ${issueMeta(issue, "mt-6")}
        </section>

        ${
          related
            ? `<section aria-labelledby="connections" class="mt-12 pt-10 ${C.sectionTop}">
          <h2 id="connections" class="${C.h2}">ほかの問題とのつながり</h2>
          <p class="mt-5 text-sm leading-7 ${C.muted}">この課題は、次の課題の原因や結果になっています。つながりは「主な伝わり方」であり、統計的に証明された因果関係とは限りません。</p>
          <div class="mt-6">${connectionCards(issue, null)}</div>
        </section>`
            : ""
        }

        <section aria-labelledby="contribute" class="mt-12 rounded-2xl border border-emerald-200 bg-emerald-50 p-6 sm:p-8">
          <h2 id="contribute" class="${C.h2}">この記事を書きませんか</h2>
          <p class="mt-4 leading-8">このサイトの記事は、誰でも GitHub から追加できます。官公庁などの一次資料で確認した数字と出典をそろえて、Pull Request を出してください。</p>
          <ol class="mt-4 list-decimal space-y-1 pl-6 text-sm leading-7">
            <li>リポジトリを Fork して、<code class="rounded bg-white px-1.5 py-0.5 text-[0.8125rem] break-all">content/issues/${issue.slug}.json</code> を追加する</li>
            <li><code class="rounded bg-white px-1.5 py-0.5 text-[0.8125rem]">npm run build</code> で、出典の付け忘れがないか確かめる</li>
            <li><code class="rounded bg-white px-1.5 py-0.5 text-[0.8125rem]">develop</code> ブランチに向けて Pull Request を出す</li>
          </ol>
          <div class="mt-6 flex flex-wrap gap-3">
            <a href="${CONTRIBUTE_URL}" class="${C.buttonPrimary}">記事の書き方を見る</a>
            <a href="${SITE.repo}/issues" class="${C.buttonSecondary} bg-white">Issue で相談する</a>
          </div>
        </section>
      </article>`;

  addPage(
    path,
    layout({
      path,
      title: `${issue.title}（準備中） | ${SITE.name}`,
      description,
      ogTitle: issue.title,
      ogDescription: truncate(issue.summary),
      body,
      nav: "issues",
      ogType: "article",
      jsonLd: [articleJsonLd(issue, { headline: issue.title, description }), breadcrumbJsonLd(crumbs, path)],
    }),
  );
}

function homePage() {
  const path = "/";
  const featured = issues.filter((i) => i.featured);
  const published = issues.filter(hasArticle).length;

  const arrow = `<li aria-hidden="true" class="flex items-center justify-center text-2xl leading-none text-emerald-600"><span class="lg:hidden">↓</span><span class="hidden lg:inline">→</span></li>`;
  const chain = MAIN_CHAIN.map((step, i) => {
    const links = step.links
      .map((link) => {
        const issue = issueById.get(link.id);
        return `<a href="${issueUrl(issue)}" class="${C.link}"${link.text ? ` title="${esc(issue.title)}"` : ""}>${esc(link.text ?? issue.title)}</a>`;
      })
      .join(`<span aria-hidden="true" class="text-stone-400"> ・ </span>`);
    return `<li class="flex flex-1 flex-col p-5 ${C.card}">
          <p class="text-xs font-bold text-emerald-700 tabular-nums">${i + 1}</p>
          <p class="mt-1 text-lg leading-snug font-bold">${esc(step.label)}</p>
          <p class="mt-3 text-sm leading-7 ${C.muted}"><span class="sr-only">くわしく読む: </span>${links}</p>
        </li>`;
  }).join(`\n        ${arrow}\n        `);

  const categoryCards = categories
    .map((category) => {
      const list = issues.filter((i) => i.category === category.slug);
      return `<li class="flex">
          <article class="relative flex w-full flex-col p-5 ${C.card} ${C.cardHover}">
            <div class="flex items-baseline justify-between gap-3">
              <h3 class="text-lg leading-snug font-bold"><a href="${categoryUrl(category)}" class="after:absolute after:inset-0 after:rounded-2xl focus-visible:outline-none">${esc(category.name)}</a></h3>
              <span class="shrink-0 text-xs ${C.muted}">${list.length} 課題</span>
            </div>
            <p class="mt-2 text-sm leading-7 ${C.muted}">${esc(category.description)}</p>
          </article>
        </li>`;
    })
    .join("\n        ");

  const body = `      <section class="${C.container} py-14 sm:py-24">
        <p class="${C.eyebrow}">${esc(SITE.tagline)}</p>
        <h1 class="mt-4 max-w-3xl text-3xl leading-snug font-bold tracking-tight sm:text-5xl sm:leading-tight"><span class="inline-block">日本の問題は、</span><span class="inline-block">ひとつずつ</span><span class="inline-block">起きているわけでは</span><span class="inline-block">ありません。</span><span class="inline-block text-emerald-700">つながっています。</span></h1>
        <p class="mt-6 max-w-2xl text-base leading-8 text-stone-700 sm:text-lg sm:leading-9">このサイトは、日本が抱える ${issues.length} の課題を、前提知識がなくても読めるように解説するサイトです。ひとつの課題が、ほかの課題の原因にも結果にもなっている。そのつながりをたどれるようにしています。</p>
        <div class="mt-9 flex flex-wrap gap-3">
          <a href="/issues/" class="${C.buttonPrimary}">課題一覧を見る</a>
          <a href="/about/" class="${C.buttonSecondary}">このサイトについて</a>
        </div>
      </section>

      <section aria-labelledby="chain-heading" class="${C.sectionTop} bg-white">
        <div class="${C.container} py-14">
          <h2 id="chain-heading" class="${C.h2}">まず、いちばん太い流れから</h2>
          <p class="mt-4 max-w-2xl leading-8 ${C.muted}">多くの課題の上流には、人口の変化があります。各ステップから、くわしい解説ページへ進めます。</p>
          <ol class="mt-8 flex flex-col gap-3 lg:flex-row lg:items-stretch">
        ${chain}
          </ol>
          <p class="mt-5 text-xs leading-6 text-stone-500">矢印は、統計的に証明された因果関係ではなく、主な伝わり方を示しています。ここに出てこない原因 (賃金、制度、気候、国際情勢など) も、それぞれの課題ページで扱います。</p>
        </div>
      </section>

      <section id="categories" aria-labelledby="categories-heading" class="scroll-mt-6 ${C.sectionTop}">
        <div class="${C.container} py-14">
          <h2 id="categories-heading" class="${C.h2}">カテゴリから探す</h2>
          <p class="mt-4 max-w-2xl leading-8 ${C.muted}">${issues.length} の課題を、${categories.length} の入口に分けています。</p>
          <ul class="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        ${categoryCards}
          </ul>
        </div>
      </section>

      <section aria-labelledby="featured-heading" class="${C.sectionTop}">
        <div class="${C.container} py-14">
          <div class="flex flex-wrap items-end justify-between gap-3">
            <h2 id="featured-heading" class="${C.h2}">注目の課題</h2>
            <a href="/issues/" class="text-sm ${C.link}">すべての課題 (${issues.length}) を見る</a>
          </div>
          <p class="mt-4 max-w-2xl leading-8 ${C.muted}">日本の構造を理解するうえで、最初に読んでおきたい ${featured.length} の課題です。</p>
          <div class="mt-8">${issueGrid(featured, { showCategory: true, wide: true })}</div>
        </div>
      </section>

      <section id="tags" aria-labelledby="tags-heading" class="scroll-mt-6 ${C.sectionTop}">
        <div class="${C.container} py-14">
          <h2 id="tags-heading" class="${C.h2}">横断タグでたどる</h2>
          <p class="mt-4 max-w-2xl leading-8 ${C.muted}">カテゴリをまたいで、同じ背景をもつ課題をまとめて見られます。</p>
          <div class="mt-8">${tagChips(tags)}</div>
        </div>
      </section>

      <section aria-labelledby="policy-heading" class="${C.sectionTop}">
        <div class="${C.container} py-14">
          <h2 id="policy-heading" class="sr-only">このサイトの編集方針</h2>
          <div class="grid gap-8 sm:grid-cols-3">
            <div>
              <h3 class="font-bold">わかりやすく</h3>
              <p class="mt-2 text-sm leading-7 ${C.muted}">専門用語をできるだけ使わず、背景から順番に説明します。</p>
            </div>
            <div>
              <h3 class="font-bold">出典を明記</h3>
              <p class="mt-2 text-sm leading-7 ${C.muted}">数字や事実には一次資料の出典を付け、誰でも確かめられるようにします。</p>
            </div>
            <div>
              <h3 class="font-bold">誰でも参加</h3>
              <p class="mt-2 text-sm leading-7 ${C.muted}">誤りの指摘も新しい解説も、GitHub の Pull Request で受け付けています。</p>
            </div>
          </div>
          <p class="mt-10 text-sm leading-7 ${C.muted}">現在、${issues.length} 課題のうち ${published} 課題に解説記事があります。残りは準備中です。<a href="${CONTRIBUTE_URL}" class="${C.link}">記事を書いてみませんか。</a></p>
        </div>
      </section>`;

  addPage(
    path,
    layout({
      path,
      title: `${SITE.name} | wakari.jp`,
      description: SITE.description,
      body,
      jsonLd: [
        {
          "@context": "https://schema.org",
          "@type": "WebSite",
          name: SITE.name,
          url: `${SITE.origin}/`,
          description: SITE.description,
          image: ogImageUrl(path),
          inLanguage: "ja",
        },
      ],
    }),
    { file: "index.html" },
  );
}

function issuesIndexPage() {
  const path = "/issues/";
  const crumbs = [{ name: "トップ", url: "/" }, { name: "課題一覧" }];
  const published = issues.filter(hasArticle).length;

  const tabs = [
    `<a href="#issue-list" id="tab-all" data-tab="all" class="${C.chip} ${C.chipActive}">すべて<span class="text-xs opacity-70">${issues.length}</span></a>`,
    ...categories.map((c) => {
      const n = issues.filter((i) => i.category === c.slug).length;
      return `<a href="#cat-${c.slug}" id="tab-${c.slug}" data-tab="${c.slug}" class="${C.chip} ${C.chipActive}">${esc(c.name)}<span class="text-xs opacity-70">${n}</span></a>`;
    }),
  ].join("\n            ");

  const tagButtons = tags
    .map(
      (t) =>
        `<li><a href="${tagUrl(t)}" data-tag="${t.slug}" class="${C.chip} ${C.chipActive}" title="${esc(t.description)}"><span aria-hidden="true" class="opacity-60">#</span>${esc(t.name)}</a></li>`,
    )
    .join("\n              ");

  const panels = categories
    .map((c) => {
      const list = issues.filter((i) => i.category === c.slug);
      return `<section id="cat-${c.slug}" data-panel="${c.slug}" aria-labelledby="cat-${c.slug}-heading" class="scroll-mt-6 pt-12">
            <div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h2 id="cat-${c.slug}-heading" class="${C.h2}">${esc(c.name)}</h2>
              <a href="${categoryUrl(c)}" class="text-sm ${C.link}">このカテゴリのページ</a>
            </div>
            <p class="mt-2 text-sm leading-7 ${C.muted}">${esc(c.description)}</p>
            <ul class="mt-5 grid gap-4 sm:grid-cols-2">
${list
  .map((i) =>
    issueCard(i, {
      attrs: ` data-issue data-tags="${(i.tags ?? []).join(" ")}" data-status="${hasArticle(i) ? "published" : "draft"}"`,
    }),
  )
  .join("\n")}
            </ul>
          </section>`;
    })
    .join("\n\n          ");

  const body = `${pageHeader({
    crumbs,
    h1: "課題一覧",
    lead: `日本が抱える ${issues.length} の課題を、${categories.length} のカテゴリに分けて並べています。いま解説記事があるのは ${published} 課題で、残りは準備中です。`,
  })}
      <div class="${C.container}" data-issue-filter>
        <div class="p-5 ${C.card}">
          <h2 id="filter-category" class="text-sm font-bold">カテゴリ</h2>
          <div data-tabs aria-labelledby="filter-category" class="mt-3 flex flex-wrap gap-2">
            ${tabs}
          </div>

          <h2 id="filter-tag" class="mt-6 text-sm font-bold">横断タグ</h2>
          <ul data-tags aria-labelledby="filter-tag" class="mt-3 flex flex-wrap gap-2">
              ${tagButtons}
          </ul>

          <div data-js-only hidden class="mt-6 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-t border-stone-200 pt-4 text-sm">
            <label class="inline-flex cursor-pointer items-center gap-2">
              <input type="checkbox" data-published-only class="size-4 accent-emerald-700" />
              記事がある課題だけ表示
            </label>
            <p class="flex items-center gap-4 ${C.muted}">
              <span data-count role="status" aria-live="polite"></span>
              <button type="button" data-reset hidden class="${C.link}">絞り込みを解除</button>
            </p>
          </div>
        </div>

        <div id="issue-list" class="scroll-mt-6">
          ${panels}
          <p data-empty hidden class="mt-12 rounded-2xl border border-dashed border-stone-300 p-8 text-center ${C.muted}">条件に合う課題がありません。絞り込みを変えてみてください。</p>
        </div>
      </div>`;

  addPage(
    path,
    layout({
      path,
      title: `課題一覧 (${issues.length} 課題) | ${SITE.name}`,
      description: `日本が抱える ${issues.length} の課題の一覧です。${categories.length} のカテゴリと ${tags.length} の横断タグで絞り込めます。`,
      body,
      nav: "issues",
      jsonLd: [breadcrumbJsonLd(crumbs, path)],
      scripts: ["/assets/issues-filter.js"],
    }),
  );
}

function taxonomyPage({ path, kind, item, list, others, otherUrl, otherHeading }) {
  const crumbs = [{ name: "トップ", url: "/" }, { name: "課題一覧", url: "/issues/" }, { name: item.name }];
  const published = list.filter(hasArticle).length;
  const body = `${pageHeader({ crumbs, eyebrow: kind, h1: item.name, lead: item.description })}
      <div class="${C.container}">
        <p class="text-sm ${C.muted}">${list.length} 課題 (記事あり ${published} / 準備中 ${list.length - published})</p>
        <div class="mt-5">${issueGrid(list, { heading: "h2", showCategory: kind !== "カテゴリ" })}</div>

        <section aria-labelledby="others-heading" class="mt-16 pt-10 ${C.sectionTop}">
          <h2 id="others-heading" class="text-lg font-bold">${otherHeading}</h2>
          <ul class="mt-4 flex flex-wrap gap-2">
            ${others
              .map(
                (o) =>
                  `<li><a href="${otherUrl(o)}"${o.slug === item.slug ? ' aria-current="page"' : ""} class="${C.chip} aria-[current=page]:border-stone-900 aria-[current=page]:bg-stone-900 aria-[current=page]:text-white">${esc(o.name)}</a></li>`,
              )
              .join("\n            ")}
          </ul>
        </section>
      </div>`;
  addPage(
    path,
    layout({
      path,
      title: `${item.name} — ${kind} | ${SITE.name}`,
      description: truncate(`${kind}「${item.name}」の課題 ${list.length} 件。${item.description}`),
      body,
      nav: kind === "カテゴリ" ? "categories" : "",
      jsonLd: [breadcrumbJsonLd(crumbs, path)],
    }),
  );
}

function aboutPage() {
  const path = "/about/";
  const crumbs = [{ name: "トップ", url: "/" }, { name: "このサイトについて" }];
  const h2 = (id, text) => `<h2 id="${id}" class="mt-14 scroll-mt-6 pt-10 ${C.h2} ${C.sectionTop}">${text}</h2>`;
  const p = (html) => `<p class="mt-5 leading-8 sm:text-[1.0625rem] sm:leading-9">${html}</p>`;
  const body = `      <div class="${C.prose} pt-6">
        ${breadcrumb(crumbs)}
      </div>
      <article class="${C.prose} pt-10 sm:pt-14">
        <p class="${C.eyebrow}">${esc(SITE.tagline)}</p>
        <h1 class="mt-3 text-3xl leading-tight font-bold tracking-tight sm:text-4xl">このサイトについて</h1>
        <p class="mt-6 text-lg leading-9 text-stone-700">このサイトは、日本が抱える課題を、前提知識がなくても読めるように解説するサイトです。課題をひとつずつ切り離さず、「何が起きているか」「なぜ起きるか」「何とつながっているか」をあわせて示します。</p>

        ${h2("policy", "編集方針: 4 つを分けて書く")}
        ${p("社会の課題についての文章は、事実と意見が混ざると読みにくくなります。このサイトでは、次の 4 つを分けて書きます。")}
        <dl class="mt-6 space-y-4">
          <div class="p-5 ${C.card}">
            <dt class="font-bold"><span class="mr-2 text-emerald-700">1</span>事実</dt>
            <dd class="mt-2 text-sm leading-7 ${C.muted}">いま何が起きているか。官公庁などの一次資料で確認した数字を、対象の年月と「確定値・概数・推計」の別を添えて書きます。</dd>
          </div>
          <div class="p-5 ${C.card}">
            <dt class="font-bold"><span class="mr-2 text-emerald-700">2</span>構造</dt>
            <dd class="mt-2 text-sm leading-7 ${C.muted}">なぜ起きるのか、何とつながっているのか。矢印で示すつながりは「主な伝わり方」であり、統計的に証明された因果関係とは限りません。</dd>
          </div>
          <div class="p-5 ${C.card}">
            <dt class="font-bold"><span class="mr-2 text-emerald-700">3</span>選択肢</dt>
            <dd class="mt-2 text-sm leading-7 ${C.muted}">どんな対応がありうるか。賛成・反対ではなく、それぞれの「期待できること」と「負担・副作用」を並べます。</dd>
          </div>
          <div class="p-5 ${C.card}">
            <dt class="font-bold"><span class="mr-2 text-emerald-700">4</span>評価</dt>
            <dd class="mt-2 text-sm leading-7 ${C.muted}">どれを選ぶべきか。ここは読む人が判断するところです。このサイトは特定の政策を唯一の正解として書きません。立場が分かれる話題は、複数の見方を公平に紹介します。</dd>
          </div>
        </dl>

        ${h2("sources", "出典について")}
        <ul class="mt-5 list-disc space-y-2 pl-6 leading-8 marker:text-emerald-600 sm:text-[1.0625rem]">
          <li>数字や事実には、一次資料 (官公庁の統計や報告書など) へのリンクを付けます。</li>
          <li>統計には「いつの数字か」を必ず書きます。「最新」とだけ書くことはしません。</li>
          <li>出典を確認できなかった数字は載せません。記事ごとにデータの確認日を表示します。</li>
          <li>出典が 1 件もない記事や、本文から参照している出典が一覧にない記事は、サイトのビルドが失敗して公開されない仕組みにしています。</li>
        </ul>

        ${h2("structure", "サイトの構成")}
        ${p(`${issues.length} の課題を、${categories.length} のカテゴリ (入口) と ${tags.length} の横断タグで整理しています。カテゴリは「どの分野の話か」、横断タグは「どんな背景を共有しているか」を表します。`)}
        ${p(`解説記事がまだない課題は「準備中」と表示し、概要と分類、ほかの課題とのつながりだけを掲載しています。<a href="/issues/" class="${C.link}">課題一覧</a>から、記事の有無を確認できます。`)}

        ${h2("contribute", "参加方法")}
        ${p(`このサイトの内容は、すべて <a href="${SITE.repo}" class="${C.link}">GitHub のリポジトリ</a>で公開されています。誤字の修正ひとつでも、新しい解説記事でも歓迎です。`)}
        <ul class="mt-5 list-disc space-y-2 pl-6 leading-8 marker:text-emerald-600 sm:text-[1.0625rem]">
          <li><strong class="font-bold">誤りを見つけたら</strong> — <a href="${SITE.repo}/issues" class="${C.link}">Issue</a> で教えてください。出典となる資料があると助かります。</li>
          <li><strong class="font-bold">記事を書くなら</strong> — 課題ごとに 1 つの JSON ファイルを追加して、Pull Request を出します。書き方は <a href="${CONTRIBUTE_URL}" class="${C.link}">README の「記事を追加する」</a>にまとめています。</li>
        </ul>
        <div class="mt-8 flex flex-wrap gap-3">
          <a href="${CONTRIBUTE_URL}" class="${C.buttonPrimary}">記事の書き方を見る</a>
          <a href="/issues/" class="${C.buttonSecondary}">課題一覧を見る</a>
        </div>

        ${h2("operator", "運営")}
        ${p(`このサイトは、<a href="${SITE.operator.url}" rel="author" class="${C.link}">${esc(SITE.operator.name)}</a>が運営しています。`)}
      </article>`;
  addPage(
    path,
    layout({
      path,
      title: `このサイトについて | ${SITE.name}`,
      description: "このサイトの編集方針 (事実・構造・選択肢・評価を分けて書く)、出典の扱い、記事の追加や修正に参加する方法を説明します。",
      body,
      nav: "about",
      jsonLd: [breadcrumbJsonLd(crumbs, path)],
    }),
  );
}

function notFoundPage() {
  const body = `      <div class="${C.container} py-24 text-center sm:py-32">
        <p class="${C.eyebrow}">404</p>
        <h1 class="mt-4 text-3xl font-bold tracking-tight">ページが見つかりません</h1>
        <p class="mt-4 leading-8 ${C.muted}">URL が変わったか、ページが削除された可能性があります。</p>
        <div class="mt-8 flex flex-wrap justify-center gap-3">
          <a href="/" class="${C.buttonPrimary}">トップへ戻る</a>
          <a href="/issues/" class="${C.buttonSecondary}">課題一覧を見る</a>
        </div>
      </div>`;
  addPage(
    "/404.html",
    layout({
      path: "/404.html",
      title: `ページが見つかりません | ${SITE.name}`,
      description: "お探しのページは見つかりませんでした。",
      body,
      ogImage: ogImageUrl("/"),
      noindex: true,
    }),
    { noindex: true, file: "404.html" },
  );
}

// ---------------------------------------------------------------------------
// 生成
// ---------------------------------------------------------------------------

homePage();
issuesIndexPage();
for (const issue of issues) {
  const article = articles.get(issue.slug);
  if (article) publishedIssuePage(issue, article);
  else draftIssuePage(issue);
}
for (const category of categories) {
  taxonomyPage({
    path: categoryUrl(category),
    kind: "カテゴリ",
    item: category,
    list: issues.filter((i) => i.category === category.slug),
    others: categories,
    otherUrl: categoryUrl,
    otherHeading: "ほかのカテゴリ",
  });
}
for (const tag of tags) {
  taxonomyPage({
    path: tagUrl(tag),
    kind: "横断タグ",
    item: tag,
    list: issues.filter((i) => (i.tags ?? []).includes(tag.slug)),
    others: tags,
    otherUrl: tagUrl,
    otherHeading: "ほかの横断タグ",
  });
}
aboutPage();
notFoundPage();

// 前回の生成物を消してから書く (消えた課題のページが残らないように)
for (const dir of ["issues", "categories", "tags", "about"]) {
  rmSync(join(OUT_DIR, dir), { recursive: true, force: true });
}
function write(file, content) {
  const target = join(OUT_DIR, file);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}
for (const page of pages) write(page.file, page.html);

const sitemapUrls = pages.filter((p) => !p.noindex);
write(
  "sitemap.xml",
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapUrls
  .map((p) => `  <url><loc>${esc(SITE.origin + p.path)}</loc>${p.lastmod ? `<lastmod>${p.lastmod}</lastmod>` : ""}</url>`)
  .join("\n")}
</urlset>
`,
);
write("robots.txt", `User-agent: *\nAllow: /\n\nSitemap: ${SITE.origin}/sitemap.xml\n`);

const publishedCount = issues.filter(hasArticle).length;
console.log(
  `wakari: ${pages.length} ページを生成しました ` +
    `(課題 ${issues.length} = 記事あり ${publishedCount} + 準備中 ${issues.length - publishedCount}、` +
    `カテゴリ ${categories.length}、タグ ${tags.length}) + sitemap.xml (${sitemapUrls.length} URL) + robots.txt`,
);
