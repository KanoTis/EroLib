import type {
  DownloadProgress,
  DownloadResult,
  ProviderAuth,
  ProviderId,
  RemoteWorkRef,
  Session,
  WorkMetadata,
} from "@erolib/shared";

export interface Provider {
  id: ProviderId;
  login(auth: ProviderAuth): Promise<Session>;
  isSessionValid(session: Session): Promise<boolean>;
  listFavorites(session: Session): AsyncIterable<RemoteWorkRef>;
  getWork(session: Session, workId: string): Promise<WorkMetadata>;
  download(
    session: Session,
    work: WorkMetadata,
    cacheDir: string,
    onProgress?: (p: DownloadProgress) => void,
  ): Promise<DownloadResult>;
}

export interface ProviderSessionData {
  accessToken?: string;
  cookieHeader?: string;
  refreshToken?: string;
  userId?: string;
  raw?: Record<string, string>;
}

export function sessionData(session: Session): ProviderSessionData {
  const data = session.data;
  const out: ProviderSessionData = {};
  if (typeof data.accessToken === "string") {
    out.accessToken = data.accessToken;
  }
  if (typeof data.cookieHeader === "string") {
    out.cookieHeader = data.cookieHeader;
  }
  if (typeof data.refreshToken === "string") {
    out.refreshToken = data.refreshToken;
  }
  if (typeof data.userId === "string") {
    out.userId = data.userId;
  }
  return out;
}

export const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 Erolib/0.1";
