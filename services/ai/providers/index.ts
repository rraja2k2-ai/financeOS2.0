/**
 * AI provider registry/factory (C2).
 *
 * This is the ONLY place the app decides which AI provider is active. Everything else
 * (capture service, API routes, UI) asks this factory for a CaptureAiProvider and stays
 * completely provider-agnostic. Adding a provider = add its file next to this one and
 * register it below; nothing outside services/ai/providers/ changes.
 */
import type { CaptureAiProvider } from "@/services/ai/ai-provider";
import { GeminiCaptureProvider } from "./gemini-provider";

const providers: Record<string, () => CaptureAiProvider> = {
  gemini: () => new GeminiCaptureProvider(),
  // Future: claude: () => new ClaudeCaptureProvider(),
  // Future: openai: () => new OpenAiCaptureProvider(),
  // Future: "azure-di": () => new AzureDocumentIntelligenceProvider(),
};

/** Name of the active provider (metadata only — e.g. for response meta / dev tooling). */
export function getActiveCaptureProviderName(): string {
  // Selected via env config for now (Settings integration is a later milestone).
  return (process.env.AI_PROVIDER ?? "gemini").trim().toLowerCase();
}

export function getCaptureAiProvider(): CaptureAiProvider {
  const active = getActiveCaptureProviderName();
  const factory = providers[active];
  if (!factory) {
    throw new Error(`Unknown AI provider "${active}". Registered: ${Object.keys(providers).join(", ")}.`);
  }
  return factory();
}
