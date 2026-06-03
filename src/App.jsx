import { jsPDF } from "jspdf";
import { useMemo, useState } from "react";

const LETTER_WIDTH = 11;
const LETTER_HEIGHT = 8.5;
const BOOKMARK_COUNT = 4;
const EDGE_GAP = 0.5;
const INTERVAL_GAP = 0.5;
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

function computeMaxBookmarkSize(aspectRatio) {
  const maxWidthFromHorizontal =
    (LETTER_WIDTH - 2 * EDGE_GAP - (BOOKMARK_COUNT - 1) * INTERVAL_GAP) / BOOKMARK_COUNT;
  const maxHeightFromVertical = LETTER_HEIGHT - 2 * EDGE_GAP;
  const maxWidthFromVertical = maxHeightFromVertical / aspectRatio;
  const width = Math.min(maxWidthFromHorizontal, maxWidthFromVertical);
  const height = width * aspectRatio;

  if (width <= 0 || height <= 0) {
    throw new Error("Could not compute a valid bookmark size.");
  }

  return { width, height };
}

function computeSingleRowPositions(bookmarkW, bookmarkH) {
  const rowW = BOOKMARK_COUNT * bookmarkW + (BOOKMARK_COUNT - 1) * INTERVAL_GAP;
  const startX = (LETTER_WIDTH - rowW) / 2;
  const y = (LETTER_HEIGHT - bookmarkH) / 2;

  if (startX < EDGE_GAP - 0.001 || y < EDGE_GAP - 0.001 || LETTER_HEIGHT - (y + bookmarkH) < EDGE_GAP - 0.001) {
    throw new Error("Layout does not satisfy the 0.5 inch edge spacing requirement.");
  }

  return Array.from({ length: BOOKMARK_COUNT }, (_, index) => ({
    x: startX + index * (bookmarkW + INTERVAL_GAP),
    y
  }));
}

async function ensureFontsLoaded(titleSize, lyricSize) {
  if (!document?.fonts?.load) return;
  await Promise.all([
    document.fonts.load(`${titleSize * 4}px "Allura"`),
    document.fonts.load(`${lyricSize * 4}px "Cormorant Garamond"`)
  ]);
}

function fitSingleLineTitle(ctx, title, maxWidth, startPx) {
  const family = '"Allura", "Alex Brush", "Great Vibes", cursive';
  const minPx = 34;
  let sizePx = startPx;
  let content = title;

  const measure = (text, px) => {
    ctx.font = `600 ${px}px ${family}`;
    return ctx.measureText(text).width;
  };

  while (sizePx > minPx && measure(content, sizePx) > maxWidth) {
    sizePx -= 2;
  }

  if (measure(content, sizePx) > maxWidth) {
    const ellipsis = "...";
    while (content.length > 1 && measure(`${content}${ellipsis}`, sizePx) > maxWidth) {
      content = content.slice(0, -1);
    }
    content = `${content}${ellipsis}`;
  }

  return { text: content, sizePx };
}

export default function App() {
  const [imageDataUrl, setImageDataUrl] = useState("");
  const [imageMeta, setImageMeta] = useState(null);
  const [songTitle, setSongTitle] = useState("");
  const [titleSize, setTitleSize] = useState(20);
  const [lyrics, setLyrics] = useState("");
  const [fontSize, setFontSize] = useState(11);
  const [textAlign, setTextAlign] = useState("center");

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);

  const aspectRatio = imageMeta ? imageMeta.height / imageMeta.width : FALLBACK_ASPECT_RATIO;
  const bookmarkSize = useMemo(() => computeMaxBookmarkSize(aspectRatio), [aspectRatio]);
  const bookmarkW = bookmarkSize.width;
  const bookmarkH = bookmarkSize.height;

  const fitMessage = useMemo(() => {
    try {
      computeSingleRowPositions(bookmarkW, bookmarkH);
      return "Layout fits: 4 bookmarks in one row with 0.5 in spacing from edges.";
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

    const imgRatio = imageMeta.width / imageMeta.height;
    const boxRatio = bookmarkW / bookmarkH;

    let drawW;
    let drawH;
    if (imgRatio > boxRatio) {
      drawW = bookmarkW;
      drawH = drawW / imgRatio;
    } else {
      drawH = bookmarkH;
      drawW = drawH * imgRatio;
    }

    const drawX = x + (bookmarkW - drawW) / 2;
    const drawY = y + (bookmarkH - drawH) / 2;
    const format = imageDataUrl.startsWith("data:image/png") ? "PNG" : "JPEG";
    pdf.addImage(imageDataUrl, format, drawX, drawY, drawW, drawH);
  };

  const drawBack = (pdf, pos) => {
    const { x, y } = pos;

    const canvasScale = 300;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bookmarkW * canvasScale));
    canvas.height = Math.max(1, Math.round(bookmarkH * canvasScale));
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Could not create canvas for back text rendering.");
    }

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const pad = 0.12 * canvasScale;
    const textX = x + pad;
    const textY = y + pad;
    const textW = canvas.width - pad * 2;
    const textH = canvas.height - pad * 2;

    const titlePx = titleSize * 4;
    const lyricsPx = fontSize * 4;

    let fittedTitle = null;
    let titleBlockH = 0;
    if (songTitle.trim()) {
      fittedTitle = fitSingleLineTitle(ctx, songTitle.trim(), textW, titlePx);
      const titleLineH = fittedTitle.sizePx * 0.86;
      const titleGap = fittedTitle.sizePx * 0.08;
      titleBlockH = titleLineH + titleGap;
    }

    const lyricsStartY = pad + titleBlockH;
    const lyricsAvailH = textH - titleBlockH;

    const lyricPdf = new jsPDF({ unit: "in", format: "letter" });
    lyricPdf.setFont("times", "normal");
    lyricPdf.setFontSize(fontSize);
    const maxLyricLines = Math.max(1, Math.floor(lyricsAvailH / (lyricsPx * 1.3)));
    const lines = wrapLyrics(lyricPdf, lyrics, textW / canvasScale, maxLyricLines);

    ctx.fillStyle = "#111111";
    if (songTitle.trim()) {
      ctx.font = `400 ${fittedTitle.sizePx}px \"Allura\", \"Alex Brush\", \"Great Vibes\", cursive`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(fittedTitle.text, canvas.width / 2, pad - fittedTitle.sizePx * 0.02);
    }

    if (lines.length === 0) {
      const png = canvas.toDataURL("image/png");
      pdf.addImage(png, "PNG", x, y, bookmarkW, bookmarkH);
      return;
    }

    ctx.font = `400 ${lyricsPx}px \"Cormorant Garamond\", \"EB Garamond\", \"Cormorant\", serif`;
    ctx.textBaseline = "top";
    const lineH = lyricsPx * 1.3;
    let cursorY = lyricsStartY;

    for (const line of lines) {
      if (textAlign === "left") {
        ctx.textAlign = "left";
        ctx.fillText(line, pad, cursorY);
      } else {
        ctx.textAlign = "center";
        ctx.fillText(line, canvas.width / 2, cursorY);
      }
      cursorY += lineH;
    }

    const backPng = canvas.toDataURL("image/png");
    pdf.addImage(backPng, "PNG", x, y, bookmarkW, bookmarkH);
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

    if (!imageDataUrl || !imageMeta) {
      setError("Upload a front image first.");
      return;
    }

    setIsGenerating(true);
    try {
      await ensureFontsLoaded(titleSize, fontSize);
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
        <p>4 bookmarks side-by-side. Image fills the entire front. Back is song title + lyrics, perfectly aligned.</p>
      </header>

      <main className="layout-grid single-column">
        <section className="panel design-panel">
          <label>
            Front image (PNG/JPG)
            <input type="file" accept="image/png,image/jpeg" onChange={handleImageUpload} />
          </label>

          <div className="info-card">
            Bookmark size is auto-maximized for 4 across with 0.5 in spacing and edge clearance.
            <br />
            Current width: <strong>{bookmarkW.toFixed(2)} in</strong>
            <br />
            Current height: <strong>{bookmarkH.toFixed(2)} in</strong>
          </div>

          <label>
            Song title
            <input
              type="text"
              value={songTitle}
              onChange={(e) => setSongTitle(e.target.value)}
              placeholder="Enter song title"
            />
          </label>

          <label>
            Song title font size ({titleSize} pt)
            <input
              type="range"
              min="14"
              max="36"
              value={titleSize}
              onChange={(e) => setTitleSize(Number(e.target.value))}
            />
          </label>

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
