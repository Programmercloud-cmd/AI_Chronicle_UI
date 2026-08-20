import { describe, expect, it } from "vitest";

import {
  contentDisposition,
  decodePreviewText,
  escapeHtml,
  imageMediaType,
  safeAttachmentFilename,
  projectHttpDiagnostics,
} from "../../src/server";

describe("server evidence security helpers", () => {
  it("escapes every HTML-significant text character", () => {
    expect(escapeHtml(`<script x="'">&`)).toBe("&lt;script x=&quot;&#39;&quot;&gt;&amp;");
  });

  it("sanitizes attachment filenames and cannot inject headers", () => {
    expect(safeAttachmentFilename("reports/../../evil\r\nX-Test: yes.html")).toBe("evil__X-Test__yes.html");
    expect(contentDisposition("attachment", "reports/a b.html")).toBe('attachment; filename="a_b.html"');
  });

  it("allows only declared strict UTF-8 text", () => {
    expect(decodePreviewText(Buffer.from("hello"), "text/plain")).toBe("hello");
    expect(decodePreviewText(Buffer.from([0xc3, 0x28]), "text/plain")).toBeUndefined();
    expect(decodePreviewText(Buffer.from("<svg/>"), "image/svg+xml")).toBeUndefined();
  });

  it("requires declared image type and matching signature", () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(imageMediaType(png, "image/png")).toBe("image/png");
    expect(imageMediaType(png, "image/jpeg")).toBeUndefined();
    expect(imageMediaType(Buffer.from("<svg/>"), "image/svg+xml")).toBeUndefined();
  });

  it("projects diagnostics without filesystem paths or exception text", () => {
    const projected = projectHttpDiagnostics([{
      code: "read-failed",
      sourcePath: "C:\\private\\chronicle",
      message: "ENOENT: cannot open C:\\private\\chronicle\\secret.yaml",
      recordId: "CORE-001",
      instancePath: "/parents/0",
    }]);
    expect(projected).toEqual([{
      code: "read-failed",
      sourcePath: ".",
      message: "Chronicle content could not be read.",
      recordId: "CORE-001",
      instancePath: "/parents/0",
    }]);
  });
});
