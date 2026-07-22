import { copyFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import type {
  DownloadProgress,
  DownloadResult,
  ProviderAuth,
  RemoteWorkRef,
  Session,
  WorkMetadata,
} from "@erolib/shared";
import {
  fetchToFile,
  getSetCookieHeaders,
  mergeCookieHeader,
  sleep,
} from "./download-utils.js";
import type { Provider } from "./types.js";
import { DEFAULT_UA, sessionData } from "./types.js";

const BASE = "https://koe-koe.com";
const FILE_BASE = "https://file.koe-koe.com";
const REQUEST_GAP_MS = 1500;

function audioUrlForId(id: string): string {
  return `${FILE_BASE}/sound/upload/${id}.mp3`;
}

function detailUrl(id: string): string {
  return `${BASE}/detail.php?n=${encodeURIComponent(id)}`;
}
async function renameSafe(src: string, dest: string): Promise<void> {
  try {
    await rename(src, dest);
  } catch {
    await copyFile(src, dest);
    await rm(src, { force: true });
  }
}

function requireCookie(session: Session): string {
  const { cookieHeader } = sessionData(session);
  if (!cookieHeader) throw new Error("Missing Koe-koe cookie session");
  return cookieHeader;
}

async function fetchHtml(
  url: string,
  cookieHeader: string,
): Promise<{ html: string; cookieHeader: string; status: number; finalUrl: string }> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": DEFAULT_UA,
      Cookie: cookieHeader,
      Accept: "text/html,application/xhtml+xml",
      Referer: `${BASE}/`,
    },
    redirect: "follow",
  });
  const nextCookie = mergeCookieHeader(cookieHeader, getSetCookieHeaders(res));
  const html = await res.text();
  return {
    html,
    cookieHeader: nextCookie,
    status: res.status,
    finalUrl: res.url,
  };
}

function looksLoggedIn(html: string): boolean {
  if (/login\.php\?op=login/i.test(html) && /err=confirm/i.test(html)) {
    return false;
  }
  // mypage content or logout / bookmark chrome
  if (
    /ログアウト|logout|ブックマーク|マイページ|mypage\.php/i.test(html) &&
    !/name=["']pass["']/i.test(html)
  ) {
    return true;
  }
  // login form present and no user chrome → likely not logged in
  if (/name=["']pass["']/i.test(html) && /login\.php/i.test(html)) {
    return false;
  }
  // Title like マイページ without login form
  if (/マイページ/i.test(html) && !/name=["']pass["']/i.test(html)) {
    return true;
  }
  return false;
}

export function parseBookmarkIds(html: string): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  const re = /detail\.php\?n=(\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const id = m[1];
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

const TITLE_NOISE = [
  /スマートフォンから録音した音声を投稿できる/,
  /エロ声やオナニーボイス/,
  /喘ぎ声などエッチ/,
  /音声掲示板/,
  /アダルトな音声/,
  /^koe-?koe$/i,
  /^コエコエ/,
];

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function stripTags(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

/** Keep hard line breaks from <br>/<p>; collapse other whitespace. */
function stripTagsPreserveNewlines(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[^\S\n]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function isNoiseTitle(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (t.length > 120) return true;
  return TITLE_NOISE.some((re) => re.test(t));
}

function pickTitle(html: string, workId: string): string {
  const candidates: string[] = [];

  const og =
    /property=["']og:title["'][^>]*content=["']([^"']+)["']/i.exec(html) ??
    /content=["']([^"']+)["'][^>]*property=["']og:title["']/i.exec(html);
  if (og?.[1]) candidates.push(stripTags(og[1]));

  // Prefer h2 near the audio player / duration block
  const audioIdx = html.search(/<audio[\s>]|class=["'][^"']*audioTime/i);
  if (audioIdx >= 0) {
    const window = html.slice(Math.max(0, audioIdx - 2500), audioIdx + 500);
    const near = /<h2[^>]*>([\s\S]*?)<\/h2>/i.exec(window);
    if (near?.[1]) candidates.push(stripTags(near[1]));
  }

  const h2re = /<h2[^>]*>([\s\S]*?)<\/h2>/gi;
  let m: RegExpExecArray | null;
  while ((m = h2re.exec(html)) !== null) {
    if (m[1]) candidates.push(stripTags(m[1]));
  }

  const titleTag = /<title>([^<]+)<\/title>/i.exec(html);
  if (titleTag?.[1]) {
    candidates.push(
      stripTags(titleTag[1])
        .replace(/\s*[|｜\-–—].*$/, "")
        .trim(),
    );
  }

  for (const c of candidates) {
    const cleaned = c.replace(/\s*[|｜].*$/, "").trim();
    if (!isNoiseTitle(cleaned) && cleaned !== workId) return cleaned;
  }
  return workId;
}

function isNoiseDescription(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (t.length > 2000) return true;
  return TITLE_NOISE.some((re) => re.test(t));
}

function findDescDetailBlock(html: string): string | undefined {
  const detail =
    /<div[^>]*class=["'][^"']*desc[^"']*detail[^"']*["'][^>]*>([\s\S]*?)<\/div>/i.exec(
      html,
    ) ??
    /<div[^>]*class=["'][^"']*detail[^"']*desc[^"']*["'][^>]*>([\s\S]*?)<\/div>/i.exec(
      html,
    );
  return detail?.[1];
}

/**
 * Post body only: first content <p> inside div.desc.detail,
 * without author/trip/meta/bookmark chrome.
 */
function pickDescription(html: string): string | undefined {
  const block = findDescDetailBlock(html);
  if (!block) return undefined;

  const pRe = /<p\b([^>]*)>([\s\S]*?)<\/p>/gi;
  let m: RegExpExecArray | null;
  while ((m = pRe.exec(block)) !== null) {
    const attrs = m[1] ?? "";
    if (/\bclass=["'][^"']*\b(meta|b_btn)\b/i.test(attrs)) continue;

    let inner = m[2] ?? "";
    // Drop author search link / bare user_name span
    inner = inner.replace(/<a\b[^>]*>[\s\S]*?<\/a>/i, "");
    inner = inner.replace(
      /<span[^>]*class=["'][^"']*user_name[^"']*["'][^>]*>[\s\S]*?<\/span>/i,
      "",
    );

    let text = stripTagsPreserveNewlines(inner);
    // Leading trip / ナンネット ID then ":" separator left after author strip
    text = text
      .replace(/^(◆[^\s:：]+|◇ID_\d+)\s*/u, "")
      .replace(/^[:：]\s*/u, "")
      .trim();

    if (!text || isNoiseDescription(text)) continue;
    return text;
  }
  return undefined;
}

const AUTHOR_IDENTITY_RE =
  /<span[^>]*class=["'][^"']*user_name[^"']*["'][^>]*>([^<]+)<\/span>\s*(?:<\/a>)?\s*(◆[^\s<:：]+|◇ID_\d+)?/i;

/**
 * Site post time from detail/list meta: absolute `@YY/M/D` or relative
 * `@N分前` / `@N時間前` / `@N日前`. Prefer the main desc.detail block.
 */
function pickPublishedAt(html: string): {
  createdAt: string | null;
  postedAtRaw: string | null;
} {
  const scopes: string[] = [];
  const detail = findDescDetailBlock(html);
  if (detail) scopes.push(detail);
  const voiceIdx = html.search(/id=["']voice["']|id=["']text["']/i);
  if (voiceIdx >= 0) scopes.push(html.slice(voiceIdx, voiceIdx + 4000));
  scopes.push(html);

  let raw: string | null = null;
  for (const scope of scopes) {
    const m =
      /metaIcon_up[^>]*>([^<]+)/i.exec(scope) ??
      /class=["'][^"']*meta_item[^"']*["'][^>]*>\s*(@[^<\s]+)/i.exec(scope);
    if (!m?.[1]) continue;
    const text = stripTags(m[1]).trim();
    if (!text) continue;
    raw = text.startsWith("@") ? text : `@${text}`;
    break;
  }
  if (!raw) return { createdAt: null, postedAtRaw: null };

  const absolute = /^@?(?:(\d{2}|\d{4})\/(\d{1,2})\/(\d{1,2}))$/.exec(raw);
  if (absolute) {
    let year = Number.parseInt(absolute[1] ?? "0", 10);
    if (year < 100) year += 2000;
    const month = Number.parseInt(absolute[2] ?? "0", 10);
    const day = Number.parseInt(absolute[3] ?? "0", 10);
    if (
      year >= 2000 &&
      year <= 2100 &&
      month >= 1 &&
      month <= 12 &&
      day >= 1 &&
      day <= 31
    ) {
      const iso = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      return { createdAt: iso, postedAtRaw: raw };
    }
  }

  return { createdAt: null, postedAtRaw: raw };
}

function pickAuthor(html: string): {
  authorName?: string;
  authorId: string | null;
  trip?: string;
  nanId?: string;
} {
  const scopes: string[] = [];
  const detail = findDescDetailBlock(html);
  if (detail) scopes.push(detail);
  // Prefer main voice block over sidebar "注目の音声"
  const voiceIdx = html.search(/id=["']voice["']|id=["']text["']/i);
  if (voiceIdx >= 0) {
    scopes.push(html.slice(voiceIdx, voiceIdx + 4000));
  }
  scopes.push(html);

  for (const scope of scopes) {
    const m = AUTHOR_IDENTITY_RE.exec(scope);
    if (!m?.[1]) continue;
    const base = decodeURIComponent(stripTags(m[1])).trim();
    if (!base) continue;
    const marker = m[2]?.trim();
    let trip: string | undefined;
    let nanId: string | undefined;
    if (marker?.startsWith("◆")) trip = marker.slice(1);
    else if (marker?.startsWith("◇")) nanId = marker.slice(1); // ID_xxxxx
    const full = marker ? `${base}${marker}` : base;
    return { authorName: full, authorId: full, trip, nanId };
  }

  // Fallback: search.php?word= (base name only, no trip)
  const authorLink = /search\.php\?word=([^&"']+)/i.exec(html);
  if (authorLink?.[1]) {
    const base = decodeURIComponent(authorLink[1]).trim();
    if (base) return { authorName: base, authorId: base };
  }
  return { authorId: null };
}

export function parseDetail(html: string, workId: string): WorkMetadata {
  const title = pickTitle(html, workId);

  const sourceMatch =
    /<source[^>]+src=["']([^"']+)["'][^>]*>/i.exec(html) ??
    /file\.koe-koe\.com\/sound\/upload\/(\d+)\.mp3/i.exec(html);

  let audioUrl = audioUrlForId(workId);
  if (sourceMatch?.[1]) {
    const src = sourceMatch[1];
    audioUrl = src.startsWith("//")
      ? `https:${src}`
      : src.startsWith("http")
        ? src
        : audioUrlForId(workId);
  } else if (sourceMatch?.[0] && !sourceMatch[1]) {
    // matched bare file.koe-koe path with capture group only on id form
    const idOnly = /file\.koe-koe\.com\/sound\/upload\/(\d+)\.mp3/i.exec(html);
    if (idOnly?.[1]) audioUrl = audioUrlForId(idOnly[1]);
  }

  const author = pickAuthor(html);
  const authorName = author.authorName;
  const authorId = author.authorId;

  const durationMatch =
    /audioTime[^>]*>([^<]+)</i.exec(html) ??
    /(\d+)\s*分\s*(\d+)\s*秒/.exec(html);
  let durationSeconds: number | null = null;
  if (durationMatch) {
    const text = durationMatch[0];
    const min = /(\d+)\s*分/.exec(text);
    const sec = /(\d+)\s*秒/.exec(text);
    durationSeconds =
      (min ? Number.parseInt(min[1] ?? "0", 10) * 60 : 0) +
      (sec ? Number.parseInt(sec[1] ?? "0", 10) : 0);
    if (durationSeconds === 0) durationSeconds = null;
  }

  // Koe-koe has no real cover/avatar — gender icons must not become coverUrl.
  let gender: string | undefined;
  const iconMatch = /src=["']\/img\/(female|male|couple)[^"']*["']/i.exec(html);
  if (iconMatch?.[1]) gender = iconMatch[1].toLowerCase();

  const description = pickDescription(html);
  const published = pickPublishedAt(html);

  const extra: Record<string, unknown> = {};
  if (gender) extra.gender = gender;
  if (author.trip) extra.trip = author.trip;
  if (author.nanId) extra.nanId = author.nanId;
  if (published.postedAtRaw) extra.postedAtRaw = published.postedAtRaw;

  return {
    provider: "koekoe",
    workId,
    authorId,
    authorName,
    title,
    description,
    durationSeconds,
    audioUrl,
    coverUrl: null,
    sourceUrl: detailUrl(workId),
    createdAt: published.createdAt,
    extra,
  };
}

/** Next mypage page number from prev/next-only pager (`null` if last page). */
export function parseNextMypagePage(html: string): number | null {
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const href = m[1] ?? "";
    if (!/mypage\.php/i.test(href)) continue;
    const text = stripTags(m[2] ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
    if (text !== "next" && text !== "次" && text !== "次へ") continue;
    const pageMatch = /[?&]p=(\d+)/i.exec(href);
    if (!pageMatch?.[1]) continue;
    const n = Number.parseInt(pageMatch[1], 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

/**
 * Next page for list.php / search.php (numeric pager or next link).
 * Returns null when there is no higher page.
 */
export function parseNextListPage(
  html: string,
  currentPage: number,
): number | null {
  let maxPage = currentPage;
  const hrefRe =
    /href=["']([^"']*(?:list|search)\.php[^"']*)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = hrefRe.exec(html)) !== null) {
    const href = m[1] ?? "";
    const pageMatch = /[?&]p=(\d+)/i.exec(href);
    if (!pageMatch?.[1]) continue;
    const n = Number.parseInt(pageMatch[1], 10);
    if (Number.isFinite(n) && n > maxPage) maxPage = n;
  }
  // Prefer explicit "next" link when present
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  while ((m = re.exec(html)) !== null) {
    const href = m[1] ?? "";
    if (!/(?:list|search)\.php/i.test(href)) continue;
    const text = stripTags(m[2] ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
    if (text !== "next" && text !== "次" && text !== "次へ" && text !== ">>") {
      continue;
    }
    const pageMatch = /[?&]p=(\d+)/i.exec(href);
    if (!pageMatch?.[1]) continue;
    const n = Number.parseInt(pageMatch[1], 10);
    if (Number.isFinite(n) && n > currentPage) return n;
  }
  if (maxPage > currentPage) {
    // Step one page at a time rather than jumping to the last page number.
    return currentPage + 1;
  }
  return null;
}

/**
 * Unique author identities from search/list HTML.
 * Prefer list-card `.entry_auth` (common on search.php) then `.user_name` /
 * author search links. authorId = display name (+ optional trip/nan marker).
 */
export function parseAuthorSearchHits(
  html: string,
  query?: string,
): Array<{
  authorId: string;
  username: string | null;
  displayName: string | null;
}> {
  const byId = new Map<
    string,
    { authorId: string; username: string | null; displayName: string | null }
  >();

  const upsert = (authorId: string, displayName: string | null) => {
    const id = authorId.trim();
    if (!id) return;
    if (byId.has(id)) return;
    byId.set(id, {
      authorId: id,
      username: id,
      displayName: displayName?.trim() || id,
    });
  };

  const safeDecode = (raw: string): string => {
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  };

  // List cards: <span class="entry_auth">名前</span> optional ◆trip / ◇ID_n
  const entryRe =
    /class=["'][^"']*entry_auth[^"']*["'][^>]*>([^<]+)<\/span>\s*(◆[^\s<:：]+|◇ID_\d+)?/gi;
  let m: RegExpExecArray | null;
  while ((m = entryRe.exec(html)) !== null) {
    const base = safeDecode(stripTags(m[1] ?? "")).trim();
    if (!base) continue;
    const marker = m[2]?.trim();
    const full = marker ? `${base}${marker}` : base;
    upsert(full, full);
  }

  // Detail-style: user_name spans (with optional trip / ナンネット marker)
  const userRe =
    /<span[^>]*class=["'][^"']*user_name[^"']*["'][^>]*>([^<]+)<\/span>\s*(?:<\/a>)?\s*(◆[^\s<:：]+|◇ID_\d+)?/gi;
  while ((m = userRe.exec(html)) !== null) {
    const base = safeDecode(stripTags(m[1] ?? "")).trim();
    if (!base) continue;
    const marker = m[2]?.trim();
    const full = marker ? `${base}${marker}` : base;
    upsert(full, full);
  }

  // post_users.php / author links: search.php?word=NAME
  const linkRe = /search\.php\?word=([^&"']+)/gi;
  while ((m = linkRe.exec(html)) !== null) {
    const base = safeDecode(m[1] ?? "").trim();
    if (base) upsert(base, base);
  }

  let rows = [...byId.values()];
  const q = query?.trim();
  if (q) {
    const qLower = q.toLowerCase();
    const filtered = rows.filter((r) => {
      const id = r.authorId.toLowerCase();
      const name = (r.displayName ?? "").toLowerCase();
      return id.includes(qLower) || name.includes(qLower);
    });
    // Keep filter when it still finds someone; otherwise keep unfiltered
    // (exact author-mode pages may only list works for that author).
    if (filtered.length > 0) rows = filtered;
  }
  return rows.slice(0, 20);
}

async function fetchKoeKoeHtml(
  url: string,
  cookieHeader?: string | null,
): Promise<string> {
  const headers: Record<string, string> = {
    "User-Agent": DEFAULT_UA,
    Accept: "text/html,application/xhtml+xml",
    Referer: `${BASE}/`,
  };
  if (cookieHeader?.trim()) headers.Cookie = cookieHeader.trim();
  const res = await fetch(url, { headers, redirect: "follow" });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`Koe-koe author search failed: HTTP ${res.status}`);
  }
  return res.text();
}

/**
 * Author search: author-mode search + full search + post_users directory filter.
 * Cookie optional (public pages).
 */
export async function searchKoeKoeAuthors(
  query: string,
  cookieHeader?: string | null,
): Promise<
  Array<{ authorId: string; username: string | null; displayName: string | null }>
> {
  const q = query.trim();
  if (!q) return [];
  const byId = new Map<
    string,
    { authorId: string; username: string | null; displayName: string | null }
  >();
  const merge = (
    rows: Array<{
      authorId: string;
      username: string | null;
      displayName: string | null;
    }>,
  ) => {
    for (const r of rows) {
      if (!r.authorId || byId.has(r.authorId)) continue;
      byId.set(r.authorId, r);
    }
  };

  const urls = [
    `${BASE}/search.php?word=${encodeURIComponent(q)}&m=1&p=1`,
    `${BASE}/search.php?word=${encodeURIComponent(q)}&p=1`,
    `${BASE}/post_users.php?g=1`,
    `${BASE}/post_users.php?g=2`,
  ];

  let firstError: Error | null = null;
  for (const url of urls) {
    try {
      const html = await fetchKoeKoeHtml(url, cookieHeader);
      // Directory pages: always filter by query; search pages use parse filter.
      const isDir = url.includes("post_users.php");
      merge(parseAuthorSearchHits(html, isDir ? q : q));
    } catch (err) {
      if (!firstError && err instanceof Error) firstError = err;
    }
  }

  const out = [...byId.values()].slice(0, 20);
  if (out.length === 0 && firstError) throw firstError;
  return out;
}

/**
 * Normalize author identity for comparison: trim + unify trip slash form.
 * Site / UI may store trip as `◆/` or `◆_`.
 */
export function normalizeKoeKoeAuthorKey(id: string): string {
  return id.trim().replace(/◆_/g, "◆/");
}

/**
 * Search word for author-mode search.php: base display name only.
 * Full trip identity as `word` returns empty results on the site.
 */
export function koeKoeAuthorSearchBase(id: string): string {
  const norm = normalizeKoeKoeAuthorKey(id);
  // Strip trailing trip (◆…) or ナンネット (◇ID_…) marker.
  const stripped = norm.replace(/(?:◆[^\s]+|◇ID_\d+)\s*$/u, "").trim();
  return stripped || norm;
}

function hasTripOrNanMarker(normalizedId: string): boolean {
  return /(?:◆|◇ID_\d+)/u.test(normalizedId);
}

/**
 * Whether a list-card author matches a subscription authorId.
 * - Exact match after normalize (◆_ ↔ ◆/).
 * - If subscription has no trip/nan marker, allow base-name match.
 * - If subscription has trip/nan, require full identity (no same-base strangers).
 */
export function koeKoeAuthorMatches(
  refAuthorId: string | null | undefined,
  subscriptionAuthorId: string,
): boolean {
  const sub = normalizeKoeKoeAuthorKey(subscriptionAuthorId);
  if (!sub) return false;
  const ref = normalizeKoeKoeAuthorKey(refAuthorId ?? "");
  if (!ref) return false;
  if (ref === sub) return true;

  const subHasMarker = hasTripOrNanMarker(sub);
  if (!subHasMarker) {
    // Subscription is base-only: accept base or base+any marker for same base.
    const refBase = koeKoeAuthorSearchBase(ref);
    return refBase === sub;
  }

  // Subscription has full trip/nan identity — require exact match only
  // (do not accept other same-base authors or ambiguous base-only cards).
  return false;
}

/**
 * Title for a list.php / search.php card.
 * Real cards wrap duration + author + title + コメ/いいね inside one <a>;
 * never use the full stripped anchor text as the title.
 */
function pickListCardTitle(window: string, workId: string): string | undefined {
  // 1. <p class="desc_auth_title">…entry_auth… : {title}</p>
  const authTitle =
    /class=["'][^"']*desc_auth_title[^"']*["'][^>]*>([\s\S]*?)<\/p>/i.exec(
      window,
    );
  if (authTitle?.[1]) {
    const text = stripTags(authTitle[1]);
    if (/[:：]/u.test(text)) {
      const afterColon = text.replace(/^[\s\S]*?[:：]\s*/u, "").trim();
      if (afterColon && !isNoiseTitle(afterColon) && afterColon !== workId) {
        return afterColon;
      }
    }
  }

  // 2. <a title="「author(gender)/title」の投稿">
  const attr =
    /\btitle=["']「([^"']+)」の投稿["']/i.exec(window) ??
    /\btitle=["']([^"']+)["']/i.exec(window);
  if (attr?.[1]) {
    let t = decodeEntities(attr[1]).trim();
    // 「黒猫(女性)/実タイトル」 or bare 「タイトル」
    const gendered = /^[\s\S]*?\((?:女性|男性|カップル)\)\/([\s\S]+)$/u.exec(t);
    if (gendered?.[1]) {
      t = gendered[1].trim();
    } else {
      const slash = t.indexOf("/");
      if (slash >= 0) t = t.slice(slash + 1).trim();
    }
    t = t.replace(/の投稿\s*$/u, "").trim();
    if (t && !isNoiseTitle(t) && t !== workId) return t;
  }

  // 3. Rare: h2 near the link (opening tag may sit just before href)
  const h2 =
    /<h2[^>]*>([\s\S]*?)<\/h2>/i.exec(window) ??
    />([\s\S]*?)<\/h2>/i.exec(window);
  if (h2?.[1]) {
    // Prefer text of an inner link if present, else whole h2 body
    const innerA = /<a\b[^>]*>([\s\S]*?)<\/a>/i.exec(h2[1]);
    const t = stripTags(innerA?.[1] ?? h2[1]);
    if (t && !isNoiseTitle(t) && t !== workId) return t;
  }

  // 4. Short plain-text anchor only — never the full list-card blob
  const titleLink =
    /detail\.php\?n=\d+[^"']*["'][^>]*>([\s\S]*?)<\/a>/i.exec(window);
  if (titleLink?.[1]) {
    const inner = titleLink[1];
    if (
      !/desc_auth_title|audioTime|meta_item|entry_auth|コメ\s*:|いいね\s*:/i.test(
        inner,
      )
    ) {
      const t = stripTags(inner);
      if (t && t.length <= 80 && !isNoiseTitle(t) && t !== workId) return t;
    }
  }

  return undefined;
}

/** List-card rows from list.php / search.php HTML. */
export function parseListCards(
  html: string,
  authorHint?: string,
): RemoteWorkRef[] {
  const refs: RemoteWorkRef[] = [];
  const seen = new Set<string>();
  // Split on detail links; pull nearby title/author when present.
  // Card body (desc_auth_title / meta) sits after href — use a forward window
  // so the previous card's entry_auth is not preferred.
  const re = /detail\.php\?n=(\d+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const id = m[1];
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const idx = m.index;
    const window = html.slice(idx, Math.min(html.length, idx + 1200));
    const title = pickListCardTitle(window, id);
    let authorName: string | undefined;
    let authorId: string | null = authorHint?.trim() || null;
    const user = AUTHOR_IDENTITY_RE.exec(window);
    const entryAuth =
      /class=["'][^"']*entry_auth[^"']*["'][^>]*>([^<]+)<\/span>\s*(◆[^\s<:：]+|◇ID_\d+)?/i.exec(
        window,
      );
    const identity = user ?? entryAuth;
    if (identity?.[1]) {
      const base = decodeURIComponent(stripTags(identity[1])).trim();
      const marker = identity[2]?.trim();
      if (base) {
        authorName = marker ? `${base}${marker}` : base;
        authorId = authorName;
      }
    } else if (authorHint?.trim()) {
      authorName = authorHint.trim();
    }
    refs.push({
      provider: "koekoe",
      workId: id,
      authorId,
      title,
      authorName,
    });
  }
  return refs;
}

export const koekoeProvider: Provider = {
  id: "koekoe",

  async login(auth: ProviderAuth): Promise<Session> {
    if (auth.mode === "cookie") {
      const cookie = auth.cookieHeader?.trim();
      if (!cookie) throw new Error("Cookie header required");
      const probe = await fetchHtml(`${BASE}/mypage.php`, cookie);
      if (!looksLoggedIn(probe.html) || probe.status >= 400) {
        throw new Error("Koe-koe cookie session invalid (mypage check failed)");
      }
      return {
        provider: "koekoe",
        data: { cookieHeader: probe.cookieHeader },
      };
    }

    const id = auth.username?.trim();
    const pass = auth.password;
    if (!id || !pass) throw new Error("id and pass required");

    // Bootstrap PHPSESSID
    const boot = await fetch(`${BASE}/login.php?op=login`, {
      headers: { "User-Agent": DEFAULT_UA },
      redirect: "follow",
    });
    let cookieHeader = mergeCookieHeader(undefined, getSetCookieHeaders(boot));
    await boot.text();

    const body = new URLSearchParams({ id, pass });
    const res = await fetch(`${BASE}/login.php`, {
      method: "POST",
      headers: {
        "User-Agent": DEFAULT_UA,
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: cookieHeader,
        Origin: BASE,
        Referer: `${BASE}/login.php?op=login`,
      },
      body,
      redirect: "manual",
    });
    cookieHeader = mergeCookieHeader(cookieHeader, getSetCookieHeaders(res));

    // Success and failure both 302. Failure: ...&err=confirm (or bare
    // login.php without login_token). Success also lands on login.php but
    // sets login_token — never treat bare login.php alone as rejection.
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location") ?? "";
      if (/err=confirm/i.test(loc)) {
        throw new Error("Koe-koe login failed (credentials rejected)");
      }
    } else if (res.status >= 400) {
      throw new Error(`Koe-koe login failed: HTTP ${res.status}`);
    }

    const hasLoginToken = /(?:^|;\s*)login_token=/i.test(cookieHeader);
    const my = await fetchHtml(`${BASE}/mypage.php`, cookieHeader);
    if (!looksLoggedIn(my.html)) {
      throw new Error(
        hasLoginToken
          ? "Koe-koe login failed (mypage not authenticated)"
          : "Koe-koe login failed (credentials rejected)",
      );
    }
    return {
      provider: "koekoe",
      data: { cookieHeader: my.cookieHeader },
    };
  },

  async isSessionValid(session: Session): Promise<boolean> {
    try {
      const cookie = requireCookie(session);
      const my = await fetchHtml(`${BASE}/mypage.php`, cookie);
      return looksLoggedIn(my.html);
    } catch {
      return false;
    }
  },

  async *listFavorites(session: Session): AsyncIterable<RemoteWorkRef> {
    let cookie = requireCookie(session);
    const seen = new Set<string>();
    // mypage only exposes prev/next links — never a final page number.
    // Follow `next` until exhausted (same pattern as otobanana/erovoice).
    const MAX_PAGES = 200;
    let pageNum = 1;

    for (let guard = 0; guard < MAX_PAGES; guard += 1) {
      await sleep(REQUEST_GAP_MS);
      const url =
        pageNum <= 1
          ? `${BASE}/mypage.php`
          : `${BASE}/mypage.php?p=${pageNum}`;
      const page = await fetchHtml(url, cookie);
      cookie = page.cookieHeader;
      if (!looksLoggedIn(page.html)) {
        if (guard === 0) {
          throw new Error("Koe-koe session expired during listFavorites");
        }
        break;
      }

      let newCount = 0;
      for (const id of parseBookmarkIds(page.html)) {
        if (seen.has(id)) continue;
        seen.add(id);
        newCount += 1;
        yield {
          provider: "koekoe",
          workId: id,
          authorId: null,
          title: undefined,
        };
      }

      const next = parseNextMypagePage(page.html);
      if (next == null || next <= pageNum || newCount === 0) break;
      pageNum = next;
    }

    // Persist refreshed cookie onto session object for caller if they re-save
    session.data.cookieHeader = cookie;
  },

  async *listAuthorWorks(
    session: Session,
    authorId: string,
  ): AsyncIterable<RemoteWorkRef> {
    // Author search is public (m=1); cookie optional but refreshed when present.
    // Site returns 0 results when m=1 without g, or when word is full trip id.
    let cookie = sessionData(session).cookieHeader ?? "";
    const name = authorId.trim();
    if (!name) throw new Error("Koe-koe author name required");

    const searchWord = koeKoeAuthorSearchBase(name);
    if (!searchWord) throw new Error("Koe-koe author name required");

    const seen = new Set<string>();
    const MAX_PAGES = 200;
    // g=1 female, g=2 male — must pass g with m=1 or the site returns empty.
    const genders = ["1", "2"] as const;

    for (const g of genders) {
      let pageNum = 1;
      for (let guard = 0; guard < MAX_PAGES; guard += 1) {
        await sleep(REQUEST_GAP_MS);
        const qs = new URLSearchParams({
          word: searchWord,
          m: "1",
          g,
          p: String(pageNum),
        });
        const page = await fetchHtml(
          `${BASE}/search.php?${qs.toString()}`,
          cookie,
        );
        cookie = page.cookieHeader || cookie;
        if (page.status >= 400) {
          throw new Error(`Koe-koe author search HTTP ${page.status}`);
        }

        const cards = parseListCards(page.html, searchWord);
        // Empty page ends pagination. Filter may reject same-base strangers;
        // still advance when the site has more pages so trip authors are not
        // skipped if their works appear after other same-base rows.
        if (cards.length === 0) break;

        for (const ref of cards) {
          if (seen.has(ref.workId)) continue;
          const cardAuthor = ref.authorId ?? ref.authorName;
          if (!koeKoeAuthorMatches(cardAuthor, name)) continue;
          seen.add(ref.workId);
          yield ref;
        }

        const next = parseNextListPage(page.html, pageNum);
        if (next == null || next <= pageNum) break;
        pageNum = next;
      }
    }

    if (cookie) session.data.cookieHeader = cookie;
  },

  async getWork(session: Session, workId: string): Promise<WorkMetadata> {
    const cookie = requireCookie(session);
    await sleep(REQUEST_GAP_MS);
    const page = await fetchHtml(detailUrl(workId), cookie);
    if (page.status >= 400) {
      throw new Error(`Koe-koe detail ${workId} HTTP ${page.status}`);
    }
    return parseDetail(page.html, workId);
  },

  async download(
    _session: Session,
    work: WorkMetadata,
    cacheDir: string,
    onProgress?: (p: DownloadProgress) => void,
  ): Promise<DownloadResult> {
    await sleep(REQUEST_GAP_MS);
    const audioTmp = path.join(cacheDir, "audio.download");
    const audio = await fetchToFile({
      url: work.audioUrl || audioUrlForId(work.workId),
      destPath: audioTmp,
      onProgress,
    });
    const audioExt = audio.ext === "bin" ? "mp3" : audio.ext;
    const audioFinal = path.join(cacheDir, `audio.${audioExt}`);
    await renameSafe(audio.path, audioFinal);

    let coverPath: string | null = null;
    if (work.coverUrl) {
      try {
        const coverTmp = path.join(cacheDir, "cover.download");
        const cover = await fetchToFile({
          url: work.coverUrl,
          destPath: coverTmp,
        });
        const coverExt = cover.ext === "bin" ? "png" : cover.ext;
        coverPath = path.join(cacheDir, `cover.${coverExt}`);
        await renameSafe(cover.path, coverPath);
      } catch {
        coverPath = null;
      }
    }

    return {
      audioPath: audioFinal,
      audioExt,
      coverPath,
      checksumSha256: audio.sha256,
      bytes: audio.bytes,
      meta: work,
    };
  },
};
