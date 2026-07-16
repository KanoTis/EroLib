import { z } from "zod";
import { DEFAULT_UA } from "./types.js";

const AUTH_BASE = "https://otobanana.com";
const API_BASE = "https://api.v2.otobanana.com";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const LiveUser = z
  .object({
    id: z.string().optional(),
    username: z.string().optional(),
    name: z.string().optional(),
    avatar_url: z.string().nullable().optional(),
  })
  .passthrough();

const LivePost = z
  .object({
    id: z.string().optional(),
    title: z.string().optional(),
    text: z.string().optional(),
    user_id: z.string().optional(),
    user: LiveUser.optional(),
    created_at: z.string().optional(),
  })
  .passthrough();

const OnairRoomRaw = z
  .object({
    room_id: z.string().optional(),
    room_name: z.string().nullable().optional(),
    post_ptr_id: z.string().optional(),
    stream_service: z.string().optional(),
    is_open: z.boolean().optional(),
    is_adult: z.boolean().optional(),
    listener_count: z.number().optional(),
    room_open_at: z.string().optional(),
    room_close_at: z.string().optional(),
    post: LivePost.optional(),
  })
  .passthrough();

const OnairListResponse = z
  .object({
    data: z.array(OnairRoomRaw).optional(),
  })
  .passthrough();

const UserSearchItem = z
  .object({
    id: z.string(),
    username: z.string().optional(),
    name: z.string().optional(),
  })
  .passthrough();

const UserSearchResponse = z
  .object({
    data: z.array(UserSearchItem).optional(),
  })
  .passthrough();

const UserProfile = z
  .object({
    id: z.string(),
    username: z.string().optional(),
    name: z.string().optional(),
  })
  .passthrough();

const FolloweeUser = z
  .object({
    id: z.string(),
    username: z.string().optional(),
    name: z.string().optional(),
  })
  .passthrough();

const FolloweesPage = z
  .object({
    data: z.array(FolloweeUser).optional(),
    current_page: z.number().optional(),
    last_page: z.number().optional(),
    next_page_url: z.string().nullable().optional(),
  })
  .passthrough();

export interface ResolvedAuthor {
  authorId: string;
  username: string | null;
  displayName: string | null;
}

export interface OnairRoom {
  roomId: string;
  authorId: string;
  username: string | null;
  displayName: string | null;
  title: string | null;
  postPtrId: string | null;
  streamService: string | null;
  isOpen: boolean;
  isAdult: boolean | null;
  listenerCount: number | null;
  roomOpenAt: string | null;
  roomCloseAt: string | null;
}

export interface FolloweeAuthor {
  authorId: string;
  username: string | null;
  displayName: string | null;
}

export interface FolloweeRecentRow {
  author: FolloweeAuthor;
  sessions: OnairRoom[];
}

function jsonHeaders(token?: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    "User-Agent": DEFAULT_UA,
    Accept: "application/json",
    Origin: AUTH_BASE,
    Referer: `${AUTH_BASE}/`,
  };
  if (token) headers.Authorization = token;
  return headers;
}

async function fetchJson(
  url: string,
  token?: string | null,
): Promise<{ status: number; json: unknown }> {
  const res = await fetch(url, { headers: jsonHeaders(token) });
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

function mapRoom(raw: z.infer<typeof OnairRoomRaw>): OnairRoom | null {
  const roomId = raw.room_id?.trim();
  if (!roomId) return null;
  const authorId =
    raw.post?.user_id?.trim() ||
    raw.post?.user?.id?.trim() ||
    roomId.split(":")[1] ||
    "";
  if (!authorId) return null;
  return {
    roomId,
    authorId,
    username: raw.post?.user?.username?.trim() || null,
    displayName: raw.post?.user?.name?.trim() || null,
    title: raw.post?.title?.trim() || raw.room_name?.trim() || null,
    postPtrId: raw.post_ptr_id?.trim() || raw.post?.id?.trim() || null,
    streamService: raw.stream_service?.trim() || null,
    // Explicit true only: historical sessions often omit or set false.
    isOpen: raw.is_open === true,
    isAdult: typeof raw.is_adult === "boolean" ? raw.is_adult : null,
    listenerCount:
      typeof raw.listener_count === "number" ? raw.listener_count : null,
    roomOpenAt: raw.room_open_at ?? null,
    roomCloseAt: raw.room_close_at ?? null,
  };
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let idx = 0;
  const runners = Array.from(
    { length: Math.min(concurrency, Math.max(items.length, 1)) },
    async () => {
      while (idx < items.length) {
        const current = idx;
        idx += 1;
        out[current] = await worker(items[current]!);
      }
    },
  );
  await Promise.all(runners);
  return out;
}

export function looksLikeUuid(input: string): boolean {
  return UUID_RE.test(input.trim());
}

export function normalizeUsernameInput(input: string): string {
  return input.trim().replace(/^@+/, "");
}

/** Pure helper for tests: exact username match against search payload. */
export function pickExactUsername(
  payload: unknown,
  username: string,
): ResolvedAuthor | null {
  const parsed = UserSearchResponse.safeParse(payload);
  if (!parsed.success || !parsed.data.data) return null;
  const target = username.toLowerCase();
  const hits = parsed.data.data.filter(
    (u) => (u.username ?? "").toLowerCase() === target,
  );
  if (hits.length !== 1) return null;
  const hit = hits[0]!;
  return {
    authorId: hit.id,
    username: hit.username?.trim() || username,
    displayName: hit.name?.trim() || null,
  };
}

/** Pure helper for tests: map onair body or null on missing room. */
export function parseOnairPayload(payload: unknown): OnairRoom | null {
  const parsed = OnairRoomRaw.safeParse(payload);
  if (!parsed.success) return null;
  return mapRoom(parsed.data);
}

export async function resolveAuthorByInput(
  input: string,
  token?: string | null,
): Promise<ResolvedAuthor> {
  const raw = input.trim();
  if (!raw) throw new Error("Author input is required");

  if (looksLikeUuid(raw)) {
    const { status, json } = await fetchJson(
      `${API_BASE}/api/users/${encodeURIComponent(raw)}`,
      token,
    );
    if (status === 404) {
      throw new Error(`Author UUID not found: ${raw}`);
    }
    if (status < 200 || status >= 300) {
      throw new Error(`Otobanana user lookup failed: HTTP ${status}`);
    }
    const profile = UserProfile.safeParse(json);
    if (!profile.success) {
      throw new Error("Otobanana user lookup returned invalid payload");
    }
    return {
      authorId: profile.data.id,
      username: profile.data.username?.trim() || null,
      displayName: profile.data.name?.trim() || null,
    };
  }

  const username = normalizeUsernameInput(raw);
  if (!username) throw new Error("Username is required");

  const matches: ResolvedAuthor[] = [];
  for (const isAdult of [false, true] as const) {
    const url = `${API_BASE}/api/users?is_adult=${isAdult}&search=${encodeURIComponent(username)}`;
    const { status, json } = await fetchJson(url, token);
    if (status < 200 || status >= 300) {
      throw new Error(`Otobanana user search failed: HTTP ${status}`);
    }
    const hit = pickExactUsername(json, username);
    if (hit) matches.push(hit);
  }

  const byId = new Map(matches.map((m) => [m.authorId, m]));
  if (byId.size === 0) {
    throw new Error(`Username not found: ${username}`);
  }
  if (byId.size > 1) {
    throw new Error(`Username matched multiple authors: ${username}`);
  }
  return [...byId.values()][0]!;
}

export async function getUserOnair(
  authorId: string,
  token?: string | null,
): Promise<OnairRoom | null> {
  const { status, json } = await fetchJson(
    `${API_BASE}/api/users/${encodeURIComponent(authorId)}/onair`,
    token,
  );
  if (status === 404) return null;
  if (status < 200 || status >= 300) {
    throw new Error(`Otobanana onair failed: HTTP ${status}`);
  }
  const room = parseOnairPayload(json);
  if (!room) {
    throw new Error("Otobanana onair returned invalid payload");
  }
  return room;
}

export async function listFolloweeLivestreams(
  token: string,
): Promise<OnairRoom[]> {
  const rooms: OnairRoom[] = [];
  for (const isAdult of [false, true] as const) {
    const { status, json } = await fetchJson(
      `${API_BASE}/api/top/followeelivestreams?is_adult=${isAdult}`,
      token,
    );
    if (status < 200 || status >= 300) {
      throw new Error(
        `Otobanana followee livestreams failed: HTTP ${status}`,
      );
    }
    const parsed = OnairListResponse.safeParse(json);
    if (!parsed.success) {
      throw new Error("Otobanana followee livestreams invalid payload");
    }
    for (const item of parsed.data.data ?? []) {
      const room = mapRoom(item);
      if (room) rooms.push(room);
    }
  }
  const map = new Map(rooms.map((r) => [r.roomId, r]));
  return [...map.values()];
}

/** Resolve logged-in account UUID. Session may store username in userId. */
export async function resolveSelfAuthorId(
  token: string,
  sessionUserId?: string | null,
): Promise<string> {
  if (sessionUserId && looksLikeUuid(sessionUserId)) {
    return sessionUserId;
  }
  if (sessionUserId) {
    const resolved = await resolveAuthorByInput(sessionUserId, token);
    return resolved.authorId;
  }
  const { status, json } = await fetchJson(`${API_BASE}/api/settings`, token);
  if (status < 200 || status >= 300) {
    throw new Error(`Otobanana settings failed: HTTP ${status}`);
  }
  let username = "";
  if (json && typeof json === "object" && "username" in json) {
    const value = json.username;
    if (typeof value === "string") username = value.trim();
  }
  if (!username) {
    throw new Error("Otobanana settings missing username");
  }
  const resolved = await resolveAuthorByInput(username, token);
  return resolved.authorId;
}

export async function listFolloweeAuthors(
  token: string,
  selfAuthorId: string,
  opts?: { maxPages?: number },
): Promise<FolloweeAuthor[]> {
  const maxPages = opts?.maxPages ?? 10;
  const out: FolloweeAuthor[] = [];
  let page = 1;
  while (page <= maxPages) {
    const { status, json } = await fetchJson(
      `${API_BASE}/api/users/${encodeURIComponent(selfAuthorId)}/followees?page=${page}`,
      token,
    );
    if (status < 200 || status >= 300) {
      throw new Error(`Otobanana followees failed: HTTP ${status}`);
    }
    const parsed = FolloweesPage.safeParse(json);
    if (!parsed.success) {
      throw new Error("Otobanana followees invalid payload");
    }
    for (const u of parsed.data.data ?? []) {
      out.push({
        authorId: u.id,
        username: u.username?.trim() || null,
        displayName: u.name?.trim() || null,
      });
    }
    const last = parsed.data.last_page ?? page;
    if (page >= last || !parsed.data.next_page_url) break;
    page += 1;
  }
  return out;
}

export async function listUserRecentLivestreams(
  authorId: string,
  token?: string | null,
  opts?: { perAdultLimit?: number },
): Promise<OnairRoom[]> {
  const perAdultLimit = opts?.perAdultLimit ?? 10;
  const rooms: OnairRoom[] = [];
  for (const isAdult of [false, true] as const) {
    const { status, json } = await fetchJson(
      `${API_BASE}/api/users/${encodeURIComponent(authorId)}/livestreams?is_adult=${isAdult}`,
      token,
    );
    if (status < 200 || status >= 300) {
      throw new Error(
        `Otobanana user livestreams failed: HTTP ${status} (${authorId})`,
      );
    }
    const parsed = OnairListResponse.safeParse(json);
    if (!parsed.success) {
      throw new Error("Otobanana user livestreams invalid payload");
    }
    let n = 0;
    for (const item of parsed.data.data ?? []) {
      const room = mapRoom(item);
      if (!room) continue;
      rooms.push(room);
      n += 1;
      if (n >= perAdultLimit) break;
    }
  }
  const byId = new Map(rooms.map((r) => [r.roomId, r]));
  return [...byId.values()].sort((a, b) => {
    const ta = a.roomOpenAt ?? "";
    const tb = b.roomOpenAt ?? "";
    return tb.localeCompare(ta);
  });
}

export async function listFolloweeRecentLivestreams(
  token: string,
  selfAuthorId: string,
  opts?: {
    maxFolloweePages?: number;
    sessionsPerAuthor?: number;
    concurrency?: number;
  },
): Promise<FolloweeRecentRow[]> {
  const followees = await listFolloweeAuthors(token, selfAuthorId, {
    maxPages: opts?.maxFolloweePages ?? 10,
  });
  const sessionsPerAuthor = opts?.sessionsPerAuthor ?? 5;
  const concurrency = opts?.concurrency ?? 4;
  const rows = await mapPool(followees, concurrency, async (author) => {
    try {
      const sessions = await listUserRecentLivestreams(author.authorId, token, {
        perAdultLimit: 10,
      });
      const top = sessions.slice(0, sessionsPerAuthor).map((s) => ({
        ...s,
        username: s.username ?? author.username,
        displayName: s.displayName ?? author.displayName,
        authorId: author.authorId,
      }));
      return {
        author: {
          authorId: author.authorId,
          username: author.username ?? top[0]?.username ?? null,
          displayName: author.displayName ?? top[0]?.displayName ?? null,
        },
        sessions: top,
      };
    } catch {
      return { author, sessions: [] as OnairRoom[] };
    }
  });
  return rows.sort((a, b) => {
    const aOpen = a.sessions.some((s) => s.isOpen) ? 1 : 0;
    const bOpen = b.sessions.some((s) => s.isOpen) ? 1 : 0;
    if (aOpen !== bOpen) return bOpen - aOpen;
    const aT = a.sessions[0]?.roomOpenAt ?? "";
    const bT = b.sessions[0]?.roomOpenAt ?? "";
    return bT.localeCompare(aT);
  });
}
