import type { CaptureSource } from "./capture-enums";

export type CaptureRequest = {
  capture_id: string;
  source_type: CaptureSource;
  note_hint: string | null;
  payment_hint: string | null;
  project_hint: string | null;
  created_at: string;
};
