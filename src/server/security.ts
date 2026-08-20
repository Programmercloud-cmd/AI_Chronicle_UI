import path from "node:path";

export const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "img-src 'self'",
  "style-src 'none'",
  "script-src 'none'",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "sandbox",
].join("; ");

export const APPLICATION_CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self'",
  "connect-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]!);
}

export function safeAttachmentFilename(locator: string): string {
  const basename = path.posix.basename(locator);
  const safe = basename.replace(/[^A-Za-z0-9._-]/gu, "_").replace(/^\.+/u, "");
  return safe.length > 0 ? safe : "chronicle-evidence.bin";
}

export function contentDisposition(disposition: "attachment" | "inline", locator: string): string {
  return `${disposition}; filename="${safeAttachmentFilename(locator)}"`;
}

export function imageMediaType(bytes: Buffer, declared: string): "image/png" | "image/jpeg" | "image/webp" | undefined {
  if (declared === "image/png" && bytes.length >= 8 &&
      bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (declared === "image/jpeg" && bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (declared === "image/webp" && bytes.length >= 12 &&
      bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return undefined;
}

export function decodePreviewText(bytes: Buffer, declared: string): string | undefined {
  if (declared !== "text/plain" && declared !== "text/x-diff") return undefined;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}
