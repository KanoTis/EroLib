import type {
  DownloadProgress,
  DownloadResult,
  ProviderAuth,
  RemoteWorkRef,
  Session,
  WorkMetadata,
} from "@erolib/shared";
import type { Provider } from "./types.js";

const NOT_IMPLEMENTED =
  "Erovoice provider is MVP-2 (HLS+AES). Not implemented in MVP-1.";

export const erovoiceProvider: Provider = {
  id: "erovoice",

  async login(_auth: ProviderAuth): Promise<Session> {
    throw new Error(NOT_IMPLEMENTED);
  },

  async isSessionValid(_session: Session): Promise<boolean> {
    return false;
  },

  async *listFavorites(_session: Session): AsyncIterable<RemoteWorkRef> {
    throw new Error(NOT_IMPLEMENTED);
  },

  async getWork(_session: Session, _workId: string): Promise<WorkMetadata> {
    throw new Error(NOT_IMPLEMENTED);
  },

  async download(
    _session: Session,
    _work: WorkMetadata,
    _cacheDir: string,
    _onProgress?: (p: DownloadProgress) => void,
  ): Promise<DownloadResult> {
    throw new Error(NOT_IMPLEMENTED);
  },
};
