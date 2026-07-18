export type ReceiptAttachment = {
  id: string;
  header_id: string;
  original_file_url: string;
  thumbnail_url: string;
  ocr_raw_text: string;
  ai_extraction_json: string | null;
  file_size_bytes: number;
  mime_type: string | null;
  /** Path of the original receipt file inside the "receipts" Supabase Storage bucket. */
  storage_path: string | null;
  /** 1-based page number within the receipt (a receipt can have multiple pages). */
  page_no: number | null;
  created_at: string;
};
