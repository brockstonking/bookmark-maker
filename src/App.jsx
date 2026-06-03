import { jsPDF } from "jspdf";
import { useMemo, useState } from "react";

const LETTER_WIDTH = 11;
const LETTER_HEIGHT = 8.5;
const BOOKMARK_COUNT = 5;
const FALLBACK_ASPECT_RATIO = 5.5 / 2; // Height / width when no image has been uploaded yet.

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

function imageToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Could not read image file."));
    reader.readAsDataURL(file);
  });
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

function computeSingleRowPositions(bookmarkW, bookmarkH) {
  const sidePadding = 0.28;
  const topBottomPadding = 0.25;
  const footerReserved = 0.35;

  const availW = LETTER_WIDTH - sidePadding * 2;
  const gapX = (availW - BOOKMARK_COUNT * bookmarkW) / (BOOKMARK_COUNT - 1);

  if (gapX < 0) {
    throw new Error("Width is too large to place 5 bookmarks side-by-side on Letter landscape.");
  }

  const maxBookmarkH = LETTER_HEIGHT - topBottomPadding * 2 - footerReserved;
  if (bookmarkH > maxBookmarkH) {
    throw new Error("Image aspect ratio plus width makes bookmarks too tall for the page.");
  }

  const rowW = BOOKMARK_COUNT * bookmarkW + (BOOKMARK_COUNT - 1) * gapX;
  const startX = (LETTER_WIDTH - rowW) / 2;
  const y = (LETTER_HEIGHT - footerReserved - bookmarkH) / 2;

  return Array.from({ length: BOOKMARK_COUNT }, (_, index) => ({
    x: startX + index * (bookmarkW + gapX),
    y
  }));
}

export default function App() {
  const [bookmarkW, setBookmarkW] = useState(1.8);
  const [imageDataUrl, setImageDataUrl] = useState("");
  const [imageMeta, setImageMeta] = useState(null);
  const [lyrics, setLyrics] = useState("");
  const [fontSize, setFontSize] = useState(11);
  const [textAlign, setTextAlign] = useState("center");

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);

  const aspectRatio = imageMeta ? imageMeta.height / imageMeta.width : FALLBACK_ASPECT_RATIO;
  const bookmarkH = bookmarkW * aspectRatio;

  const fitMessage = useMemo(() => {
    try {
      computeSingleRowPositions(bookmarkW, bookmarkH);
      return "Layout fits: 5 bookmarks in one side-by-side row.";
    } catch (err) {
      return err instanceof Error ? err.message : "Layout is invalid.";
    }
  }, [bookmarkW, bookmarkH]);

  const handleImageUpload = async (event) => {
    setError("");
    setMessage("");

    const file = event.target.files?.[0];
    if (!file) {
      setImageDataUrl("");
      setImageMeta(null);
      return;
    }

    try {
      const dataUrl = await imageToDataUrl(file);
      const dimensions = await loadImageDimensions(dataUrl);
      setImageDataUrl(dataUrl);
      setImageMeta(dimensions);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load uploaded image.");
    }
  };

  const drawFront = (pdf, pos) => {
    const { x, y } = pos;

    pdf.setDrawColor(0, 0, 0);
    pdf.setLineWidth(0.01);
    pdf.rect(x, y, bookmarkW, bookmarkH);

    const pad = 0.08;
    const contentX = x + pad;
    const contentY = y + pad;
    const contentW = bookmarkW - pad * 2;
    const contentH = bookmarkH - pad * 2;

    const imgRatio = imageMeta.width / imageMeta.height;
    const boxRatio = contentW / contentH;

    let drawW;
    let drawH;
    if (imgRatio > boxRatio) {
      drawW = contentW;
      drawH = drawW / imgRatio;
    } else {
      drawH = contentH;
      drawW = drawH * imgRatio;
    }

    const drawX = contentX + (contentW - drawW) / 2;
    const drawY = contentY + (contentH - drawH) / 2;
    const format = imageDataUrl.startsWith("data:image/png") ? "PNG" : "JPEG";
    pdf.addImage(imageDataUrl, format, drawX, drawY, drawW, drawH);
  };

  const drawBack = (pdf, pos) => {
    const { x, y } = pos;

    pdf.setDrawColor(0, 0, 0);
    pdf.setLineWidth(0.01);
    pdf.rect(x, y, bookmarkW, bookmarkH);

    const pad = 0.12;
    const textX = x + pad;
    const textY = y + pad;
    const textW = bookmarkW - pad * 2;
    const textH = bookmarkH - pad * 2;

    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(fontSize);

    const lineH = (fontSize / 72) * 1.3;
    const maxLines = Math.max(1, Math.floor(textH / lineH));
    const lines = wrapLyrics(pdf, lyrics, textW, maxLines);

    if (lines.length === 0) {
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
      LETTER_HEIGHT - 0.12,
      { align: "center" }
    );
  };

  const generatePdf = async () => {
    setError("");
    setMessage("");

    if (!imageDataUrl || !imageMeta) {
      setError("Upload a front image first.");
      return;
    }

    setIsGenerating(true);
    try {
      const positions = computeSingleRowPositions(bookmarkW, bookmarkH);

      const pdf = new jsPDF({
        orientation: "landscape",
        unit: "in",
        format: "letter"
      });

      for (const pos of positions) {
        drawFront(pdf, pos);
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
        <p>5 bookmarks side-by-side. Upload front image, paste lyrics, set width/font/alignment, export PDF.</p>
      </header>

      <main className="layout-grid single-column">
        <section className="panel design-panel">
          <label>
            Front image (PNG/JPG)
            <input type="file" accept="image/png,image/jpeg" onChange={handleImageUpload} />
          </label>

          <label>
            Bookmark width ({bookmarkW.toFixed(2)} in)
            <input
              type="range"
              min="1.2"
              max="2.4"
              step="0.05"
              value={bookmarkW}
              onChange={(e) => setBookmarkW(Number(e.target.value))}
            />
          </label>

          <div className="info-card">
            Height is locked to uploaded image aspect ratio.
            <br />
            Current height: <strong>{bookmarkH.toFixed(2)} in</strong>
          </div>

          <label>
            Lyrics
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

          <div className={fitMessage.includes("fits") ? "ok-note" : "warn-note"}>{fitMessage}</div>

          <button className="primary-button" onClick={generatePdf} disabled={isGenerating}>
            {isGenerating ? "Generating..." : "Generate Double-Sided PDF"}
          </button>

          <div className="print-note">Print double-sided, flip on short edge. Use cardstock for best results.</div>

          {message ? <div className="success-box">✅ {message}</div> : null}
          {error ? <div className="error-box">⚠️ {error}</div> : null}
        </section>
      </main>
    </div>
  );
}
