"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/** What the modal hands to its host when the user presses Capture & Process. */
export type CaptureSubmission = {
  context: string;
  /** All pages of the single receipt, in order. */
  files: File[];
  /** How the receipt was supplied — "prompt" when there's no receipt (context only). */
  source: "camera" | "upload" | "paste" | "prompt";
};

/**
 * Premium Capture modal (C2.1: input collection ONLY).
 *
 * Full-screen overlay, NOT a page: it renders above whatever page the user is on, and
 * closing it simply unmounts the overlay — the user is back where they were. Its single
 * responsibility is collecting the receipt (pages) and user context; Capture & Process
 * hands both to the host via onSubmit and the modal closes immediately. Processing and
 * the result display live entirely outside (CaptureLauncher → DeveloperViewer).
 */

type ReceiptSource = "camera" | "upload" | "paste";

type ReceiptPage = {
  id: string;
  file: File;
  /** Object URL for image thumbnails; null for PDFs (icon shown instead). */
  previewUrl: string | null;
  isPdf: boolean;
};

type Receipt = {
  source: ReceiptSource;
  pages: ReceiptPage[];
};

let pageCounter = 0;

function toPage(file: File): ReceiptPage {
  const isPdf = file.type === "application/pdf";
  return {
    id: `page-${++pageCounter}`,
    file,
    previewUrl: isPdf ? null : URL.createObjectURL(file),
    isPdf,
  };
}

function releasePages(pages: ReceiptPage[]) {
  for (const p of pages) {
    if (p.previewUrl) URL.revokeObjectURL(p.previewUrl);
  }
}

export function CaptureModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: (submission: CaptureSubmission) => void }) {
  const [context, setContext] = useState("");
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  /** A new receipt waiting for the user to confirm replacing the current one. */
  const [pendingReceipt, setPendingReceipt] = useState<Receipt | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);

  // Keep latest state in refs so the unmount-only cleanup below can release object URLs
  // without re-running (and revoking live URLs) on every state change.
  const receiptRef = useRef<Receipt | null>(null);
  receiptRef.current = receipt;
  const pendingRef = useRef<Receipt | null>(null);
  pendingRef.current = pendingReceipt;

  useEffect(() => {
    return () => {
      releasePages(receiptRef.current?.pages ?? []);
      releasePages(pendingRef.current?.pages ?? []);
    };
  }, []);

  // Escape closes; body scroll is locked while the overlay is open.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  const autosize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(140, el.scrollHeight)}px`;
  }, []);

  useEffect(() => {
    autosize();
  }, [context, autosize]);

  /** Install `next`, either directly or via the replace-confirmation dialog. */
  function installReceipt(next: Receipt) {
    setNotice(null);
    if (receipt && receipt.pages.length > 0) {
      setPendingReceipt(next);
    } else {
      setReceipt(next);
    }
  }

  function handleCameraFiles(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setNotice(null);
    // One receipt, many pages: keep appending pages while the camera is the source.
    if (receipt && receipt.source === "camera") {
      setReceipt({ ...receipt, pages: [...receipt.pages, toPage(file)] });
    } else {
      installReceipt({ source: "camera", pages: [toPage(file)] });
    }
  }

  function handleUploadFile(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/") && file.type !== "application/pdf") {
      setNotice("Upload one image or one PDF.");
      return;
    }
    installReceipt({ source: "upload", pages: [toPage(file)] });
  }

  async function handlePaste() {
    setNotice(null);
    try {
      if (navigator.clipboard && "read" in navigator.clipboard) {
        const items = await navigator.clipboard.read();
        for (const item of items) {
          const imageType = item.types.find((t) => t.startsWith("image/"));
          if (imageType) {
            const blob = await item.getType(imageType);
            const file = new File([blob], `pasted.${imageType.split("/")[1] ?? "png"}`, { type: imageType });
            installReceipt({ source: "paste", pages: [toPage(file)] });
            return;
          }
        }
      }
      // No image on the clipboard — fall back to text, appended to the AI context.
      const text = await navigator.clipboard.readText();
      if (text.trim()) {
        setContext((c) => (c.trim() ? `${c}\n${text.trim()}` : text.trim()));
        textareaRef.current?.focus();
      } else {
        setNotice("Nothing on the clipboard to paste.");
      }
    } catch {
      setNotice("Clipboard access isn't available — try Upload instead.");
    }
  }

  function confirmReplace() {
    if (!pendingReceipt) return;
    releasePages(receipt?.pages ?? []);
    setReceipt(pendingReceipt);
    setPendingReceipt(null);
  }

  function cancelReplace() {
    releasePages(pendingReceipt?.pages ?? []);
    setPendingReceipt(null);
  }

  function removePage(id: string) {
    if (!receipt) return;
    const page = receipt.pages.find((p) => p.id === id);
    if (page?.previewUrl) URL.revokeObjectURL(page.previewUrl);
    const rest = receipt.pages.filter((p) => p.id !== id);
    setReceipt(rest.length > 0 ? { ...receipt, pages: rest } : null);
  }

  const hasAttachments = (receipt?.pages.length ?? 0) > 0;
  const canCapture = hasAttachments || context.trim().length > 0;

  /**
   * C2.1: the modal only COLLECTS input. Capture & Process hands the receipt pages +
   * user context to the host (CaptureLauncher), which closes this modal immediately and
   * runs the existing AI pipeline — no processing, no result display in here.
   */
  function handleCapture() {
    if (!canCapture) return;
    onSubmit({
      context: context.trim(),
      files: (receipt?.pages ?? []).map((p) => p.file),
      source: receipt?.source ?? "prompt",
    });
  }

  return (
    <div className="fixed inset-0 z-[60] overflow-y-auto bg-background" role="dialog" aria-modal="true" aria-label="New Capture">
      <div className="mx-auto flex min-h-full max-w-[480px] flex-col px-5 pb-8 pt-5">
        {/* Header */}
        <div className="mb-5 flex items-center justify-between">
          <h1 className="text-[22px] font-bold tracking-tight">New Capture</h1>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close capture"
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* AI context — the primary element */}
        <textarea
          ref={textareaRef}
          value={context}
          onChange={(e) => setContext(e.target.value)}
          placeholder={"Paid using POSB.\nThailand holiday.\nNeed reimbursement."}
          className="w-full resize-none rounded-[var(--radius-lg)] border border-border bg-card p-4 text-[15px] leading-relaxed outline-none placeholder:text-muted-foreground/70 focus:border-primary"
          style={{ minHeight: 140 }}
        />

        {/* Secondary actions */}
        <div className="mt-3 grid grid-cols-3 gap-2.5">
          <ActionButton label="Camera" onClick={() => cameraInputRef.current?.click()}>
            <path d="M4 8h3l2-3h6l2 3h3v12H4z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
            <circle cx="12" cy="13" r="3.5" fill="none" stroke="currentColor" strokeWidth="2" />
          </ActionButton>
          <ActionButton label="Upload Receipt" onClick={() => uploadInputRef.current?.click()}>
            <path d="M12 16V4m0 0 4 4m-4-4-4 4M4 20h16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </ActionButton>
          <ActionButton label="Paste" onClick={handlePaste}>
            <rect x="6" y="4" width="12" height="16" rx="2" fill="none" stroke="currentColor" strokeWidth="2" />
            <path d="M9 4.5h6M9 9h6M9 13h6M9 17h4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </ActionButton>
        </div>

        {/* Hidden inputs. Camera: one receipt, multiple pages (one shot per click). */}
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            handleCameraFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <input
          ref={uploadInputRef}
          type="file"
          accept="image/*,application/pdf"
          className="hidden"
          onChange={(e) => {
            handleUploadFile(e.target.files);
            e.target.value = "";
          }}
        />

        {/* Attachments — rendered only once files exist */}
        {hasAttachments && receipt && (
          <section className="mt-5">
            <p className="mb-2.5 text-[13px] font-bold uppercase tracking-wide text-muted-foreground">Receipt</p>
            <div className="overflow-hidden rounded-[var(--radius-lg)] border border-border bg-card">
              {receipt.pages.map((page, i) => (
                <div key={page.id} className={cn("flex items-center gap-3 p-3", i > 0 && "border-t border-border")}>
                  {page.previewUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- local object URL preview, next/image can't optimize it
                    <img src={page.previewUrl} alt={`Page ${i + 1}`} className="h-11 w-11 flex-none rounded-lg border border-border object-cover" />
                  ) : (
                    <div className="flex h-11 w-11 flex-none items-center justify-center rounded-lg bg-secondary text-[18px]">📄</div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-[13.5px] font-semibold">Page {i + 1}</p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {page.isPdf ? "PDF" : "Image"} · {page.file.name}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => removePage(page.id)}
                    aria-label={`Remove page ${i + 1}`}
                    className="flex h-8 w-8 flex-none items-center justify-center rounded-lg text-muted-foreground hover:text-destructive"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round">
                      <path d="M18 6 6 18M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        {notice && <p className="mt-3 text-[12px] text-muted-foreground">{notice}</p>}

        {/* Capture button */}
        <div className="mt-auto pt-6">
          <button
            type="button"
            disabled={!canCapture}
            onClick={handleCapture}
            className="w-full rounded-[var(--radius-md)] bg-primary py-3 text-[14.5px] font-semibold text-primary-foreground disabled:opacity-40"
          >
            Capture &amp; Process
          </button>
        </div>
      </div>

      {/* Replace-receipt confirmation */}
      {pendingReceipt && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 px-8" role="alertdialog" aria-label="Replace receipt?">
          <div className="w-full max-w-[340px] rounded-[var(--radius-lg)] border border-border bg-card p-5">
            <p className="text-[14.5px] font-bold">Replace existing Receipt?</p>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted-foreground">
              Only one receipt per capture. The current receipt and its {receipt?.pages.length === 1 ? "page" : "pages"} will be removed.
            </p>
            <div className="mt-4 flex gap-2.5">
              <button
                type="button"
                onClick={confirmReplace}
                className="flex-1 rounded-lg bg-primary py-2 text-[13px] font-semibold text-primary-foreground"
              >
                Replace
              </button>
              <button type="button" onClick={cancelReplace} className="flex-1 rounded-lg border border-border py-2 text-[13px] font-semibold">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ActionButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex flex-col items-center gap-1.5 rounded-[var(--radius-md)] border border-border bg-card px-2 py-3.5 text-[11.5px] font-semibold text-muted-foreground active:scale-[0.98] disabled:opacity-50"
    >
      <svg width="20" height="20" viewBox="0 0 24 24" className="text-primary">
        {children}
      </svg>
      {label}
    </button>
  );
}
