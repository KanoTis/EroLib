import type { ProviderId } from "@erolib/shared";
import { erovoiceProvider } from "./erovoice.js";
import { koekoeProvider } from "./koekoe.js";
import { otobananaProvider } from "./otobanana.js";
import type { Provider } from "./types.js";

const providers: Record<ProviderId, Provider> = {
  otobanana: otobananaProvider,
  koekoe: koekoeProvider,
  erovoice: erovoiceProvider,
};

export function getProvider(id: ProviderId): Provider {
  const p = providers[id];
  if (!p) throw new Error(`Unknown provider: ${id}`);
  return p;
}

export function listProviders(): Provider[] {
  return Object.values(providers);
}

export type { Provider } from "./types.js";
