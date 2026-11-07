import { NextResponse } from "next/server";
import { dispositionFor, getFile } from "@/lib/storage";

/**
 * Serving a stored file.
 *
 * The bytes are streamed by this application, because the response headers are
 * the security control: anything rendered in this origin must carry the sandbox
 * policy and the nosniff header. Permission is decided by the caller first.
 *
 * Call it only from a route whose last path segment is `download` or `preview`
 * (STORED_FILE_ROUTE_SEGMENTS in next.config.ts). Anywhere else the site-wide
 * Content-Security-Policy from next.config replaces the sandbox policy set
 * here, because Next keeps a configured header over a route's own.
 */
export async function serveStoredFile(options: {
  storageKey: string;
  fileName: string;
  mimeType: string;
  /** Forces streaming — a preview is rendered inside this origin. */
  inline?: boolean;
}): Promise<NextResponse> {
  const disposition = options.inline ? "inline" : dispositionFor(options.mimeType);
  // Quotes and newlines in a filename would break the header it sits in.
  const filename = options.fileName.replace(/["\\\r\n]/g, "_");

  let file: Buffer;
  try {
    file = await getFile(options.storageKey);
  } catch {
    return new NextResponse("The stored file is missing.", { status: 410 });
  }

  return new NextResponse(new Uint8Array(file), {
    headers: {
      "Content-Type": options.mimeType,
      "Content-Length": String(file.byteLength),
      "Content-Disposition": `${disposition}; filename="${filename}"`,
      // Uploaded content must never be treated as active content by the browser.
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cache-Control": "private, no-store",
    },
  });
}
