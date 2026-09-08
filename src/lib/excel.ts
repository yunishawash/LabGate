import * as XLSX from "xlsx";

export interface SheetDef {
  name: string;
  /** Column headers, already in the viewer's language. */
  headers: string[];
  rows: (string | number | null)[][];
}

/**
 * Build a workbook from plain rows.
 *
 * Deliberately thin: the sheets are shaped by whoever owns the data, because
 * the moment this helper starts knowing about orders it becomes a second place
 * where a column can be forgotten.
 *
 * Sheet names are truncated to 31 characters and stripped of `[]:*?/\` — Excel
 * refuses the file outright otherwise, with an error that blames the file
 * rather than the name.
 */
export function buildWorkbook(sheets: SheetDef[]): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const ws = XLSX.utils.aoa_to_sheet([s.headers, ...s.rows]);
    // Give every column a width from its widest cell, capped: a 200-character
    // rejection reason must not push the numeric columns off the screen.
    ws["!cols"] = s.headers.map((h, i) => {
      const longest = Math.max(
        String(h).length,
        ...s.rows.map((r) => String(r[i] ?? "").length)
      );
      return { wch: Math.min(Math.max(longest + 2, 8), 44) };
    });
    XLSX.utils.book_append_sheet(wb, ws, s.name.replace(/[[\]:*?/\\]/g, "").slice(0, 31));
  }
  return wb;
}

export function workbookToBuffer(wb: XLSX.WorkBook): Buffer {
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

export function xlsxResponse(buf: Buffer, filename: string): Response {
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
