export type ReceiptAttachment = {
  id: string;
  header_id: string;
  original_file_url: string;
  thumbnail_url: string;
  ocr_raw_text: string;
  ai_extraction_json: string | null;
  file_size_bytes: number;
  mime_type: string | null;
  created_at: string;
};
