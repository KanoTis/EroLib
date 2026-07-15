import type {
  DownloadJobPublic,
  HealthResponse,
  ProviderAccountPublic,
  SettingsPublic,
  SyncRunPublic,
  WorkPublic,
} from "@erolib/shared";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    ...init,
  });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body: unknown = await res.json();
      if (
        body &&
        typeof body === "object" &&
        "error" in body &&
        typeof body.error === "string"
      ) {
        message = body.error;
      }
    } catch {
      // ignore
    }
    throw new Error(message || `HTTP ${res.status}`);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return (await res.json()) as T;
}

export const api = {
  health: () => request<HealthResponse>("/api/health"),
  authStatus: () =>
    request<{
      authEnabled: boolean;
      authenticated: boolean;
      username: string | null;
    }>("/api/auth/status"),
  login: (username: string, password: string) =>
    request<{ ok: boolean }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),
  logout: () =>
    request<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),
  settings: () => request<SettingsPublic>("/api/settings"),
  updateSettings: (body: { syncIntervalHours?: number }) =>
    request<{ ok: boolean }>("/api/settings", {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  providers: () => request<ProviderAccountPublic[]>("/api/providers"),
  createProvider: (body: unknown) =>
    request<ProviderAccountPublic>("/api/providers", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  patchProvider: (id: number, body: unknown) =>
    request<ProviderAccountPublic>(`/api/providers/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteProvider: (id: number) =>
    request<{ ok: boolean }>(`/api/providers/${id}`, { method: "DELETE" }),
  testProvider: (id: number) =>
    request<{ ok: boolean; error?: string }>(`/api/providers/${id}/test`, {
      method: "POST",
    }),
  sync: (provider?: string) =>
    request<{ ok: boolean }>("/api/sync", {
      method: "POST",
      body: JSON.stringify(provider ? { provider } : {}),
    }),
  syncRuns: () => request<SyncRunPublic[]>("/api/sync/runs"),
  works: (params?: { q?: string; status?: string; provider?: string }) => {
    const sp = new URLSearchParams();
    if (params?.q) sp.set("q", params.q);
    if (params?.status) sp.set("status", params.status);
    if (params?.provider) sp.set("provider", params.provider);
    const qs = sp.toString();
    return request<WorkPublic[]>(`/api/works${qs ? `?${qs}` : ""}`);
  },
  work: (provider: string, workId: string) =>
    request<WorkPublic>(`/api/works/${provider}/${workId}`),
  retryWork: (provider: string, workId: string) =>
    request<{ ok: boolean }>(`/api/works/${provider}/${workId}/retry`, {
      method: "POST",
    }),
  refreshMetadata: (provider: string, workId: string) =>
    request<{ ok: boolean; warning?: string }>(
      `/api/works/${provider}/${workId}/refresh-metadata`,
      { method: "POST" },
    ),
  jobs: () => request<DownloadJobPublic[]>("/api/jobs"),
  audioUrl: (provider: string, workId: string) =>
    `/api/works/${provider}/${workId}/audio`,
  coverUrl: (provider: string, workId: string) =>
    `/api/works/${provider}/${workId}/cover`,
};
