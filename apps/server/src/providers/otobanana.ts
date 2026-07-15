import { copyFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
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
} from "./download-utils.js";
import type { Provider } from "./types.js";
import { DEFAULT_UA, sessionData } from "./types.js";

const AUTH_BASE = "https://otobanana.com";
const API_BASE = "https://api.v2.otobanana.com";

const SignInResponse = z
  .object({
    accessToken: z.string().optional(),
    access_token: z.string().optional(),
    token: z.string().optional(),
    refreshToken: z.string().optional(),
    refresh_token: z.string().optional(),
    expireIn: z.number().optional(),
    data: z
      .object({
        accessToken: z.string().optional(),
        token: z.string().optional(),
        refreshToken: z.string().optional(),
      })
      .optional(),
    message: z.string().optional(),
    code: z.union([z.string(), z.number()]).optional(),
  })
  .passthrough();

const CastUser = z
  .object({
    id: z.string().optional(),
    name: z.string().optional(),
    username: z.string().optional(),
    avatar_url: z.string().nullable().optional(),
  })
  .passthrough();

const CastPost = z
  .object({
    id: z.string().optional(),
    title: z.string().optional(),
    text: z.string().optional(),
    user_id: z.string().optional(),
    user: CastUser.optional(),
    created_at: z.string().optional(),
  })
  .passthrough();

const CastPayload = z
  .object({
    audio_url: z.string().nullable().optional(),
    duration_time: z.string().nullable().optional(),
    post_ptr_id: z.string().optional(),
    thumbnail_url: z.string().nullable().optional(),
    post: CastPost.optional(),
    id: z.string().optional(),
    title: z.string().optional(),
  })
  .passthrough();

const LikeListItem = z
  .object({
    id: z.string(),
    title: z.string().optional(),
    text: z.string().optional(),
    user_id: z.string().optional(),
    user: CastUser.optional(),
    cast: CastPayload.optional(),
    created_at: z.string().optional(),
  })
  .passthrough();

const LikesPage = z
  .object({
    data: z.array(LikeListItem).optional(),
    next_page_url: z.string().nullable().optional(),
    next_cursor: z.string().nullable().optional(),
    casts: z.array(CastPayload).optional(),
    results: z.array(LikeListItem).optional(),
    next: z.string().nullable().optional(),
  })
  .passthrough();

const SettingsResponse = z
  .object({
    username: z.string().optional(),
  })
  .passthrough();

async function renameSafe(src: string, dest: string): Promise<void> {
  try {
    await rename(src, dest);
  } catch {
    await copyFile(src, dest);
    await rm(src, { force: true });
  }
}

function extractAccessToken(raw: unknown): string | null {
  const parsed = SignInResponse.safeParse(raw);
  if (!parsed.success) return null;
  const v = parsed.data;
  return (
    v.accessToken ??
    v.access_token ??
    v.token ??
    v.data?.accessToken ??
    v.data?.token ??
    null
  );
}

function extractRefreshToken(raw: unknown): string | undefined {
  const parsed = SignInResponse.safeParse(raw);
  if (!parsed.success) return undefined;
  const v = parsed.data;
  return (
    v.refreshToken ??
    v.refresh_token ??
    v.data?.refreshToken ??
    undefined
  );
}

function signInErrorMessage(status: number, raw: unknown): string {
  const parsed = SignInResponse.safeParse(raw);
  const detail = parsed.success
    ? [parsed.data.code, parsed.data.message].filter(Boolean).join(": ")
    : "";
  return detail
    ? `Otobanana login failed: HTTP ${status} — ${detail}`
    : `Otobanana login failed: HTTP ${status}`;
}

function parseDuration(durationTime: string | null | undefined): number | null {
  if (!durationTime) return null;
  const parts = durationTime.split(":").map((p) => Number.parseInt(p, 10));
  if (parts.some((n) => !Number.isFinite(n))) return null;
  if (parts.length === 3) {
    return (parts[0] ?? 0) * 3600 + (parts[1] ?? 0) * 60 + (parts[2] ?? 0);
  }
  if (parts.length === 2) {
    return (parts[0] ?? 0) * 60 + (parts[1] ?? 0);
  }
  return null;
}

function castToRef(cast: z.infer<typeof CastPayload>): RemoteWorkRef | null {
  const workId = cast.post_ptr_id ?? cast.post?.id ?? cast.id ?? null;
  if (!workId) return null;
  const authorId = cast.post?.user_id ?? cast.post?.user?.id ?? null;
  const title = cast.post?.title ?? cast.title ?? undefined;
  const authorName =
    cast.post?.user?.name ?? cast.post?.user?.username ?? undefined;
  return {
    provider: "otobanana",
    workId,
    authorId,
    title,
    authorName,
  };
}

function likeItemToRef(
  item: z.infer<typeof LikeListItem>,
): RemoteWorkRef | null {
  if (item.cast) {
    const fromCast = castToRef(item.cast);
    if (fromCast) {
      return {
        ...fromCast,
        workId: fromCast.workId || item.id,
        authorId: fromCast.authorId ?? item.user_id ?? item.user?.id ?? null,
        title: fromCast.title ?? item.title,
        authorName:
          fromCast.authorName ?? item.user?.name ?? item.user?.username,
      };
    }
  }
  return {
    provider: "otobanana",
    workId: item.id,
    authorId: item.user_id ?? item.user?.id ?? null,
    title: item.title,
    authorName: item.user?.name ?? item.user?.username,
  };
}

function userIdFromSettings(raw: unknown): string | null {
  const parsed = SettingsResponse.safeParse(raw);
  if (!parsed.success) return null;
  const username = parsed.data.username?.trim();
  return username || null;
}

function castToMeta(
  cast: z.infer<typeof CastPayload>,
  workId: string,
): WorkMetadata {
  const post = cast.post;
  const audioUrl = cast.audio_url;
  if (!audioUrl) {
    throw new Error(`Otobanana cast ${workId} missing audio_url`);
  }
  return {
    provider: "otobanana",
    workId: post?.id ?? cast.post_ptr_id ?? workId,
    authorId: post?.user_id ?? post?.user?.id ?? null,
    authorName: post?.user?.name ?? post?.user?.username ?? undefined,
    title: post?.title ?? cast.title ?? workId,
    description: post?.text ?? undefined,
    durationSeconds: parseDuration(cast.duration_time),
    audioUrl,
    coverUrl: cast.thumbnail_url ?? post?.user?.avatar_url ?? null,
    sourceUrl: `https://otobanana.com/general/cast/${post?.id ?? cast.post_ptr_id ?? workId}`,
    createdAt: post?.created_at ?? null,
  };
}

async function apiGet(token: string, url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: {
      Authorization: token,
      "User-Agent": DEFAULT_UA,
      Accept: "application/json",
      Origin: AUTH_BASE,
    },
  });
  if (!res.ok) {
    throw new Error(`Otobanana API ${res.status}: ${url}`);
  }
  return res.json();
}

async function resolveUserId(
  token: string,
  existing?: string,
): Promise<string> {
  if (existing) return existing;
  const raw = await apiGet(token, `${API_BASE}/api/settings`);
  const userId = userIdFromSettings(raw);
  if (!userId) {
    throw new Error("Otobanana settings response missing username (user id)");
  }
  return userId;
}

export const otobananaProvider: Provider = {
  id: "otobanana",

  async login(auth: ProviderAuth): Promise<Session> {
    if (auth.mode === "cookie") {
      const cookie = auth.cookieHeader?.trim();
      if (!cookie) throw new Error("Cookie header required");
      let accessToken: string | undefined;
      if (cookie.startsWith("eyJ") || cookie.split(".").length === 3) {
        accessToken = cookie;
      } else {
        const m = /(?:^|;\s*)accessToken=([^;]+)/i.exec(cookie);
        if (m?.[1]) accessToken = decodeURIComponent(m[1]);
      }
      if (!accessToken) {
        throw new Error(
          "Otobanana cookie mode expects JWT access token (paste token or accessToken=...)",
        );
      }
      const userId = await resolveUserId(accessToken);
      return {
        provider: "otobanana",
        data: { accessToken, cookieHeader: cookie, userId },
      };
    }

    const email = auth.username?.trim();
    const password = auth.password;
    if (!email || !password) {
      throw new Error("Email and password required");
    }

    // Real auth is on api.v2 (Nuxt public.apiBase). Main-domain /api/signin
    // currently 302s to /error. Body keys are PascalCase: Email / Password.
    let cookieHeader = "";
    const res = await fetch(`${API_BASE}/api/signin`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": DEFAULT_UA,
        Accept: "application/json",
        Origin: AUTH_BASE,
        Referer: `${AUTH_BASE}/general/auth/signin`,
      },
      body: JSON.stringify({ Email: email, Password: password }),
      redirect: "manual",
    });

    cookieHeader = mergeCookieHeader(cookieHeader, getSetCookieHeaders(res));
    const raw: unknown = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(signInErrorMessage(res.status, raw));
    }
    const token = extractAccessToken(raw);
    if (!token) {
      throw new Error(
        "Otobanana login succeeded but no access token in response",
      );
    }
    const refreshToken = extractRefreshToken(raw);
    const userId = await resolveUserId(token);
    return {
      provider: "otobanana",
      data: {
        accessToken: token,
        cookieHeader,
        userId,
        ...(refreshToken ? { refreshToken } : {}),
      },
    };
  },

  async isSessionValid(session: Session): Promise<boolean> {
    const { accessToken } = sessionData(session);
    if (!accessToken) return false;
    try {
      // /api/casts/likes intermittently 500s even with a fresh token; settings
      // is a stable authenticated probe used by the official web client.
      await apiGet(accessToken, `${API_BASE}/api/settings`);
      return true;
    } catch {
      return false;
    }
  },

  async *listFavorites(session: Session): AsyncIterable<RemoteWorkRef> {
    const { accessToken, userId: cachedUserId } = sessionData(session);
    if (!accessToken) throw new Error("Missing Otobanana access token");

    const userId = await resolveUserId(accessToken, cachedUserId);
    const seen = new Set<string>();
    let url: string | null = `${API_BASE}/api/users/${userId}/likes`;
    let guard = 0;

    while (url && guard < 200) {
      guard += 1;
      const raw = await apiGet(accessToken, url);
      const page = LikesPage.parse(raw);
      const items = page.data ?? page.results ?? [];
      if (!Array.isArray(items) || items.length === 0) break;

      let newCount = 0;
      for (const item of items) {
        const ref = likeItemToRef(item);
        if (!ref || seen.has(ref.workId)) continue;
        seen.add(ref.workId);
        newCount += 1;
        yield ref;
      }

      const next = page.next_page_url ?? page.next ?? null;
      if (!next || newCount === 0) break;
      url = next;
    }
  },

  async getWork(session: Session, workId: string): Promise<WorkMetadata> {
    const { accessToken } = sessionData(session);
    if (!accessToken) throw new Error("Missing Otobanana access token");
    const raw = await apiGet(accessToken, `${API_BASE}/api/casts/${workId}`);
    const cast = CastPayload.parse(raw);
    return castToMeta(cast, workId);
  },

  async download(
    session: Session,
    work: WorkMetadata,
    cacheDir: string,
    onProgress?: (p: DownloadProgress) => void,
  ): Promise<DownloadResult> {
    const { accessToken } = sessionData(session);
    const headers: Record<string, string> = {};
    if (accessToken) headers.Authorization = accessToken;

    const audioTmp = path.join(cacheDir, "audio.download");
    const audio = await fetchToFile({
      url: work.audioUrl,
      destPath: audioTmp,
      headers,
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
          headers,
        });
        const coverExt = cover.ext === "bin" ? "jpg" : cover.ext;
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
