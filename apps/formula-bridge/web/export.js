/* Formula Bridge — plan exporters (PowerPoint via PptxGenJS, Word via docx).
 * Pure builders: they take a finished `plan` object and the library global,
 * and return the library's document object. Works in the browser and in Node.
 *
 * plan = {
 *   title, subtitle, date, footer,
 *   slides: [{ key, title, lead, bullets: [], table?: {headers, rows, caption},
 *              chart?: {title, unit, labels, values, source},
 *              image?: {data, w, h, caption}, sources: [{label, url}] }]
 * }
 */
(function (root) {
  const NAVY = "1E1C19", INK = "1E1C19", GREY = "57524A", LIGHT = "F6F2EA", SAFFRON = "A4854B", LINE = "E2DACB"; // BIOT house palette: ink, ivory, antique gold
  const FONT = "Yu Gothic";

  const str = (v) => (v == null ? "" : String(v));
  const clip = (s, n) => { s = str(s); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
  const srcLine = (sources) => (sources || []).filter((s) => s && (s.label || s.url))
    .map((s) => str(s.label) + (s.url ? " (" + s.url + ")" : "")).join(" / ");

  /* ------------------------------ PowerPoint ------------------------------ */
  function buildPptx(plan, PptxGenJS) {
    const pptx = new PptxGenJS();
    pptx.layout = "LAYOUT_WIDE"; // 13.33 x 7.5 in
    pptx.title = str(plan.title);
    pptx.company = str(plan.footer); pptx.author = str(plan.footer); pptx.subject = str(plan.subtitle || plan.title);
    const W = 13.33, M = 0.6;

    (plan.slides || []).forEach((s, i) => {
      const slide = pptx.addSlide();
      slide.background = { color: "FFFFFF" };

      if (s.key === "cover") {
        slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: 7.5, fill: { color: NAVY } });
        slide.addShape(pptx.ShapeType.rect, { x: M, y: 4.55, w: 1.2, h: 0.06, fill: { color: SAFFRON }, line: { color: SAFFRON } });
        slide.addText(str(plan.title), { x: M, y: 2.2, w: W - 2 * M, h: 1.4, fontFace: FONT, fontSize: 36, bold: true, color: "FFFFFF", valign: "bottom" });
        slide.addText(str(plan.subtitle), { x: M, y: 3.7, w: W - 2 * M, h: 0.7, fontFace: FONT, fontSize: 16, color: "E9DFC8" });
        const lines = [s.lead, ...(s.bullets || [])].filter(Boolean).map(str).join("\n");
        slide.addText(lines, { x: M, y: 4.8, w: W - 2 * M, h: 1.4, fontFace: FONT, fontSize: 12, color: "E9DFC8", valign: "top" });
        slide.addText(str(plan.date) + "　" + str(plan.footer), { x: M, y: 6.7, w: W - 2 * M, h: 0.4, fontFace: FONT, fontSize: 10, color: "C9B68D" });
        return;
      }

      // Header
      slide.addText(String(i + 1).padStart(2, "0"), { x: M, y: 0.38, w: 0.6, h: 0.5, fontFace: FONT, fontSize: 12, color: SAFFRON, bold: true });
      slide.addText(str(s.title), { x: M + 0.55, y: 0.3, w: W - 2 * M - 0.55, h: 0.65, fontFace: FONT, fontSize: 24, bold: true, color: NAVY });
      slide.addShape(pptx.ShapeType.line, { x: M, y: 1.0, w: W - 2 * M, h: 0, line: { color: LINE, width: 1 } });
      if (s.lead) slide.addText(str(s.lead), { x: M, y: 1.08, w: W - 2 * M, h: 0.62, fontFace: FONT, fontSize: 13, color: GREY, valign: "top" });

      // Only real content takes the right half (an empty chart / table / image leaves the bullets full width).
      const hasSide = !!(((s.chart?.values || []).length) || ((s.table?.rows || []).length) || s.image?.data);
      const top = 1.8, bottom = 6.75, h = bottom - top;
      const bw = hasSide ? 5.4 : W - 2 * M;

      const bullets = (s.bullets || []).filter(Boolean);
      if (bullets.length) {
        slide.addText(bullets.map((b) => ({ text: str(b), options: { bullet: { code: "25A0" }, breakLine: true, paraSpaceAfter: 6 } })),
          { x: M, y: top, w: bw, h, fontFace: FONT, fontSize: hasSide ? 12.5 : 15, color: INK, valign: "top", fit: "shrink" });
      }

      const sx = hasSide && bullets.length ? M + bw + 0.3 : M, sw = W - M - sx;
      if (s.chart && (s.chart.values || []).length) {
        const c = s.chart;
        slide.addText(str(c.title) + (c.unit ? "（" + c.unit + "）" : ""), { x: sx, y: top - 0.05, w: sw, h: 0.35, fontFace: FONT, fontSize: 11, bold: true, color: INK });
        slide.addChart(pptx.ChartType.bar, [{ name: str(c.unit || c.title), labels: c.labels.map(str), values: c.values.map(Number) }], {
          x: sx, y: top + 0.3, w: sw, h: h - 0.8, barDir: "col", chartColors: [NAVY],
          showValue: true, dataLabelFontSize: 10, dataLabelColor: INK, dataLabelFontFace: FONT,
          catAxisLabelFontSize: 10, catAxisLabelFontFace: FONT, valAxisLabelFontSize: 9, valAxisLabelFontFace: FONT,
          valGridLine: { color: "EEE8DC", size: 0.5 }, showLegend: false,
        });
        if (c.source) slide.addText("出典：" + str(c.source), { x: sx, y: bottom - 0.45, w: sw, h: 0.4, fontFace: FONT, fontSize: 8, color: GREY });
      } else if (s.table && (s.table.rows || []).length) {
        const t = s.table, maxRows = 10; // header + 10 short rows fit the slide; the Word version lists every row
        const head = t.headers.map((x) => ({ text: str(x), options: { bold: true, color: "FFFFFF", fill: { color: NAVY } } }));
        const rows = t.rows.slice(0, maxRows).map((r, ri) => r.map((x) => ({ text: clip(x, 40), options: { fill: { color: ri % 2 ? "FFFFFF" : LIGHT } } })));
        slide.addTable([head, ...rows], { x: sx, y: top, w: sw, h: Math.min(h - 0.5, 0.36 * (rows.length + 1)), rowH: 0.34, autoPage: false, fontFace: FONT, fontSize: 9, color: INK, border: { type: "solid", color: LINE, pt: 0.5 }, valign: "middle", margin: 0.04 });
        const cap = [t.caption, t.rows.length > maxRows ? `ほか${t.rows.length - maxRows}行は省略（Word版に全件記載）` : ""].filter(Boolean).join("　");
        if (cap) slide.addText(cap, { x: sx, y: bottom - 0.4, w: sw, h: 0.35, fontFace: FONT, fontSize: 8.5, color: GREY });
      } else if (s.image && s.image.data) {
        const im = s.image, boxH = h - 0.5;
        const r = Math.min(sw / (im.w || 1), boxH / (im.h || 1));
        slide.addImage({ data: im.data, x: sx, y: top, w: (im.w || 1) * r, h: (im.h || 1) * r });
        if (im.caption) slide.addText(str(im.caption), { x: sx, y: bottom - 0.4, w: sw, h: 0.35, fontFace: FONT, fontSize: 8.5, color: GREY });
      }

      const src = srcLine(s.sources);
      if (src) slide.addText("出典：" + clip(src, 260), { x: M, y: 6.85, w: W - 2 * M - 1, h: 0.45, fontFace: FONT, fontSize: 7.5, color: GREY, valign: "top" });
      slide.addText(`${i + 1} / ${plan.slides.length}`, { x: W - M - 1, y: 6.95, w: 1, h: 0.3, fontFace: FONT, fontSize: 9, color: GREY, align: "right" });
    });
    return pptx;
  }

  /* --------------------------------- Word --------------------------------- */
  function buildDocx(plan, docx) {
    const { Document, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, ShadingType, PageBreak, ImageRun, AlignmentType, BorderStyle } = docx;
    const run = (t, o) => new TextRun(Object.assign({ text: str(t), font: FONT }, o || {}));
    const para = (t, o, ro) => new Paragraph(Object.assign({ children: [run(t, ro)], spacing: { after: 120 } }, o || {}));
    const cellBorder = { style: BorderStyle.SINGLE, size: 4, color: LINE };
    const table = (headers, rows) => new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({ tableHeader: true, children: headers.map((h) => new TableCell({
          shading: { type: ShadingType.CLEAR, color: "auto", fill: NAVY },
          borders: { top: cellBorder, bottom: cellBorder, left: cellBorder, right: cellBorder },
          children: [new Paragraph({ children: [run(h, { bold: true, color: "FFFFFF", size: 18 })] })] })) }),
        ...rows.map((r, ri) => new TableRow({ children: r.map((c) => new TableCell({
          shading: { type: ShadingType.CLEAR, color: "auto", fill: ri % 2 ? "FFFFFF" : LIGHT },
          borders: { top: cellBorder, bottom: cellBorder, left: cellBorder, right: cellBorder },
          children: [new Paragraph({ children: [run(c, { size: 18 })] })] })) })),
      ],
    });

    const children = []; let no = 0; // the cover is not numbered
    (plan.slides || []).forEach((s) => {
      if (s.key === "cover") {
        children.push(new Paragraph({ spacing: { before: 2400, after: 240 }, children: [run(plan.title, { bold: true, size: 56, color: NAVY })] }));
        children.push(para(plan.subtitle, {}, { size: 28, color: GREY }));
        [s.lead, ...(s.bullets || [])].filter(Boolean).forEach((b) => children.push(para(b, {}, { size: 22 })));
        children.push(para(str(plan.date) + "　" + str(plan.footer), { spacing: { before: 600 } }, { size: 20, color: GREY }));
        return;
      }
      children.push(new Paragraph({ children: [new PageBreak()] }));
      children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { after: 160 }, children: [run(`${++no}. ${str(s.title)}`, { bold: true, size: 32, color: NAVY })] }));
      if (s.lead) children.push(para(s.lead, { spacing: { after: 200 } }, { size: 23, color: GREY, italics: true }));
      (s.bullets || []).filter(Boolean).forEach((b) => children.push(new Paragraph({ bullet: { level: 0 }, spacing: { after: 80 }, children: [run(b, { size: 22 })] })));

      if (s.chart && (s.chart.values || []).length) {
        const c = s.chart;
        children.push(para(str(c.title) + (c.unit ? "（" + c.unit + "）" : ""), { spacing: { before: 240, after: 80 } }, { bold: true, size: 21 }));
        children.push(table(["年", "値"], c.labels.map((l, k) => [str(l), str(c.values[k])])));
        if (c.source) children.push(para("出典：" + c.source, { spacing: { before: 60 } }, { size: 16, color: GREY }));
      }
      if (s.table && (s.table.rows || []).length) {
        children.push(new Paragraph({ spacing: { before: 200 }, children: [] }));
        children.push(table(s.table.headers.map(str), s.table.rows.map((r) => r.map(str))));
        if (s.table.caption) children.push(para(s.table.caption, { spacing: { before: 60 } }, { size: 16, color: GREY }));
      }
      if (s.image && s.image.bytes) {
        const im = s.image, maxW = 560, r = Math.min(1, maxW / (im.w || maxW));
        children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 200 }, children: [new ImageRun({ type: im.type || "png", data: im.bytes, transformation: { width: Math.round((im.w || maxW) * r), height: Math.round((im.h || maxW * 0.6) * r) } })] }));
        if (im.caption) children.push(para(im.caption, { alignment: AlignmentType.CENTER }, { size: 16, color: GREY }));
      }
      const src = srcLine(s.sources);
      if (src) children.push(para("出典：" + src, { spacing: { before: 240 } }, { size: 16, color: GREY }));
    });

    return new Document({
      creator: str(plan.footer), lastModifiedBy: str(plan.footer), title: str(plan.title), subject: str(plan.subtitle || ""),
      styles: { default: { document: { run: { font: FONT } } } },
      sections: [{ properties: { page: { margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } }, children }],
    });
  }

  const api = { buildPptx, buildDocx };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.FBExport = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
