import { redirect } from "next/navigation";

/**
 * Settings → AI (Fix 1): AI processing happens in the Capture Inbox, so this entry point
 * opens it directly instead of showing a placeholder. Reuses the existing route — no new
 * menu, no new navigation entry.
 */
export default function AiSettingsPage() {
  redirect("/inbox");
}
