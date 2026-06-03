import { jsPDF } from "jspdf";
import { useMemo, useState } from "react";

const LETTER_WIDTH = 11;
const LETTER_HEIGHT = 8.5;
const BOOKMARK_COUNT = 5;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function computePositions({
  pageW,
  pageH,
  count,
  cols,
  rows,
  bookmarkW,
  bookmarkH,
  marginX,
  marginY
}) {
  const availW = pageW - marginX * 2;
  const availH = pageH - marginY * 2;

  if (bookmarkW * cols > availW || bookmarkH * rows > availH) {
    throw new Error("Bookmarks do not fit. Reduce size or margins.");
  }

  const gapX = cols === 1 ? 0 : (availW - cols * bookmarkW) / (cols - 1);
  const gapY = rows === 1 ? 0 : (availH - rows * bookmarkH) / (rows - 1);

  if (gapX < 0 || gapY < 0) {
    throw new Error("Negative spacing detected. Adjust dimensions.");
  }

  const positions = [];
  let remaining = count;

  for (let row = 0; row < rows && remaining > 0; row += 1) {
    const rowCount = Math.min(cols, remaining);
    const rowW = rowCount * bookmarkW + (rowCount - 1) * gapX;
    const startX = marginX + (availW - rowW) / 2;
    const y = marginY + row * (bookmarkH + gapY);

    for (let col = 0; col < rowCount; col += 1) {
      positions.push({ x: startX + col * (bookmarkW + gapX), y });
    }

    remaining -= rowCount;
  }

  if (positions.length !== count) {
    throw new Error("Could not place exactly 5 bookmarks with this layout.");
  }

  return positions;
}

function loadImageDimensions(dataUrl) {
  if (!dataUrl) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error("Could not read uploaded image."));
    img.src = dataUrl;
  });
}

function wrapLyrics(pdf, text, maxWidth, maxLines) {
  const source = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const paragraphs = source.split("\n");
  const lines = [];

  for (const paragraph of paragraphs) {
    if (paragraph.trim() === "") {
      lines.push("");
      if (lines.length >= maxLines) break;
      continue;
    }

    const wrapped = pdf.splitTextToSize(paragraph, maxWidth);
    for (const line of wrapped) {
      lines.push(line);
      if (lines.length >= maxLines) break;
    }

    if (lines.length >= maxLines) break;
  }

  return lines.slice(0, maxLines);
}

export default function App() {
  const [bookmarkW, setBookmarkW] = useState(2.0);
  const [bookmarkH, setBookmarkH] = useState(5.5);
  const [marginX, setMarginX] = useState(0.5);
  const [marginY, setMarginY] = useState(0.4);
  const [cols, setCols] = useState(3);
  const [rows, setRows] = useState(2);
  const [cutLines, setCutLines] = useState(true);

  const [frontTitle, setFrontTitle] = useState("");
  const [imageDataUrl, setImageDataUrl] = useState("");
  const [lyrics, setLyrics] = useState("");
  const [fontSize, setFontSize] = useState(11);
  const [textAlign, setTextAlign] = useState("center");

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);

  const fitNote = useMemo(() => {
    try {
      computePositions({
        pageW: LETTER_WIDTH,
        pageH: LETTER_HEIGHT,
        count: BOOKMARK_COUNT,
        cols,
        rows,
        bookmarkW,
        bookmarkH,
        marginX,
        marginY
      });
      return "Layout fits Letter landscape."
    } catch (err) {
      return err.message;
    }
  }, [bookmarkW, bookmarkH, marginX, marginY, cols, rows]);

  const handleImageUpload = (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      setImageDataUrl("");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => setImageDataUrl(String(reader.result || ""));
    reader.onerror = () => setError("Could not read image file.");
    reader.readAsDataURL(file);
  };

  const drawCutBorder = (pdf, x, y, w, h) => {
    pdf.setLineWidth(0.005);
    pdf.setLineDashPattern([0.04, 0.03], 0);
    pdf.rect(x - 0.04, y - 0.04, w + 0.08, h + 0.08);
    pdf.setLineDashPattern([], 0);
    pdf.setLineWidth(0.01);
  };

  const drawFront = (pdf, pos, imgMeta) => {
    const { x, y } = pos;
    const w = bookmarkW;
    const h = bookmarkH;

    pdf.setDrawColor(0, 0, 0);
    pdf.setLineWidth(0.01);
    pdf.rect(x, y, w, h);

    if (cutLines) {
      drawCutBorder(pdf, x, y, w, h);
    }

    const pad = 0.12;
    const contentX = x + pad;
    const contentY = y + pad;
    const contentW = w - pad * 2;
    const contentH = h - pad * 2;

    let titleReserved = 0;
    if (frontTitle.trim()) {
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(12);
      titleReserved = Math.min(0.55, contentH * 0.3);
      const titleLines = pdf.splitTextToSize(frontTitle.trim(), contentW);
      const titleLineHeight = 12 / 72 * 1.15;
      titleReserved = clamp(titleLines.length * titleLineHeight + 0.08, 0.2, titleReserved);
      let titleY = contentY + titleLineHeight;
      for (const line of titleLines) {
        pdf.text(line, contentX + contentW / 2, titleY, { align: "center" });
        titleY += titleLineHeight;
      }
    }

    const imageY = contentY + titleReserved;
    const imageH = contentH - titleReserved;

    if (imageDataUrl && imgMeta && imageH > 0.2) {
      const imgRatio = imgMeta.width / imgMeta.height;
      const boxRatio = contentW / imageH;
      let drawW;
      let drawH;

      if (imgRatio > boxRatio) {
        drawW = contentW;
        drawH = drawW / imgRatio;
      } else {
        drawH = imageH;
        drawW = drawH * imgRatio;
      }

      const drawX = contentX + (contentW - drawW) / 2;
      const drawY = imageY + (imageH - drawH) / 2;
      const format = imageDataUrl.startsWith("data:image/png") ? "PNG" : "JPEG";
      pdf.addImage(imageDataUrl, format, drawX, drawY, drawW, drawH);
    } else {
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(9);
      pdf.setTextColor(90, 90, 90);
      pdf.text("Your front design appears here", contentX + contentW / 2, imageY + imageH / 2, { align: "center" });
      pdf.setTextColor(0, 0, 0);
    }
  };

  const drawBack = (pdf, pos) => {
    const { x, y } = pos;
    const w = bookmarkW;
    const h = bookmarkH;

    pdf.setDrawColor(0, 0, 0);
    pdf.setLineWidth(0.01);
    pdf.rect(x, y, w, h);

    if (cutLines) {
      drawCutBorder(pdf, x, y, w, h);
    }

    const pad = 0.14;
    const textX = x + pad;
    const textY = y + pad;
    const textW = w - pad * 2;
    const textH = h - pad * 2;

    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(fontSize);

    const lineH = (fontSize / 72) * 1.3;
    const maxLines = Math.max(1, Math.floor(textH / lineH));
    const lines = wrapLyrics(pdf, lyrics, textW, maxLines);

    if (lines.length === 0) {
      pdf.setFontSize(10);
      pdf.setTextColor(90, 90, 90);
      pdf.text("Paste lyrics in the box to print on bookmark backs.", textX + textW / 2, textY + textH / 2, { align: "center" });
      pdf.setTextColor(0, 0, 0);
      return;
    }

    const blockH = lines.length * lineH;
    let cursorY = textY + Math.max(0, (textH - blockH) / 2) + lineH * 0.85;

    for (const line of lines) {
      if (textAlign === "left") {
        pdf.text(line, textX, cursorY, { align: "left" });
      } else {
        pdf.text(line, textX + textW / 2, cursorY, { align: "center" });
      }
      cursorY += lineH;
    }
  };

  const drawFooter = (pdf) => {
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9);
    pdf.text(
      "Print double-sided, flip on short edge. Use cardstock for best results.",
      LETTER_WIDTH / 2,
      LETTER_HEIGHT - 0.18,
      { align: "center" }
    );
  };

  const generatePdf = async () => {
    setError("");
    setMessage("");
    setIsGenerating(true);

    try {
      const positions = computePositions({
        pageW: LETTER_WIDTH,
        pageH: LETTER_HEIGHT,
        count: BOOKMARK_COUNT,
        cols,
        rows,
        bookmarkW,
        bookmarkH,
        marginX,
        marginY
      });

      const imageMeta = await loadImageDimensions(imageDataUrl);

      const pdf = new jsPDF({
        orientation: "landscape",
        unit: "in",
        format: "letter"
      });

      for (const pos of positions) {
        drawFront(pdf, pos, imageMeta);
      }
      drawFooter(pdf);

      pdf.addPage("letter", "landscape");
      for (const pos of positions) {
        drawBack(pdf, pos);
      }
      drawFooter(pdf);

      pdf.save("bookmark-maker-double-sided.pdf");
      setMessage("PDF generated. Download should begin automatically.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not generate PDF.");
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="page-shell">
      <header className="hero">
        <h1>🔖 Bookmark Maker - Double-Sided Song Lyrics</h1>
        <p>
          Build perfectly aligned two-page PDFs for 5 bookmarks on Letter landscape sheets.
          Fronts on page 1, matching lyric backs on page 2.
        </p>
      </header>

      <main className="layout-grid">
        <aside className="panel settings-panel">
          <h2>⚙️ Layout Settings</h2>
          <label>
            Bookmark width (in)
            <input type="number" min="1" max="4" step="0.1" value={bookmarkW} onChange={(e) => setBookmarkW(Number(e.target.value))} />
          </label>
          <label>
            Bookmark height (in)
            <input type="number" min="3" max="7.5" step="0.1" value={bookmarkH} onChange={(e) => setBookmarkH(Number(e.target.value))} />
          </label>
          <label>
            Left/Right margin (in)
            <input type="number" min="0.2" max="1.5" step="0.05" value={marginX} onChange={(e) => setMarginX(Number(e.target.value))} />
          </label>
          <label>
            Top/Bottom margin (in)
            <input type="number" min="0.2" max="1.5" step="0.05" value={marginY} onChange={(e) => setMarginY(Number(e.target.value))} />
          </label>
          <label>
            Columns
            <select value={cols} onChange={(e) => setCols(Number(e.target.value))}>
              <option value={2}>2</option>
              <option value={3}>3</option>
              <option value={4}>4</option>
            </select>
          </label>
          <label>
            Rows
            <select value={rows} onChange={(e) => setRows(Number(e.target.value))}>
              <option value={2}>2</option>
              <option value={3}>3</option>
            </select>
          </label>
          <label className="checkbox-row">
            <input type="checkbox" checked={cutLines} onChange={(e) => setCutLines(e.target.checked)} />
            Show dashed cut lines
          </label>

          <div className="info-card">
            <strong>Preset tip:</strong> 3 columns and 2 rows gives a clean 3-over-2 centered layout for 5 bookmarks.
          </div>
          <div className={fitNote.includes("fits") ? "ok-note" : "warn-note"}>{fitNote}</div>
        </aside>

        <section className="panel design-panel">
          <h2>🎨 Front Design</h2>
          <label>
            Front title (optional)
            <input
              type="text"
              value={frontTitle}
              onChange={(e) => setFrontTitle(e.target.value)}
              placeholder="Favorite Song / Artist"
            />
          </label>
          <label>
            Front image (PNG/JPG)
            <input type="file" accept="image/png,image/jpeg" onChange={handleImageUpload} />
          </label>

          <h2>🎵 Back Design</h2>
          <label>
            Paste song lyrics
            <textarea
              rows={12}
              value={lyrics}
              onChange={(e) => setLyrics(e.target.value)}
              placeholder="Paste full lyrics here..."
            />
          </label>

          <label>
            Lyrics font size ({fontSize} pt)
            <input
              type="range"
              min="8"
              max="18"
              value={fontSize}
              onChange={(e) => setFontSize(Number(e.target.value))}
            />
          </label>

          <label>
            Lyrics alignment
            <select value={textAlign} onChange={(e) => setTextAlign(e.target.value)}>
              <option value="center">Center</option>
              <option value="left">Left</option>
            </select>
          </label>

          <button className="primary-button" onClick={generatePdf} disabled={isGenerating}>
            {isGenerating ? "Generating..." : "Generate Double-Sided PDF"}
          </button>

          <div className="print-note">
            Print double-sided, flip on short edge. Use cardstock for best results.
          </div>

          {message ? <div className="success-box">✅ {message}</div> : null}
          {error ? <div className="error-box">⚠️ {error}</div> : null}
        </section>
      </main>
    </div>
  );
}
