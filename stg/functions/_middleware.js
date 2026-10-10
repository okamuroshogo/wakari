// stg 環境専用の Basic 認証。
// デプロイ時に stg だけ ./functions へコピーされる(.github/workflows/deploy.yml)。
// 認証情報は Cloudflare Pages の Secret (BASIC_AUTH_USER / BASIC_AUTH_PASS) から読む。
// このリポジトリは public なので、値をコードに書かないこと。

const UNAUTHORIZED = () =>
  new Response("Unauthorized", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="wakari stg", charset="UTF-8"',
      "Cache-Control": "no-store",
    },
  });

async function safeEqual(a, b) {
  const enc = new TextEncoder();
  const [da, db] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  return crypto.subtle.timingSafeEqual(da, db);
}

export async function onRequest({ request, env, next }) {
  const { BASIC_AUTH_USER: user, BASIC_AUTH_PASS: pass } = env;
  // Secret 未設定のまま公開されないよう、設定が無ければ閉じる
  if (!user || !pass) {
    return new Response("Basic auth is not configured", { status: 503 });
  }

  const [scheme, encoded] = (request.headers.get("Authorization") ?? "").split(" ");
  if (scheme !== "Basic" || !encoded) return UNAUTHORIZED();

  let decoded;
  try {
    decoded = atob(encoded);
  } catch {
    return UNAUTHORIZED();
  }
  const sep = decoded.indexOf(":");
  if (sep === -1) return UNAUTHORIZED();

  const ok =
    (await safeEqual(decoded.slice(0, sep), user)) &
    (await safeEqual(decoded.slice(sep + 1), pass));
  if (!ok) return UNAUTHORIZED();

  const response = await next();
  const headers = new Headers(response.headers);
  headers.set("X-Robots-Tag", "noindex, nofollow");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
