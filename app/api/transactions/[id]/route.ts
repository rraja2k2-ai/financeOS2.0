import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase";
import { getTransactionForReview, updateReviewedTransaction } from "@/services/capture/update-transaction.service";
import { SaveValidationError, type ReviewedCapture } from "@/services/capture/save-capture.service";
import * as transactionService from "@/services/transaction.service";

/**
 * Fix 3 — Activity Edit & Delete. One route, one existing transaction:
 *   GET    — load it, shaped for the (single, reused) Review screen
 *   PUT    — save Review edits back onto it (UPDATE, never a new transaction)
 *   DELETE — remove the complete transaction (header + items + receipt_attachments)
 */

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const start = performance.now();

  try {
    const supabase = await createServerSupabaseClient();
    const data = await getTransactionForReview(supabase, id);
    // Performance profiling pass: this is the call the Capture success card waits on for
    // its "Loading details..." state — the real "API response back to UI" moment for the
    // save-to-success-card path (see CaptureModal.tsx's summary-fetch effect).
    console.log(`[capture:${id}] GET /api/transactions/[id] (success card summary) — ${Math.round(performance.now() - start)} ms`);
    if (!data) {
      return NextResponse.json({ error: "Transaction not found." }, { status: 404 });
    }
    return NextResponse.json(data);
  } catch (err) {
    console.error("[transactions/:id] GET failed:", err);
    return NextResponse.json({ error: "Couldn't load this transaction. Try again." }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let body: { reviewed?: ReviewedCapture; itemIds?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }
  if (!body.reviewed || !body.itemIds) {
    return NextResponse.json({ error: "Missing review payload." }, { status: 400 });
  }

  try {
    const supabase = await createServerSupabaseClient();
    await updateReviewedTransaction(supabase, id, body.itemIds, body.reviewed);

    revalidatePath("/activity");
    revalidatePath("/");

    return NextResponse.json({ updated: true });
  } catch (err) {
    if (err instanceof SaveValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("[transactions/:id] PUT failed:", err);
    return NextResponse.json({ error: "Couldn't save changes. Your edits are safe — please try again." }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    const supabase = await createServerSupabaseClient();
    await transactionService.deleteTransaction(supabase, id);

    revalidatePath("/activity");
    revalidatePath("/");

    return NextResponse.json({ deleted: true });
  } catch (err) {
    console.error("[transactions/:id] DELETE failed:", err);
    return NextResponse.json({ error: "Couldn't delete this transaction. Try again." }, { status: 500 });
  }
}
