import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type {
  DownloadProgress,
  DownloadResult,
  ProviderAuth,
  RemoteWorkRef,
  Session,
  WorkMetadata,
} from "@erolib/shared";
import { setTimeout as sleep } from "node:timers/promises";
import {
  fetchToFile,
  getSetCookieHeaders,
  mergeCookieHeader,
} from "./download-utils.js";
import { transcodeToMp3 } from "./ffmpeg.js";
import { downloadHlsToTs, parseM3u8 } from "./hls.js";
import { isRecord } from "../lib/utils.js";
import { decodeHtmlEntities, stripTags } from "../lib/html.js";
import type { Provider } from "./types.js";
import { DEFAULT_UA, sessionData } from "./types.js";
import { renameOrCopy } from "../storage/paths.js";

const BASE = "https://erovoice-ch.com";
const AJAX = `${BASE}/wp-admin/admin-ajax.php`;
const THEME_LIBS = `${BASE}/wp-content/themes/erovoice-ch/libs`;
const REQUEST_GAP_MS = 400;
const BOOKMARK_PAGE = 50;
const MAX_BOOKMARK_PAGES = 200;

const DETAIL_CATEGORIES = ["ero-voice", "ero-asmr", "moe-asmr"] as const;

const DETAIL_CATEGORY_SET: Record<string, true> = {
  "ero-voice": true,
  "ero-asmr": true,
  "moe-asmr": true,
};

const RESERVED_PATH_SEGMENTS: Record<string, true> = {
  voice: true,
  category: true,
  "wp-content": true,
  "wp-admin": true,
  allsearch: true,
  ranking: true,
  mypage: true,
  login: true,
  logout: true,
  register: true,
  signup: true,
  search: true,
  page: true,
  tag: true,
  tags: true,
  timeline: true,
  notice: true,
  notification: true,
  notifications: true,
  feed: true,
  rss: true,
  api: true,
  user: true,
  users: true,
  author: true,
  live: true,
  home: true,
  index: true,
  about: true,
  help: true,
  contact: true,
  settings: true,
  account: true,
};
function requireCookie(session: Session): string {
  const { cookieHeader } = sessionData(session);
  if (!cookieHeader) throw new Error("Missing Erovoice cookie session");
  return cookieHeader;
}

function siteHeaders(
  cookieHeader: string,
  extra?: Record<string, string>,
): Record<string, string> {
  return {
    "User-Agent": DEFAULT_UA,
    Cookie: cookieHeader,
    Origin: BASE,
    Referer: `${BASE}/`,
    Accept: "*/*",
    ...extra,
  };
}

function readStringField(obj: Record<string, unknown>, key: string): string | null {
  const v = obj[key];
  return typeof v === "string" ? v : null;
}

function readNumberishField(
  obj: Record<string, unknown>,
  key: string,
): string | null {
  const v = obj[key];
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v === "string" && v.trim()) return v.trim();
  return null;
}

function parseDurationSeconds(text: string): number | null {
  const t = text.trim();
  const hms = /^(\d+):(\d{1,2}):(\d{1,2})$/.exec(t);
  if (hms) {
    const h = Number.parseInt(hms[1] ?? "0", 10);
    const m = Number.parseInt(hms[2] ?? "0", 10);
    const s = Number.parseInt(hms[3] ?? "0", 10);
    return h * 3600 + m * 60 + s;
  }
  const ms = /^(\d+):(\d{1,2})$/.exec(t);
  if (ms) {
    const m = Number.parseInt(ms[1] ?? "0", 10);
    const s = Number.parseInt(ms[2] ?? "0", 10);
    return m * 60 + s;
  }
  return null;
}

/**
 * WordPress sized derivatives look like `name-113x150.webp`.
 * Prefer the unsized original upload URL when present.
 */
export function preferOriginalImageUrl(url: string): string {
  try {
    const u = new URL(url);
    u.pathname = u.pathname.replace(/-\d+x\d+(?=\.[a-z0-9]+$)/i, "");
    return u.href;
  } catch {
    return url.replace(/-\d+x\d+(?=\.[a-z0-9]+(?:\?|#|$))/i, "");
  }
}

function absolutizeUrl(raw: string): string {
  if (raw.startsWith("//")) return `https:${raw}`;
  if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
  return new URL(raw, BASE).href;
}

/** Site chrome / default icons — never use as work cover. */
export function isRejectedCoverUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return (
    /\/top2\.png(?:\?|$)/i.test(lower) ||
    /img_siterogo/i.test(lower) ||
    /bg_(?:menu|mypage|notification|timeline)/i.test(lower) ||
    /ico_bookmark/i.test(lower) ||
    /\/favicon/i.test(lower) ||
    /apple-touch-icon/i.test(lower)
  );
}

function isUploadImageUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (
      host !== "data.erovoice-ch.com" &&
      host !== "erovoice-ch.com" &&
      host !== "www.erovoice-ch.com"
    ) {
      return false;
    }
    return /\/wp-content\/uploads\//i.test(u.pathname);
  } catch {
    return false;
  }
}

function pushCoverCandidate(out: string[], raw: string | undefined): void {
  if (!raw?.trim()) return;
  const abs = preferOriginalImageUrl(absolutizeUrl(raw.trim()));
  if (!isUploadImageUrl(abs)) return;
  if (isRejectedCoverUrl(abs)) return;
  if (!out.includes(abs)) out.push(abs);
}

/**
 * Prefer full-res work cover from detail HTML.
 * Covers may live on either erovoice-ch.com or data.erovoice-ch.com.
 * Never fall back to arbitrary first CDN image (often default headphones icon).
 */
export function extractCoverUrl(html: string): string | null {
  const candidates: string[] = [];

  const filterInPreview =
    /id=["']voiceImagePreview["'][\s\S]{0,2000}?filterImage[^>]*style=["'][^"']*background-image\s*:\s*url\((['"]?)([^'")]+)\1\)/i.exec(
      html,
    );
  pushCoverCandidate(candidates, filterInPreview?.[2]);

  const filterAny =
    /filterImage[^>]*style=["'][^"']*background-image\s*:\s*url\((['"]?)([^'")]+)\1\)/i.exec(
      html,
    );
  pushCoverCandidate(candidates, filterAny?.[2]);

  const previewImg =
    /id=["']voiceImagePreview["'][\s\S]{0,2000}?<img[^>]+src=["']([^"']+)["']/i.exec(
      html,
    );
  pushCoverCandidate(candidates, previewImg?.[1]);

  const smallImg =
    /class=["'][^"']*audioSmallImage[^"']*["'][^>]+src=["']([^"']+)["']/i.exec(
      html,
    ) ??
    /class=["'][^"']*postImage[^"']*["'][\s\S]{0,400}?<img[^>]+src=["']([^"']+)["']/i.exec(
      html,
    );
  pushCoverCandidate(candidates, smallImg?.[1]);

  const og =
    /property=["']og:image["'][^>]*content=["']([^"']+)["']/i.exec(html) ??
    /content=["']([^"']+)["'][^>]*property=["']og:image["']/i.exec(html);
  pushCoverCandidate(candidates, og?.[1]);

  return candidates[0] ?? null;
}


export interface BookmarkCard {
  workId: string;
  title?: string;
  authorId: string | null;
  authorName?: string;
  category?: string;
}

/** Extract work cards from bookmark / list HTML fragments. */
export function parseBookmarkHtml(html: string): BookmarkCard[] {
  const cards: BookmarkCard[] = [];
  const seen = new Set<string>();

  // Prefer data-postid anchors if present.
  const dataRe = /data-postid=["'](\d+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = dataRe.exec(html)) !== null) {
    const id = m[1];
    if (!id || seen.has(id)) continue;
    seen.add(id);
    cards.push({ workId: id, authorId: null });
  }

  // Detail links: /ero-voice/123.html (absolute or relative)
  const linkRe =
    /href=["'](?:https?:\/\/erovoice-ch\.com)?\/(ero-voice|ero-asmr|moe-asmr)\/(\d+)\.html["']([^>]*)>/gi;
  while ((m = linkRe.exec(html)) !== null) {
    const category = m[1];
    const id = m[2];
    const attrs = m[3] ?? "";
    if (!id) continue;
    let card = cards.find((c) => c.workId === id);
    if (!card) {
      card = { workId: id, authorId: null, category: category ?? undefined };
      seen.add(id);
      cards.push(card);
    } else if (!card.category && category) {
      card.category = category;
    }
    const titleAttr = /title=["']([^"']+)["']/i.exec(attrs);
    if (titleAttr?.[1] && !card.title) {
      card.title = decodeHtmlEntities(titleAttr[1]).trim();
    }
  }

  // Author slug near card — best-effort per workId window.
  for (const card of cards) {
    const id = card.workId;
    const idx = html.indexOf(id);
    if (idx < 0) continue;
    const window = html.slice(Math.max(0, idx - 800), idx + 1200);
    const authorHref =
      /href=["'](?:https?:\/\/erovoice-ch\.com)?\/([a-zA-Z0-9_-]{2,64})\/?["']/i.exec(
        window,
      );
    if (authorHref?.[1] && !DETAIL_CATEGORY_SET[authorHref[1]]) {
      const slug = authorHref[1];
      if (!RESERVED_PATH_SEGMENTS[slug]) {
        card.authorId = slug;
      }
    }
    const titleM =
      /class=["'][^"']*title[^"']*["'][^>]*>([\s\S]*?)<\/(?:a|h\d|div|span)>/i.exec(
        window,
      ) ?? /<h[23][^>]*>([\s\S]*?)<\/h[23]>/i.exec(window);
    if (!card.title && titleM?.[1]) {
      const title = stripTags(titleM[1]);
      if (title) card.title = title;
    }
    const authorNameM =
      /class=["'][^"']*authorUser[^"']*["'][^>]*>([\s\S]*?)<\//i.exec(window);
    if (authorNameM?.[1]) {
      const name = stripTags(authorNameM[1]);
      if (name) card.authorName = name;
    }
  }

  return cards;
}
export function parseDetailHtml(
  html: string,
  workId: string,
  sourceUrl: string,
): WorkMetadata {
  let title = "";
  const og =
    /property=["']og:title["'][^>]*content=["']([^"']+)["']/i.exec(html) ??
    /content=["']([^"']+)["'][^>]*property=["']og:title["']/i.exec(html);
  if (og?.[1]) title = decodeHtmlEntities(og[1]).trim();
  if (!title) {
    const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
    if (h1?.[1]) title = stripTags(h1[1]);
  }
  if (!title) {
    const t = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
    if (t?.[1]) {
      title = stripTags(t[1]).replace(/\s*[|\-–].*$/, "").trim();
    }
  }
  if (!title) title = workId;

  let description: string | undefined;
  // Live site uses <article class="discContent">; older fixtures may use <div>.
  // Must close on the same element type — a bare </div> match overruns into #respond.
  const disc =
    /class=["'][^"']*discContent[^"']*["'][^>]*>([\s\S]*?)<\/(?:article|div)>/i.exec(
      html,
    );
  if (disc?.[1]) {
    const d = stripTags(disc[1]);
    if (d) description = d;
  }
  if (!description) {
    const ogDesc =
      /property=["']og:description["'][^>]*content=["']([^"']+)["']/i.exec(
        html,
      ) ??
      /content=["']([^"']+)["'][^>]*property=["']og:description["']/i.exec(
        html,
      ) ??
      /name=["']description["'][^>]*content=["']([^"']+)["']/i.exec(html) ??
      /content=["']([^"']+)["'][^>]*name=["']description["']/i.exec(html);
    if (ogDesc?.[1]) {
      const d = decodeHtmlEntities(ogDesc[1]).trim();
      if (d) description = d;
    }
  }

  let authorId: string | null = null;
  let authorName: string | undefined;
  const authorUser =
    /class=["'][^"']*authorUser[^"']*["'][^>]*>([\s\S]*?)<\//i.exec(html);
  if (authorUser?.[1]) authorName = stripTags(authorUser[1]) || undefined;

  const authorLink =
    /href=["'](?:https?:\/\/erovoice-ch\.com)?\/([a-zA-Z0-9_-]{2,64})\/?["'][^>]*>[\s\S]{0,80}class=["'][^"']*authorUser/i.exec(
      html,
    ) ??
    /class=["'][^"']*authorUser[\s\S]{0,120}?href=["'](?:https?:\/\/erovoice-ch\.com)?\/([a-zA-Z0-9_-]{2,64})\/?/i.exec(
      html,
    );
  if (authorLink?.[1]) authorId = authorLink[1];
  if (!authorId && authorName) authorId = authorName;

  const coverUrl = extractCoverUrl(html);

  const tags: string[] = [];
  const tagRe = /class=["'][^"']*voiceTags[\s\S]*?<li[^>]*>([\s\S]*?)<\/li>/gi;
  let tm: RegExpExecArray | null;
  // broader: all lis inside voiceTags container
  const tagsBlock = /class=["'][^"']*voiceTags[^"']*["'][^>]*>([\s\S]*?)<\/ul>/i.exec(
    html,
  );
  if (tagsBlock?.[1]) {
    const liRe = /<li[^>]*>([\s\S]*?)<\/li>/gi;
    while ((tm = liRe.exec(tagsBlock[1])) !== null) {
      const tag = stripTags(tm[1] ?? "");
      if (tag) tags.push(tag);
    }
  } else {
    while ((tm = tagRe.exec(html)) !== null) {
      const tag = stripTags(tm[1] ?? "");
      if (tag) tags.push(tag);
    }
  }

  let durationSeconds: number | null = null;
  const durM =
    /class=["'][^"']*controls__total-time[^"']*["'][^>]*>([\s\S]*?)<\//i.exec(
      html,
    ) ?? /controls__total-time[^>]*>([\s\S]*?)<\//i.exec(html);
  if (durM?.[1]) durationSeconds = parseDurationSeconds(stripTags(durM[1]));

  let category: string | undefined;
  const catM = /\/(ero-voice|ero-asmr|moe-asmr)\//i.exec(sourceUrl);
  if (catM?.[1]) category = catM[1];

  const audioUrl = `${THEME_LIBS}/getm3u8file_origints.php?id=${encodeURIComponent(workId)}`;

  return {
    provider: "erovoice",
    workId,
    authorId,
    authorName,
    title,
    description,
    durationSeconds,
    audioUrl,
    coverUrl,
    sourceUrl,
    tags: tags.length ? tags : undefined,
    extra: category ? { category } : {},
  };
}

async function ajaxAction(
  cookieHeader: string,
  fields: Record<string, string>,
): Promise<{ json: unknown; cookieHeader: string; status: number }> {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);

  const res = await fetch(AJAX, {
    method: "POST",
    headers: siteHeaders(cookieHeader, {
      "X-Requested-With": "XMLHttpRequest",
      Accept: "application/json, text/javascript, */*;q=0.01",
    }),
    body: form,
    redirect: "follow",
  });
  const nextCookie = mergeCookieHeader(cookieHeader, getSetCookieHeaders(res));
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text) as unknown;
  } catch {
    json = { raw: text };
  }
  return { json, cookieHeader: nextCookie, status: res.status };
}

function extractLoginIdentity(json: unknown): {
  userId: string;
  userName?: string;
} | null {
  if (!isRecord(json)) return null;
  const status = readStringField(json, "status");
  if (status && !["success", "logined", "ok"].includes(status)) {
    // some endpoints use status failed
    if (status === "failed" || status === "none") return null;
  }
  const userId =
    readNumberishField(json, "userID") ??
    readNumberishField(json, "userId") ??
    readNumberishField(json, "id");
  if (!userId) return null;
  const userName =
    readStringField(json, "userName") ??
    readStringField(json, "userNicename") ??
    readStringField(json, "displayName") ??
    undefined;
  return { userId, userName };
}

async function probeLogin(
  cookieHeader: string,
  context: "cookie" | "password" | "session" = "session",
): Promise<{
  cookieHeader: string;
  userId: string;
  userName?: string;
}> {
  let cookie = cookieHeader;
  const check = await ajaxAction(cookie, { action: "loginCheckAjax" });
  cookie = check.cookieHeader;
  let id = extractLoginIdentity(check.json);
  if (!id) {
    const info = await ajaxAction(cookie, { action: "getUserInfo" });
    cookie = info.cookieHeader;
    id = extractLoginIdentity(info.json);
  }
  if (!id) {
    if (context === "cookie") {
      throw new Error(
        "Erovoice Cookie 无效或已过期，请从浏览器复制登录后的 Cookie 后重试",
      );
    }
    if (context === "password") {
      throw new Error(
        "Erovoice 登录失败：用户名或密码错误（会话校验未通过）",
      );
    }
    throw new Error("Erovoice 会话已失效，请重新测试登录或更新凭证");
  }
  return { cookieHeader: cookie, userId: id.userId, userName: id.userName };
}

function extractHtmlPayload(json: unknown): string {
  if (typeof json === "string") {
    // Site returns bare "0" when no more infinite-scroll rows.
    if (json === "0" || !json.trim()) return "";
    return json;
  }
  if (!isRecord(json)) return "";
  for (const key of ["getDatas", "html", "data", "result", "raw"]) {
    const v = json[key];
    if (typeof v === "string") {
      if (v === "0" || !v.trim()) return "";
      return v;
    }
  }
  return "";
}

function bookmarkAjaxExhausted(json: unknown, html: string): boolean {
  if (!html.trim()) return true;
  if (typeof json === "string" && (json === "0" || !json.trim())) return true;
  if (isRecord(json)) {
    if (json.end === true) return true;
    const status = readStringField(json, "status");
    if (status === "none" || status === "failed") return true;
    // Some handlers return {status:"success", getDatas:"0"} or empty.
    const payload = extractHtmlPayload(json);
    if (!payload) return true;
  }
  return false;
}

async function fetchBookmarkSsrPage(
  cookieHeader: string,
): Promise<{ html: string; cookieHeader: string; status: number }> {
  const res = await fetch(`${BASE}/mypage.html?type=bookmark`, {
    headers: siteHeaders(cookieHeader, {
      Accept: "text/html,application/xhtml+xml",
      Referer: `${BASE}/`,
    }),
    redirect: "follow",
  });
  const nextCookie = mergeCookieHeader(cookieHeader, getSetCookieHeaders(res));
  const html = await res.text();
  return { html, cookieHeader: nextCookie, status: res.status };
}

async function fetchPlaylist(
  cookieHeader: string,
  workId: string,
): Promise<{ body: string; url: string }> {
  const headers = siteHeaders(cookieHeader, {
    Accept: "application/vnd.apple.mpegurl,application/x-mpegURL,*/*",
  });

  const candidates = [
    `${THEME_LIBS}/getm3u8file_origints.php?id=${encodeURIComponent(workId)}`,
    `${THEME_LIBS}/getm3u8file_archive.php?id=${encodeURIComponent(workId)}`,
  ];

  let lastErr: Error | null = null;
  for (const url of candidates) {
    try {
      const res = await fetch(url, { headers, redirect: "follow" });
      if (!res.ok) {
        lastErr = new Error(`m3u8 proxy HTTP ${res.status}`);
        continue;
      }
      const body = await res.text();
      if (body.includes("#EXTM3U")) {
        if (/getm3u8file_live|livestatus=live/i.test(body) || !body.includes("#EXT-X-ENDLIST")) {
          // live-ish
          if (!body.includes("#EXT-X-ENDLIST")) {
            throw new Error("Live stream not supported (missing #EXT-X-ENDLIST)");
          }
        }
        return { body, url };
      }
      lastErr = new Error("m3u8 proxy returned non-playlist body");
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
    }
  }

  // Fallback: getm3u8URL then absolute path
  try {
    const ajax = await ajaxAction(cookieHeader, {
      action: "getm3u8URL",
      postid: workId,
    });
    if (isRecord(ajax.json)) {
      const rel =
        readStringField(ajax.json, "m3u8URL") ??
        readStringField(ajax.json, "m3u8Url");
      if (rel) {
        const abs = rel.startsWith("http") ? rel : new URL(rel, BASE).href;
        const res = await fetch(abs, {
          headers: siteHeaders(ajax.cookieHeader),
          redirect: "follow",
        });
        if (res.ok) {
          const body = await res.text();
          if (body.includes("#EXTM3U")) return { body, url: abs };
        }
      }
    }
  } catch (err) {
    lastErr = err instanceof Error ? err : new Error(String(err));
  }

  throw lastErr ?? new Error(`Unable to fetch m3u8 for work ${workId}`);
}

function detailUrl(workId: string, category?: string): string {
  const cat =
    category && DETAIL_CATEGORY_SET[category] ? category : "ero-voice";
  return `${BASE}/${cat}/${encodeURIComponent(workId)}.html`;
}

export const erovoiceProvider: Provider = {
  id: "erovoice",

  async login(auth: ProviderAuth): Promise<Session> {
    if (auth.mode === "cookie") {
      const cookie = auth.cookieHeader?.trim();
      if (!cookie) throw new Error("请粘贴 Erovoice Cookie（Cookie 模式）");
      const probed = await probeLogin(cookie, "cookie");
      return {
        provider: "erovoice",
        data: {
          cookieHeader: probed.cookieHeader,
          userId: probed.userId,
          userName: probed.userName,
        },
      };
    }

    const username = auth.username?.trim();
    const password = auth.password;
    if (!username || !password) {
      throw new Error("请填写 Erovoice 用户名和密码");
    }

    // Bootstrap PHPSESSID from homepage (GET /wp-login.php redirects away).
    const boot = await fetch(`${BASE}/`, {
      headers: { "User-Agent": DEFAULT_UA, Referer: `${BASE}/` },
      redirect: "follow",
    });
    let cookieHeader = mergeCookieHeader(undefined, getSetCookieHeaders(boot));
    await boot.text().catch(() => undefined);

    const body = new URLSearchParams({
      log: username,
      pwd: password,
      rememberme: "forever",
      "wp-submit": "ログイン",
      redirect_to: `${BASE}/`,
      testcookie: "1",
    });

    const res = await fetch(`${BASE}/wp-login.php`, {
      method: "POST",
      headers: {
        "User-Agent": DEFAULT_UA,
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: cookieHeader,
        Origin: BASE,
        Referer: `${BASE}/login.html`,
      },
      body,
      redirect: "manual",
    });
    cookieHeader = mergeCookieHeader(cookieHeader, getSetCookieHeaders(res));

    // Follow one redirect if needed to collect cookies
    const loc = res.headers.get("location");
    if (loc && res.status >= 300 && res.status < 400) {
      const abs = loc.startsWith("http") ? loc : new URL(loc, BASE).href;
      const follow = await fetch(abs, {
        headers: siteHeaders(cookieHeader, {
          Referer: `${BASE}/login.html`,
        }),
        redirect: "manual",
      });
      cookieHeader = mergeCookieHeader(
        cookieHeader,
        getSetCookieHeaders(follow),
      );
      await follow.text().catch(() => undefined);
    }

    // Wrong password usually still leaves PHPSESSID; only wordpress_logged_in_*
    // indicates a successful WordPress auth cookie.
    if (!/wordpress_logged_in_/i.test(cookieHeader)) {
      throw new Error("Erovoice 登录失败：用户名或密码错误");
    }

    const probed = await probeLogin(cookieHeader, "password");
    return {
      provider: "erovoice",
      data: {
        cookieHeader: probed.cookieHeader,
        userId: probed.userId,
        userName: probed.userName,
      },
    };
  },

  async isSessionValid(session: Session): Promise<boolean> {
    try {
      const cookie = requireCookie(session);
      await probeLogin(cookie);
      return true;
    } catch {
      return false;
    }
  },

  async *listFavorites(session: Session): AsyncIterable<RemoteWorkRef> {
    let cookie = requireCookie(session);
    let userId = sessionData(session).userId;
    if (!userId) {
      const probed = await probeLogin(cookie);
      cookie = probed.cookieHeader;
      userId = probed.userId;
      session.data.cookieHeader = cookie;
      session.data.userId = userId;
      if (probed.userName) session.data.userName = probed.userName;
    }

    const seen = new Set<string>();
    const yieldCards = function* (
      cards: BookmarkCard[],
    ): Generator<RemoteWorkRef> {
      for (const card of cards) {
        if (seen.has(card.workId)) continue;
        seen.add(card.workId);
        yield {
          provider: "erovoice",
          workId: card.workId,
          authorId: card.authorId,
          title: card.title,
          authorName: card.authorName,
          extra: card.category ? { category: card.category } : undefined,
        };
      }
    };

    // First page is SSR on mypage.html?type=bookmark (AJAX start=0 returns "0").
    await sleep(REQUEST_GAP_MS);
    const ssr = await fetchBookmarkSsrPage(cookie);
    cookie = ssr.cookieHeader;
    session.data.cookieHeader = cookie;
    if (ssr.status >= 400) {
      throw new Error(`Erovoice bookmark page HTTP ${ssr.status}`);
    }
    if (/wp-login\.php/i.test(ssr.html) && /name=["']log["']/i.test(ssr.html)) {
      throw new Error("Erovoice 会话已失效，无法读取收藏页");
    }

    const ssrCards = parseBookmarkHtml(ssr.html);
    yield* yieldCards(ssrCards);

    // Infinite scroll: bookmarkScrollGetData starts at count=1 → start=items.
    // Only needed when first page is full (likely more).
    if (ssrCards.length < BOOKMARK_PAGE) {
      return;
    }

    for (let page = 1; page < MAX_BOOKMARK_PAGES; page += 1) {
      await sleep(REQUEST_GAP_MS);
      const start = String(page * BOOKMARK_PAGE);
      const res = await ajaxAction(cookie, {
        action: "getSQLDataBookmarkPostData",
        items: String(BOOKMARK_PAGE),
        start,
        userID: userId,
      });
      cookie = res.cookieHeader;
      session.data.cookieHeader = cookie;

      const html = extractHtmlPayload(res.json);
      if (bookmarkAjaxExhausted(res.json, html)) break;

      const cards = parseBookmarkHtml(html);
      let newCount = 0;
      for (const card of cards) {
        if (seen.has(card.workId)) continue;
        newCount += 1;
      }
      yield* yieldCards(cards);
      if (newCount === 0 || cards.length < BOOKMARK_PAGE) break;
    }
  },

  async *listAuthorWorks(
    session: Session,
    authorId: string,
  ): AsyncIterable<RemoteWorkRef> {
    let cookie = requireCookie(session);
    const slug = authorId.trim().replace(/^\/+|\/+$/g, "");
    if (!slug) throw new Error("Erovoice author slug required");
    if (RESERVED_PATH_SEGMENTS[slug] || DETAIL_CATEGORY_SET[slug]) {
      throw new Error(`Invalid Erovoice author slug: ${slug}`);
    }

    const seen = new Set<string>();
    const yieldCards = function* (
      cards: BookmarkCard[],
    ): Generator<RemoteWorkRef> {
      for (const card of cards) {
        if (seen.has(card.workId)) continue;
        seen.add(card.workId);
        yield {
          provider: "erovoice",
          workId: card.workId,
          authorId: card.authorId ?? slug,
          title: card.title,
          authorName: card.authorName,
          extra: card.category ? { category: card.category } : undefined,
        };
      }
    };

    // First page: SSR author profile (voiceList on /{slug}/).
    await sleep(REQUEST_GAP_MS);
    const ssrRes = await fetch(`${BASE}/${encodeURIComponent(slug)}/`, {
      headers: siteHeaders(cookie, {
        Accept: "text/html,application/xhtml+xml",
        Referer: `${BASE}/`,
      }),
      redirect: "follow",
    });
    cookie = mergeCookieHeader(cookie, getSetCookieHeaders(ssrRes));
    session.data.cookieHeader = cookie;
    if (ssrRes.status >= 400) {
      throw new Error(`Erovoice author page HTTP ${ssrRes.status}`);
    }
    const ssrHtml = await ssrRes.text();
    if (/wp-login\.php/i.test(ssrHtml) && /name=["']log["']/i.test(ssrHtml)) {
      throw new Error("Erovoice 会话已失效，无法读取作者页");
    }
    const ssrCards = parseBookmarkHtml(ssrHtml);
    yield* yieldCards(ssrCards);

    // Infinite scroll: getSQLDataAuthorPostData (userName = slug).
    // Site uses items=50, start=N (same as bookmark).
    if (ssrCards.length < BOOKMARK_PAGE) {
      return;
    }

    for (let page = 1; page < MAX_BOOKMARK_PAGES; page += 1) {
      await sleep(REQUEST_GAP_MS);
      const start = String(page * BOOKMARK_PAGE);
      const res = await ajaxAction(cookie, {
        action: "getSQLDataAuthorPostData",
        items: String(BOOKMARK_PAGE),
        start,
        userName: slug,
      });
      cookie = res.cookieHeader;
      session.data.cookieHeader = cookie;

      const html = extractHtmlPayload(res.json);
      if (bookmarkAjaxExhausted(res.json, html)) break;

      const cards = parseBookmarkHtml(html);
      let newCount = 0;
      for (const card of cards) {
        if (seen.has(card.workId)) continue;
        newCount += 1;
      }
      yield* yieldCards(cards);
      if (newCount === 0 || cards.length < BOOKMARK_PAGE) break;
    }
  },

  async getWork(session: Session, workId: string): Promise<WorkMetadata> {
    const cookie = requireCookie(session);
    const categoryHint =
      typeof session.data.category === "string"
        ? session.data.category
        : undefined;

    const tryOrder = [
      ...(categoryHint ? [categoryHint] : []),
      ...DETAIL_CATEGORIES,
    ];
    const tried = new Set<string>();

    let lastStatus = 0;
    for (const cat of tryOrder) {
      if (tried.has(cat)) continue;
      tried.add(cat);
      await sleep(REQUEST_GAP_MS);
      const url = detailUrl(workId, cat);
      const res = await fetch(url, {
        headers: siteHeaders(cookie, {
          Accept: "text/html,application/xhtml+xml",
        }),
        redirect: "follow",
      });
      lastStatus = res.status;
      if (!res.ok) continue;
      const html = await res.text();
      if (/wp-login\.php/i.test(res.url) && /name=["']log["']/i.test(html)) {
        throw new Error("Erovoice session expired during getWork");
      }
      // crude: detail pages have post markers
      if (
        html.includes(workId) ||
        /voiceImagePreview|controls__total-time|discContent/i.test(html)
      ) {
        return parseDetailHtml(html, workId, url);
      }
    }
    throw new Error(`Erovoice detail ${workId} not found (HTTP ${lastStatus})`);
  },

  async download(
    session: Session,
    work: WorkMetadata,
    cacheDir: string,
    onProgress?: (p: DownloadProgress) => void,
  ): Promise<DownloadResult> {
    const cookie = requireCookie(session);
    const headers = siteHeaders(cookie);

    onProgress?.({ bytesReceived: 0, phase: "hls" });
    const initial = await fetchPlaylist(cookie, work.workId);
    const parsed = parseM3u8(initial.body, initial.url);
    if (!parsed.endList) {
      throw new Error("Live stream not supported (missing #EXT-X-ENDLIST)");
    }

    const hls = await downloadHlsToTs({
      playlistBody: initial.body,
      playlistUrl: initial.url,
      headers,
      cacheDir,
      concurrency: 4,
      onProgress,
      refreshPlaylist: async () => fetchPlaylist(cookie, work.workId),
    });

    onProgress?.({
      bytesReceived: hls.segmentCount,
      bytesTotal: hls.segmentCount,
      phase: "transcode",
    });

    const audioFinal = path.join(cacheDir, "audio.mp3");
    await transcodeToMp3(hls.streamPath, audioFinal);
    const st = await stat(audioFinal);
    if (st.size <= 0) throw new Error("ffmpeg produced empty audio.mp3");

    const fileBuf = await readFile(audioFinal);
    const checksumSha256 = createHash("sha256").update(fileBuf).digest("hex");

    let coverPath: string | null = null;
    if (work.coverUrl) {
      try {
        const coverTmp = path.join(cacheDir, "cover.download");
        const cover = await fetchToFile({
          url: work.coverUrl,
          destPath: coverTmp,
          headers,
        });
        const coverExt = cover.ext === "bin" ? "jpg" : cover.ext;
        coverPath = path.join(cacheDir, `cover.${coverExt}`);
        await renameOrCopy(cover.path, coverPath);
      } catch {
        coverPath = null;
      }
    }

    return {
      audioPath: audioFinal,
      audioExt: "mp3",
      coverPath,
      checksumSha256,
      bytes: st.size,
      meta: work,
    };
  },
};

export interface ErovoiceFolloweeAuthor {
  authorId: string;
  username: string | null;
  displayName: string | null;
}

function isErovoiceAuthorSlug(slug: string): boolean {
  if (!slug || slug.length < 2 || slug.length > 64) return false;
  if (RESERVED_PATH_SEGMENTS[slug] || DETAIL_CATEGORY_SET[slug]) return false;
  // Author slugs are not pure numeric (post ids live under category paths).
  if (/^\d+$/.test(slug)) return false;
  // UUID / hex fragments from media paths
  if (/^[a-f0-9-]{8,}$/i.test(slug) && !/[g-z_]/i.test(slug)) return false;
  if (slug.startsWith("-") || slug.endsWith("-")) return false;
  return true;
}

const PROFILE_HREF_RE =
  /href=["'](?:https?:\/\/erovoice-ch\.com)?\/([a-zA-Z0-9_-]{2,64})\/?["']/i;

/**
 * Parse follow-list HTML for author cards.
 * Prefer `.authorUser` + profile `/{slug}/` (same shape as bookmark/detail pages).
 * Does not scrape arbitrary page chrome links (no authorUser → ignored).
 */
export function parseFollowListHtml(html: string): ErovoiceFolloweeAuthor[] {
  const byId = new Map<string, ErovoiceFolloweeAuthor>();

  const upsert = (slug: string, displayName: string | null) => {
    if (!isErovoiceAuthorSlug(slug)) return;
    const name =
      displayName && displayName.trim() ? displayName.trim() : null;
    const existing = byId.get(slug);
    if (!existing) {
      byId.set(slug, {
        authorId: slug,
        username: slug,
        displayName: name ?? slug,
      });
      return;
    }
    // Prefer a real display name over slug-only fallback.
    if (
      name &&
      name !== slug &&
      (!existing.displayName || existing.displayName === slug)
    ) {
      existing.displayName = name;
    }
  };

  // Primary: scan <a> tags that both link to /{slug}/ and carry authorUser
  // (class on the anchor or a nested element). Order of attributes does not matter.
  const anchorRe = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = anchorRe.exec(html)) !== null) {
    const attrs = m[1] ?? "";
    const inner = m[2] ?? "";
    const hrefM = PROFILE_HREF_RE.exec(attrs);
    if (!hrefM?.[1]) continue;
    const slug = hrefM[1];
    const hasAuthorUser =
      /class=["'][^"']*authorUser/i.test(attrs) ||
      /class=["'][^"']*authorUser/i.test(inner);
    if (!hasAuthorUser) continue;

    let name: string | null = null;
    const nested =
      /class=["'][^"']*authorUser[^"']*["'][^>]*>([\s\S]*?)<\//i.exec(inner);
    if (nested?.[1]) {
      name = stripTags(nested[1]) || null;
    } else if (/class=["'][^"']*authorUser/i.test(attrs)) {
      name = stripTags(inner) || null;
    }
    if (!name) {
      const titleAttr =
        /title=["']([^"']+)["']/i.exec(attrs) ??
        /alt=["']([^"']+)["']/i.exec(attrs) ??
        /alt=["']([^"']+)["']/i.exec(inner);
      if (titleAttr?.[1]) {
        name = decodeHtmlEntities(titleAttr[1]).trim() || null;
      }
    }
    upsert(slug, name);
  }

  // Secondary: .authorUser text sibling to a nearby profile href (not already
  // captured). Use closest href within a tight window to avoid mypage chrome.
  const authorUserOnly =
    /class=["'][^"']*authorUser[^"']*["'][^>]*>([\s\S]*?)<\//gi;
  while ((m = authorUserOnly.exec(html)) !== null) {
    const name = stripTags(m[1] ?? "") || null;
    const idx = m.index ?? 0;
    const end = idx + m[0].length;
    const windowStart = Math.max(0, idx - 120);
    const windowEnd = Math.min(html.length, end + 120);
    const window = html.slice(windowStart, windowEnd);

    // Prefer nearest profile href to the authorUser match.
    let bestSlug: string | null = null;
    let bestDist = Number.POSITIVE_INFINITY;
    const hrefScan =
      /href=["'](?:https?:\/\/erovoice-ch\.com)?\/([a-zA-Z0-9_-]{2,64})\/?["']/gi;
    let hm: RegExpExecArray | null;
    while ((hm = hrefScan.exec(window)) !== null) {
      const slug = hm[1] ?? "";
      if (!isErovoiceAuthorSlug(slug)) continue;
      const abs = windowStart + (hm.index ?? 0);
      // Distance to the authorUser span.
      const dist =
        abs < idx ? idx - abs : abs > end ? abs - end : 0;
      if (dist < bestDist) {
        bestDist = dist;
        bestSlug = slug;
      }
    }
    if (!bestSlug) continue;
    // Skip if already have a real name for this slug from primary pass.
    const existing = byId.get(bestSlug);
    if (
      existing &&
      existing.displayName &&
      existing.displayName !== bestSlug
    ) {
      continue;
    }
    upsert(bestSlug, name);
  }

  return [...byId.values()];
}

/**
 * Display name for a single profile page `/{slug}`.
 */
export function parseProfileDisplayName(
  html: string,
  slug: string,
): string | null {
  const h =
    /<h[1-3][^>]*class=["'][^"']*authorUser[^"']*["'][^>]*>([\s\S]*?)<\/h[1-3]>/i.exec(
      html,
    ) ??
    /class=["'][^"']*authorUser[^"']*["'][^>]*>([\s\S]*?)<\//i.exec(html);
  if (h?.[1]) {
    const name = stripTags(h[1]).trim();
    if (name) return name;
  }
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (title?.[1]) {
    const t = stripTags(title[1])
      .replace(/\s*[-|｜].*$/, "")
      .trim();
    if (t && t.toLowerCase() !== slug.toLowerCase()) return t;
  }
  return null;
}

const SLUG_QUERY_RE = /^[a-zA-Z0-9_-]{2,64}$/;

/**
 * Erovoice has no official author search API.
 * Only exact slug (profile id) lookup: GET /{slug}.
 */
export async function searchErovoiceAuthors(
  query: string,
  sessionCookie?: string | null,
): Promise<ErovoiceFolloweeAuthor[]> {
  const q = query.trim().replace(/^\/+|\/+$/g, "");
  if (!q) return [];
  if (!SLUG_QUERY_RE.test(q) || !isErovoiceAuthorSlug(q)) return [];

  let cookie = sessionCookie?.trim() || "";
  const headers: Record<string, string> = {
    "User-Agent": DEFAULT_UA,
    Accept: "text/html,application/xhtml+xml",
    Referer: `${BASE}/`,
  };
  if (cookie) headers.Cookie = cookie;

  try {
    const res = await fetch(`${BASE}/${encodeURIComponent(q)}`, {
      headers,
      redirect: "follow",
    });
    if (!res.ok) return [];
    const html = await res.text();
    const looksMissing =
      /ページが見つかりません|not\s*found|404/i.test(html) &&
      !/authorUser/i.test(html);
    if (looksMissing || !/class=["'][^"']*authorUser/i.test(html)) {
      return [];
    }
    const displayName = parseProfileDisplayName(html, q) ?? q;
    return [
      {
        authorId: q,
        username: q,
        displayName,
      },
    ];
  } catch {
    return [];
  }
}

/**
 * List authors the logged-in user follows.
 * AJAX `getSQLDatafollowslistPostData` is authoritative; SSR is best-effort only.
 * Filters out the logged-in account (self) via session `userName` slug.
 */
export async function listErovoiceFolloweeAuthors(
  session: Session,
): Promise<ErovoiceFolloweeAuthor[]> {
  let cookie = requireCookie(session);
  let userId = sessionData(session).userId;
  let userName =
    typeof session.data.userName === "string" && session.data.userName.trim()
      ? session.data.userName.trim()
      : undefined;

  // Need userId for AJAX; userName for self-filter (probe when either missing).
  if (!userId || !userName) {
    const probed = await probeLogin(cookie);
    cookie = probed.cookieHeader;
    userId = probed.userId;
    if (probed.userName) userName = probed.userName;
    session.data.cookieHeader = cookie;
    session.data.userId = userId;
    if (userName) session.data.userName = userName;
  }

  const selfSlug = userName?.toLowerCase() ?? null;
  const byId = new Map<string, ErovoiceFolloweeAuthor>();

  const merge = (rows: ErovoiceFolloweeAuthor[]) => {
    for (const r of rows) {
      if (selfSlug && r.authorId.toLowerCase() === selfSlug) continue;
      const existing = byId.get(r.authorId);
      if (!existing) {
        byId.set(r.authorId, { ...r });
        continue;
      }
      // Prefer real display name over slug-only.
      if (
        r.displayName &&
        r.displayName !== r.authorId &&
        (!existing.displayName || existing.displayName === r.authorId)
      ) {
        existing.displayName = r.displayName;
      }
    }
  };

  // Primary: InfiniteScroll AJAX (avoids mypage chrome / self profile link).
  for (let page = 0; page < MAX_BOOKMARK_PAGES; page += 1) {
    await sleep(REQUEST_GAP_MS);
    const start = String(page * BOOKMARK_PAGE);
    const res = await ajaxAction(cookie, {
      action: "getSQLDatafollowslistPostData",
      items: String(BOOKMARK_PAGE),
      start,
      userID: userId,
    });
    cookie = res.cookieHeader;
    session.data.cookieHeader = cookie;
    const html = extractHtmlPayload(res.json);
    if (bookmarkAjaxExhausted(res.json, html)) break;
    const rows = parseFollowListHtml(html);
    if (rows.length === 0) break;
    const before = byId.size;
    merge(rows);
    if (byId.size === before || rows.length < BOOKMARK_PAGE) break;
  }

  // Best-effort SSR first page (same strict parser + self-filter).
  await sleep(REQUEST_GAP_MS);
  try {
    const res = await fetch(`${BASE}/mypage.html?type=follow`, {
      headers: siteHeaders(cookie),
      redirect: "follow",
    });
    cookie = mergeCookieHeader(cookie, getSetCookieHeaders(res));
    session.data.cookieHeader = cookie;
    if (res.ok) {
      const html = await res.text();
      merge(parseFollowListHtml(html));
    }
  } catch {
    // AJAX already primary
  }

  return [...byId.values()];
}
