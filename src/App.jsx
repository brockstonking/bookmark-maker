import { jsPDF } from "jspdf";
import { useEffect, useMemo, useRef, useState } from "react";
import templeBackImage from "../assets/images/Rexburg_temple_golden.jpg";

const LETTER_WIDTH = 11;
const LETTER_HEIGHT = 8.5;
const BOOKMARK_COUNT = 4;
const EDGE_GAP = 0.5;
const INTERVAL_GAP = 0.5;
const FALLBACK_ASPECT_RATIO = 5.5 / 2; // Height / width when no image has been uploaded yet.

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

function loadHtmlImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not decode uploaded image."));
    img.src = dataUrl;
  });
}

async function autoCropFrontContent(dataUrl) {
  const img = await loadHtmlImage(dataUrl);

  const maxDetectSize = 1200;
  const detectScale = Math.min(1, maxDetectSize / Math.max(img.naturalWidth, img.naturalHeight));
  const detectW = Math.max(1, Math.round(img.naturalWidth * detectScale));
  const detectH = Math.max(1, Math.round(img.naturalHeight * detectScale));

  const detectCanvas = document.createElement("canvas");
  detectCanvas.width = detectW;
  detectCanvas.height = detectH;
  const dctx = detectCanvas.getContext("2d", { willReadFrequently: true });
  if (!dctx) {
    return { dataUrl, width: img.naturalWidth, height: img.naturalHeight };
  }

  dctx.drawImage(img, 0, 0, detectW, detectH);
  const imageData = dctx.getImageData(0, 0, detectW, detectH);
  const px = imageData.data;

  const samplePixel = (x, y) => {
    const i = (y * detectW + x) * 4;
    return [px[i], px[i + 1], px[i + 2], px[i + 3]];
  };

  let rSum = 0;
  let gSum = 0;
  let bSum = 0;
  let aSum = 0;
  let count = 0;

  // Estimate background color from a sparse ring near the outer edges.
  const inset = Math.max(1, Math.floor(Math.min(detectW, detectH) * 0.015));
  const xStep = Math.max(2, Math.floor(detectW / 120));
  const yStep = Math.max(2, Math.floor(detectH / 120));

  for (let x = inset; x < detectW - inset; x += xStep) {
    const top = samplePixel(x, inset);
    const bottom = samplePixel(x, detectH - inset - 1);
    rSum += top[0] + bottom[0];
    gSum += top[1] + bottom[1];
    bSum += top[2] + bottom[2];
    aSum += top[3] + bottom[3];
    count += 2;
  }
  for (let y = inset; y < detectH - inset; y += yStep) {
    const left = samplePixel(inset, y);
    const right = samplePixel(detectW - inset - 1, y);
    rSum += left[0] + right[0];
    gSum += left[1] + right[1];
    bSum += left[2] + right[2];
    aSum += left[3] + right[3];
    count += 2;
  }

  if (count === 0) {
    return { dataUrl, width: img.naturalWidth, height: img.naturalHeight };
  }

  const bgR = rSum / count;
  const bgG = gSum / count;
  const bgB = bSum / count;
  const bgA = aSum / count;

  const diffThreshold = 58;
  let minX = detectW;
  let minY = detectH;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < detectH; y += 1) {
    for (let x = 0; x < detectW; x += 1) {
      const i = (y * detectW + x) * 4;
      const dr = Math.abs(px[i] - bgR);
      const dg = Math.abs(px[i + 1] - bgG);
      const db = Math.abs(px[i + 2] - bgB);
      const da = Math.abs(px[i + 3] - bgA) * 0.25;
      const diff = dr + dg + db + da;

      if (diff > diffThreshold) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < minX || maxY < minY) {
    return { dataUrl, width: img.naturalWidth, height: img.naturalHeight };
  }

  const boxW = maxX - minX + 1;
  const boxH = maxY - minY + 1;
  const areaRatio = (boxW * boxH) / (detectW * detectH);

  // If there is no meaningful border to trim, keep original.
  if (areaRatio > 0.96) {
    return { dataUrl, width: img.naturalWidth, height: img.naturalHeight };
  }

  const pad = Math.max(2, Math.floor(Math.min(detectW, detectH) * 0.008));
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(detectW - 1, maxX + pad);
  maxY = Math.min(detectH - 1, maxY + pad);

  const sx = Math.round((minX / detectW) * img.naturalWidth);
  const sy = Math.round((minY / detectH) * img.naturalHeight);
  const sw = Math.max(1, Math.round(((maxX - minX + 1) / detectW) * img.naturalWidth));
  const sh = Math.max(1, Math.round(((maxY - minY + 1) / detectH) * img.naturalHeight));

  const cropCanvas = document.createElement("canvas");
  cropCanvas.width = sw;
  cropCanvas.height = sh;
  const cctx = cropCanvas.getContext("2d");
  if (!cctx) {
    return { dataUrl, width: img.naturalWidth, height: img.naturalHeight };
  }

  cctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  const croppedDataUrl = cropCanvas.toDataURL("image/jpeg", 0.95);
  return { dataUrl: croppedDataUrl, width: sw, height: sh };
}

function normalizeHexColor(value) {
  const raw = (value || "").trim();
  const shortMatch = raw.match(/^#([0-9a-fA-F]{3})$/);
  if (shortMatch) {
    const [r, g, b] = shortMatch[1].split("");
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }

  const longMatch = raw.match(/^#([0-9a-fA-F]{6})$/);
  if (longMatch) {
    return `#${longMatch[1].toUpperCase()}`;
  }

  return null;
}

function hexToRgba(hex, alpha) {
  const normalized = normalizeHexColor(hex) || "#FFFFFF";
  const r = parseInt(normalized.slice(1, 3), 16);
  const g = parseInt(normalized.slice(3, 5), 16);
  const b = parseInt(normalized.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
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

async function ensureFontsLoaded(titleSize, lyricSize, titleFont) {
  if (!document?.fonts?.load) return;
  await Promise.all([
    document.fonts.load(`${titleSize * 4}px "${titleFont}"`),
    document.fonts.load(`${lyricSize * 4}px "Cormorant Garamond"`)
  ]);
}

function fitSingleLineTitle(ctx, title, maxWidth, startPx, titleFont) {
  const family = titleFont === "Beau Rivage"
    ? '"Beau Rivage", "Allura", "Alex Brush", cursive'
    : '"Allura", "Alex Brush", "Great Vibes", cursive';
  const minPx = 34;
  let sizePx = startPx;
  let content = title;

  const measure = (text, px) => {
    ctx.font = `400 ${px}px ${family}`;
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

function getLyricsSegmentsFromHtml(html) {
  if (!html) return [];

  const root = document.createElement("div");
  root.innerHTML = html;

  const segments = [];

  const pushText = (text, italic) => {
    const normalized = text.replace(/\u00a0/g, " ");
    if (!normalized) return;
    const prev = segments[segments.length - 1];
    if (prev && !prev.newline && prev.italic === italic) {
      prev.text += normalized;
    } else {
      segments.push({ text: normalized, italic });
    }
  };

  const pushNewline = () => {
    segments.push({ newline: true });
  };

  const walk = (node, inheritedItalic) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const content = node.textContent || "";
      const parts = content.split("\n");
      parts.forEach((part, index) => {
        if (part.length > 0) {
          pushText(part, inheritedItalic);
        }
        if (index < parts.length - 1) {
          pushNewline();
        }
      });
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return;
    }

    const tag = node.tagName.toLowerCase();
    if (tag === "br") {
      pushNewline();
      return;
    }

    const styleItalic = node.style && node.style.fontStyle === "italic";
    const currentItalic = inheritedItalic || tag === "i" || tag === "em" || styleItalic;
    const isBlock = tag === "div" || tag === "p" || tag === "li";

    node.childNodes.forEach((child) => walk(child, currentItalic));

    if (isBlock) {
      const prev = segments[segments.length - 1];
      if (prev && !prev.newline) {
        pushNewline();
      }
    }
  };

  root.childNodes.forEach((child) => walk(child, false));

  return segments;
}

function wrapStyledSegments(ctx, segments, maxWidth, maxLines, fontPx, fontFamily) {
  const setFont = (italic) => {
    ctx.font = `${italic ? "italic" : "normal"} 400 ${fontPx}px ${fontFamily}`;
  };

  const tokenWidth = (token, italic) => {
    setFont(italic);
    return ctx.measureText(token).width;
  };

  const lines = [];
  let line = [];
  let lineWidth = 0;

  const pushLine = () => {
    if (lines.length >= maxLines) return;
    lines.push({ segments: line, width: lineWidth });
    line = [];
    lineWidth = 0;
  };

  const appendToken = (token, italic) => {
    if (!token) return;
    const width = tokenWidth(token, italic);
    const last = line[line.length - 1];
    if (last && last.italic === italic) {
      last.text += token;
      last.width += width;
    } else {
      line.push({ text: token, italic, width });
    }
    lineWidth += width;
  };

  for (const segment of segments) {
    if (lines.length >= maxLines) break;

    if (segment.newline) {
      pushLine();
      continue;
    }

    const tokens = segment.text.split(/(\s+)/);

    for (const token of tokens) {
      if (!token) continue;
      if (lines.length >= maxLines) break;

      const width = tokenWidth(token, segment.italic);
      const fits = lineWidth + width <= maxWidth;

      if (fits || line.length === 0) {
        appendToken(token, segment.italic);
        continue;
      }

      if (token.trim() === "") {
        continue;
      }

      pushLine();
      if (lines.length >= maxLines) break;

      const tokenFitsOnEmptyLine = tokenWidth(token, segment.italic) <= maxWidth;
      if (tokenFitsOnEmptyLine) {
        appendToken(token, segment.italic);
        continue;
      }

      for (const char of token) {
        const charW = tokenWidth(char, segment.italic);
        if (lineWidth + charW > maxWidth && line.length > 0) {
          pushLine();
          if (lines.length >= maxLines) break;
        }
        appendToken(char, segment.italic);
      }
    }
  }

  if (line.length > 0 && lines.length < maxLines) {
    pushLine();
  }

  return lines;
}

function trimLeadingSpaces(tokens) {
  const out = [...tokens];
  while (out.length > 0 && out[0].text.trim() === "") {
    out.shift();
  }
  return out;
}

function trimTrailingSpaces(tokens) {
  const out = [...tokens];
  while (out.length > 0 && out[out.length - 1].text.trim() === "") {
    out.pop();
  }
  return out;
}

function lineToTokens(line) {
  const tokens = [];
  for (const segment of line.segments) {
    const parts = segment.text.split(/(\s+)/).filter(Boolean);
    for (const part of parts) {
      tokens.push({ text: part, italic: segment.italic });
    }
  }
  return tokens;
}

function tokensToLine(tokens, ctx, fontPx, fontFamily) {
  const merged = [];
  let width = 0;

  for (const token of tokens) {
    ctx.font = `${token.italic ? "italic" : "normal"} 400 ${fontPx}px ${fontFamily}`;
    const tokenWidth = ctx.measureText(token.text).width;
    const prev = merged[merged.length - 1];
    if (prev && prev.italic === token.italic) {
      prev.text += token.text;
      prev.width += tokenWidth;
    } else {
      merged.push({ text: token.text, italic: token.italic, width: tokenWidth });
    }
    width += tokenWidth;
  }

  return { segments: merged, width };
}

function wordCountInLine(line) {
  const text = line.segments.map((segment) => segment.text).join("").trim();
  if (!text) return 0;
  return text.split(/\s+/).filter(Boolean).length;
}

function rebalanceSingleWordLines(lines, maxWidth, ctx, fontPx, fontFamily) {
  if (lines.length < 2) return lines;
  const out = lines.map((line) => ({ ...line, segments: [...line.segments] }));

  for (let i = 1; i < out.length; i += 1) {
    const current = out[i];
    const previous = out[i - 1];
    if (wordCountInLine(current) !== 1 || wordCountInLine(previous) < 3) {
      continue;
    }

    let prevTokens = trimTrailingSpaces(lineToTokens(previous));
    let curTokens = trimLeadingSpaces(lineToTokens(current));

    let lastWordIndex = -1;
    for (let idx = prevTokens.length - 1; idx >= 0; idx -= 1) {
      if (prevTokens[idx].text.trim() !== "") {
        lastWordIndex = idx;
        break;
      }
    }
    if (lastWordIndex < 0) continue;

    const movedWord = prevTokens[lastWordIndex];
    prevTokens = trimTrailingSpaces(prevTokens.slice(0, lastWordIndex));

    const newCurrentTokens = [movedWord];
    if (curTokens.length > 0) {
      newCurrentTokens.push({ text: " ", italic: movedWord.italic });
      newCurrentTokens.push(...curTokens);
    }

    const prevCandidate = tokensToLine(prevTokens, ctx, fontPx, fontFamily);
    const curCandidate = tokensToLine(newCurrentTokens, ctx, fontPx, fontFamily);

    if (prevCandidate.width <= maxWidth && curCandidate.width <= maxWidth) {
      out[i - 1] = prevCandidate;
      out[i] = curCandidate;
    }
  }

  return out;
}

function suggestLyricsFontSize({
  minPt,
  maxPt,
  textW,
  lyricsAvailH,
  segments,
  fontFamily,
  targetFill,
  ctx
}) {
  let best = minPt;
  let bestScore = Number.POSITIVE_INFINITY;

  for (let pt = maxPt; pt >= minPt; pt -= 0.25) {
    const px = pt * 4;
    const lineH = px * 1.3;
    const maxLines = Math.max(1, Math.floor(lyricsAvailH / lineH));
    const rawAllLines = wrapStyledSegments(ctx, segments, textW, Number.MAX_SAFE_INTEGER, px, fontFamily);
    const overflowLines = Math.max(0, rawAllLines.length - maxLines);
    const rawLines = rawAllLines.slice(0, maxLines);
    const lines = rebalanceSingleWordLines(rawLines, textW, ctx, px, fontFamily);

    const usedH = lines.length * lineH;
    const fill = lyricsAvailH > 0 ? usedH / lyricsAvailH : 0;
    const orphanCount = lines.filter((line) => wordCountInLine(line) === 1).length;

    const fillPenalty = Math.abs(fill - targetFill);
    const orphanPenalty = orphanCount * 0.5;
    const overflowPenalty = overflowLines * 2.5;
    const score = fillPenalty + orphanPenalty + overflowPenalty;

    if (score < bestScore) {
      bestScore = score;
      best = Number(pt.toFixed(2));
    }
  }

  return best;
}

export default function App() {
  const [imageDataUrl, setImageDataUrl] = useState("");
  const [imageMeta, setImageMeta] = useState(null);
  const [backColorHex, setBackColorHex] = useState("#FFFFFF");
  const [backImageElement, setBackImageElement] = useState(null);
  const [songTitle, setSongTitle] = useState("");
  const [titleFont, setTitleFont] = useState("Allura");
  const [titleSize, setTitleSize] = useState(20);
  const [lyricsHtml, setLyricsHtml] = useState("");
  const [fontSize, setFontSize] = useState(11);
  const [suggestedFontSize, setSuggestedFontSize] = useState(11);
  const [textAlign, setTextAlign] = useState("center");

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);

  const lyricsEditorRef = useRef(null);

  useEffect(() => {
    if (lyricsEditorRef.current && lyricsEditorRef.current.innerHTML !== lyricsHtml) {
      lyricsEditorRef.current.innerHTML = lyricsHtml;
    }
  }, [lyricsHtml]);

  useEffect(() => {
    let active = true;
    loadHtmlImage(templeBackImage)
      .then((img) => {
        if (active) {
          setBackImageElement(img);
        }
      })
      .catch(() => {
        if (active) {
          setBackImageElement(null);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  const aspectRatio = imageMeta ? imageMeta.height / imageMeta.width : FALLBACK_ASPECT_RATIO;
  const effectiveBackColor = normalizeHexColor(backColorHex) || "#FFFFFF";
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

  useEffect(() => {
    const segments = getLyricsSegmentsFromHtml(lyricsHtml);
    if (segments.length === 0) {
      setSuggestedFontSize(fontSize);
      return;
    }

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bookmarkW * 300));
    canvas.height = Math.max(1, Math.round(bookmarkH * 300));
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const pad = 0.12 * 300;
    const textW = canvas.width - pad * 2;
    const textH = canvas.height - pad * 2;
    const titlePx = titleSize * 4;

    let titleBlockH = 0;
    if (songTitle.trim()) {
      const fitted = fitSingleLineTitle(ctx, songTitle.trim(), textW, titlePx, titleFont);
      titleBlockH = fitted.sizePx * 0.86 + fitted.sizePx * 0.08;
    }

    const decorativeReserved = backImageElement ? canvas.height * 0.25 : 0;
    const lyricsAvailH = Math.max(0, textH - titleBlockH - decorativeReserved);
    const family = '"Cormorant Garamond", "EB Garamond", "Cormorant", serif';
    const suggestion = suggestLyricsFontSize({
      minPt: 8,
      maxPt: 18,
      textW,
      lyricsAvailH,
      segments,
      fontFamily: family,
      targetFill: 0.85,
      ctx
    });
    setSuggestedFontSize(suggestion);
  }, [lyricsHtml, bookmarkW, bookmarkH, songTitle, titleSize, titleFont, backImageElement, fontSize]);

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
      const cropped = await autoCropFrontContent(dataUrl);
      setImageDataUrl(cropped.dataUrl);
      setImageMeta({ width: cropped.width, height: cropped.height });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load uploaded image.");
    }
  };

  const handleLyricsInput = (event) => {
    setLyricsHtml(event.currentTarget.innerHTML);
  };

  const handleLyricsKeyDown = (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "i") {
      event.preventDefault();
      document.execCommand("italic");
      setLyricsHtml(lyricsEditorRef.current?.innerHTML || "");
    }
  };

  const makeItalicSelection = () => {
    lyricsEditorRef.current?.focus();
    document.execCommand("italic");
    setLyricsHtml(lyricsEditorRef.current?.innerHTML || "");
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

    ctx.fillStyle = effectiveBackColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const bottomImageHeight = Math.round(canvas.height * 0.25);
    if (backImageElement && bottomImageHeight > 0) {
      const fullImageTop = Math.round(canvas.height * 0.645);
      const fullImageBottom = canvas.height;
      const fullImageH = fullImageBottom - fullImageTop;
      const fullImageW = canvas.width;
      const fullOpaqueTop = canvas.height - bottomImageHeight;

      const imgRatio = backImageElement.naturalWidth / backImageElement.naturalHeight;
      const boxRatio = fullImageW / fullImageH;
      let drawW;
      let drawH;

      if (imgRatio > boxRatio) {
        drawH = fullImageH;
        drawW = drawH * imgRatio;
      } else {
        drawW = fullImageW;
        drawH = drawW / imgRatio;
      }

      const drawX = (fullImageW - drawW) / 2;
      // Pin the image to the bookmark bottom and crop overflow from the top.
      const drawY = fullImageBottom - drawH;

      // Draw image on its own layer, then apply a vertical alpha mask for a soft seam.
      const layer = document.createElement("canvas");
      layer.width = canvas.width;
      layer.height = canvas.height;
      const layerCtx = layer.getContext("2d");
      if (layerCtx) {
        layerCtx.save();
        layerCtx.beginPath();
        layerCtx.rect(0, fullImageTop, fullImageW, fullImageH);
        layerCtx.clip();
        layerCtx.drawImage(backImageElement, drawX, drawY, drawW, drawH);
        layerCtx.restore();

        const alphaMask = layerCtx.createLinearGradient(0, fullImageTop, 0, fullOpaqueTop);
        alphaMask.addColorStop(0, "rgba(0,0,0,0)");
        alphaMask.addColorStop(0.55, "rgba(0,0,0,0.55)");
        alphaMask.addColorStop(1, "rgba(0,0,0,1)");

        layerCtx.globalCompositeOperation = "destination-in";
        layerCtx.fillStyle = alphaMask;
        layerCtx.fillRect(0, fullImageTop, canvas.width, canvas.height - fullImageTop);
        layerCtx.globalCompositeOperation = "source-over";

        ctx.drawImage(layer, 0, 0);
      }
    }

    const pad = 0.12 * canvasScale;
    const textW = canvas.width - pad * 2;
    const textH = canvas.height - pad * 2;

    const titlePx = titleSize * 4;
    const lyricsPx = fontSize * 4;

    let fittedTitle = null;
    let titleBlockH = 0;
    if (songTitle.trim()) {
      fittedTitle = fitSingleLineTitle(ctx, songTitle.trim(), textW, titlePx, titleFont);
      const titleLineH = fittedTitle.sizePx * 0.86;
      const titleGap = fittedTitle.sizePx * 0.08;
      titleBlockH = titleLineH + titleGap;
    }

    const decorativeReserved = backImageElement ? canvas.height * 0.25 : 0;
    const lyricsStartY = pad + titleBlockH;
    const lyricsAvailH = Math.max(0, textH - titleBlockH - decorativeReserved);
    const lineH = lyricsPx * 1.3;
    const maxLyricLines = Math.max(1, Math.floor(lyricsAvailH / lineH));

    const segments = getLyricsSegmentsFromHtml(lyricsHtml);
    const lyricsFamily = '"Cormorant Garamond", "EB Garamond", "Cormorant", serif';
    const rawLines = wrapStyledSegments(ctx, segments, textW, maxLyricLines, lyricsPx, lyricsFamily);
    const lines = rebalanceSingleWordLines(rawLines, textW, ctx, lyricsPx, lyricsFamily);

    ctx.fillStyle = "#111111";
    if (songTitle.trim()) {
      const titleFamily = titleFont === "Beau Rivage"
        ? '"Beau Rivage", "Allura", "Alex Brush", cursive'
        : '"Allura", "Alex Brush", "Great Vibes", cursive';
      ctx.font = `400 ${fittedTitle.sizePx}px ${titleFamily}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(fittedTitle.text, canvas.width / 2, pad - fittedTitle.sizePx * 0.02);
    }

    if (lines.length > 0) {
      let cursorY = lyricsStartY;

      for (const line of lines) {
        let cursorX = textAlign === "center" ? (canvas.width - line.width) / 2 : pad;

        for (const segment of line.segments) {
          ctx.font = `${segment.italic ? "italic" : "normal"} 400 ${lyricsPx}px ${lyricsFamily}`;
          ctx.textAlign = "left";
          ctx.textBaseline = "top";
          ctx.fillText(segment.text, cursorX, cursorY);
          cursorX += segment.width;
        }

        cursorY += lineH;
      }
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
      await ensureFontsLoaded(titleSize, fontSize, titleFont);
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

          <label>
            Back side background color (hex)
            <div className="hex-row">
              <input
                type="text"
                value={backColorHex}
                onChange={(e) => setBackColorHex(e.target.value)}
                placeholder="#F5F0FF"
              />
              <input
                type="color"
                value={effectiveBackColor}
                onChange={(e) => setBackColorHex(e.target.value.toUpperCase())}
                aria-label="Pick back side color"
              />
            </div>
          </label>

          <div className="info-card">
            Bookmark size is auto-maximized for 4 across with 0.5 in spacing and edge clearance.
            <br />
            Current width: <strong>{bookmarkW.toFixed(2)} in</strong>
            <br />
            Current height: <strong>{bookmarkH.toFixed(2)} in</strong>
            <br />
            Fixed temple image fills bottom 20% with soft seam fade.
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
            Song title font
            <select value={titleFont} onChange={(e) => setTitleFont(e.target.value)}>
              <option value="Allura">Allura</option>
              <option value="Beau Rivage">Beau Rivage</option>
            </select>
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

          <div className="lyrics-section">
            <div className="lyrics-label">Lyrics (Ctrl+I to toggle italics)</div>
            <div className="lyrics-toolbar">
              <button type="button" className="toolbar-button" onClick={makeItalicSelection}>Italic</button>
            </div>
            <div
              ref={lyricsEditorRef}
              className="lyrics-editor"
              contentEditable
              suppressContentEditableWarning
              data-placeholder="Type or paste lyrics here. Use Ctrl+I to italicize selected text."
              onInput={handleLyricsInput}
              onKeyDown={handleLyricsKeyDown}
            />
          </div>

          <label>
            Lyrics font size ({fontSize.toFixed(2)} pt)
            <input
              type="number"
              min="8"
              max="18"
              step="0.25"
              value={fontSize}
              onChange={(e) => setFontSize(Number(e.target.value))}
            />
          </label>

          <div className="info-card">
            Suggested lyrics size for nicer wrapping and ~85% vertical fill: <strong>{suggestedFontSize.toFixed(2)} pt</strong>
            <br />
            <button type="button" className="toolbar-button" onClick={() => setFontSize(suggestedFontSize)}>
              Apply Suggested Size
            </button>
          </div>

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
