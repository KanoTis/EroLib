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

export function parseDetail(html: string, workId: string): WorkMetadata {
  const titleMatch =
    /<h2[^>]*>([\s\S]*?)<\/h2>/i.exec(html) ??
    /<title>([^<]+)<\/title>/i.exec(html);
  let title = titleMatch?.[1]?.replace(/<[^>]+>/g, "").trim() ?? workId;
  title = title.replace(/\s*[|｜].*$/, "").trim() || workId;

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
  }

  const authorMatch =
    /user_name[^>]*>([^<]+)</i.exec(html) ??
    /search\.php\?word=([^&"']+)[^>]*>\s*<span class="user_name">/i.exec(html);
  const authorName = authorMatch?.[1]
    ? decodeURIComponent(authorMatch[1]).trim()
    : undefined;

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

  const iconMatch = /src=["'](\/img\/(?:female|male|couple)[^"']*)["']/i.exec(
    html,
  );
  const coverUrl = iconMatch?.[1]
    ? `${BASE}${iconMatch[1]}`
    : null;

  // Prefer stable author key from search link if present
  let authorId: string | null = null;
  const authorLink =
    /search\.php\?word=([^&"']+)/i.exec(html);
  if (authorLink?.[1]) {
    authorId = decodeURIComponent(authorLink[1]);
  } else if (authorName) {
    authorId = authorName;
  }

  return {
    provider: "koekoe",
    workId,
    authorId,
    authorName,
    title,
    durationSeconds,
    audioUrl,
    coverUrl,
    extra: {},
  };
}

function parsePaginationMax(html: string): number {
  let max = 1;
  const re = /[?&]p=(\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const n = Number.parseInt(m[1] ?? "1", 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max;
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

    await sleep(REQUEST_GAP_MS);
    const first = await fetchHtml(`${BASE}/mypage.php`, cookie);
    cookie = first.cookieHeader;
    if (!looksLoggedIn(first.html)) {
      throw new Error("Koe-koe session expired during listFavorites");
    }

    const maxPage = Math.min(parsePaginationMax(first.html), 50);
    const pages = [first.html];

    for (let p = 2; p <= maxPage; p += 1) {
      await sleep(REQUEST_GAP_MS);
      const page = await fetchHtml(`${BASE}/mypage.php?p=${p}`, cookie);
      cookie = page.cookieHeader;
      if (!looksLoggedIn(page.html)) break;
      pages.push(page.html);
    }

    // Persist refreshed cookie onto session object for caller if they re-save
    session.data.cookieHeader = cookie;

    for (const html of pages) {
      for (const id of parseBookmarkIds(html)) {
        if (seen.has(id)) continue;
        seen.add(id);
        yield {
          provider: "koekoe",
          workId: id,
          authorId: null,
          title: undefined,
        };
      }
    }
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
