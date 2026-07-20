/**
 * Client-side image downscale/re-encode before a receipt page ever leaves the browser.
 *
 * Vercel Serverless Functions enforce a hard ~4.5 MB request body limit (not present in
 * `next dev`, which is why this only surfaced after deploying). Phone camera photos are
 * routinely 4-12 MB, so `/api/inbox`'s multipart upload silently failed on mobile —
 * capture and upload alike, on every retry, since retrying resends the same oversized
 * file. Receipts are text documents: a long edge of 1920px is far more than Gemini needs
 * to read them, so shrinking here is lossless for the app's purposes.
 */
const MAX_DIMENSION = 1920;
const JPEG_QUALITY = 0.82;

/** PDFs pass through untouched. Any decode failure falls back to the original file — this must never block a capture. */
export async function compressImageFile(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) return file;

  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
    if (!blob || blob.size >= file.size) return file;

    const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
    return new File([blob], name, { type: "image/jpeg", lastModified: file.lastModified });
  } catch {
    return file;
  }
}
