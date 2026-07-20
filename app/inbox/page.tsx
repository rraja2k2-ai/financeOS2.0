import { createServerSupabaseClient } from "@/lib/supabase";
import { listInboxItems, type InboxItem } from "@/services/capture/inbox.service";
import { RECEIPTS_BUCKET } from "@/repositories/receipt-storage.repository";
import { InboxView, type InboxCard } from "@/components/capture/InboxView";

// The queue changes outside the request cycle (background processing) — never cache.
export const dynamic = "force-dynamic";

export default async function CaptureInboxPage() {
  const supabase = await createServerSupabaseClient();

  let items: InboxItem[] = [];
  let queueUnavailable = false;
  try {
    items = await listInboxItems(supabase);
  } catch (err) {
    // Most likely migration 013 hasn't been run yet — show an honest empty state.
    console.error("[inbox] queue unavailable:", err);
    queueUnavailable = true;
  }

  // Signed thumbnail URLs for image first-pages (bucket is private; links live 1 hour).
  const cards: InboxCard[] = await Promise.all(
    items.map(async (item): Promise<InboxCard> => {
      let thumbnailUrl: string | null = null;
      if (item.firstPage && item.firstPage.mimeType.startsWith("image/")) {
        const { data } = await supabase.storage.from(RECEIPTS_BUCKET).createSignedUrl(item.firstPage.storagePath, 3600);
        thumbnailUrl = data?.signedUrl ?? null;
      }
      return {
        id: item.id,
        status: item.status,
        merchant: item.merchant,
        contextSnippet: item.contextSnippet,
        capturedAt: item.capturedAt,
        updatedAt: item.updatedAt,
        errorMessage: item.errorMessage,
        retryCount: item.retryCount,
        pageCount: item.pageCount,
        isPdf: item.firstPage?.mimeType === "application/pdf",
        thumbnailUrl,
        captureSource: item.captureSource,
      };
    })
  );

  return <InboxView cards={cards} queueUnavailable={queueUnavailable} />;
}
