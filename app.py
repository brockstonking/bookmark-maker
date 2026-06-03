import os
import tempfile
from io import BytesIO
from typing import List, Tuple

import streamlit as st
from fpdf import FPDF
from PIL import Image

LETTER_WIDTH_IN = 11.0
LETTER_HEIGHT_IN = 8.5
BOOKMARK_COUNT = 5


def split_lyrics_lines(pdf: FPDF, text: str, max_width: float, max_lines: int) -> List[str]:
    """Wrap lyrics text to fit the bookmark width while preserving blank lines."""
    if not text.strip():
        return []

    lines: List[str] = []
    paragraphs = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")

    for paragraph in paragraphs:
        if paragraph.strip() == "":
            lines.append("")
            if len(lines) >= max_lines:
                return lines[:max_lines]
            continue

        words = paragraph.split()
        current = words[0]

        for word in words[1:]:
            trial = f"{current} {word}"
            if pdf.get_string_width(trial) <= max_width:
                current = trial
            else:
                lines.append(current)
                if len(lines) >= max_lines:
                    return lines[:max_lines]
                current = word

        lines.append(current)
        if len(lines) >= max_lines:
            return lines[:max_lines]

    if len(lines) > max_lines:
        return lines[:max_lines]
    return lines


def compute_bookmark_positions(
    page_w: float,
    page_h: float,
    count: int,
    cols: int,
    rows: int,
    bookmark_w: float,
    bookmark_h: float,
    margin_x: float,
    margin_y: float,
) -> List[Tuple[float, float]]:
    """
    Compute centered bookmark coordinates row-by-row.
    Supports partial rows and keeps each row centered for balanced layouts.
    """
    avail_w = page_w - 2 * margin_x
    avail_h = page_h - 2 * margin_y

    if cols <= 0 or rows <= 0:
        raise ValueError("Rows and columns must be positive integers.")

    if bookmark_w * cols > avail_w:
        raise ValueError("Bookmark width is too large for the selected columns and margins.")
    if bookmark_h * rows > avail_h:
        raise ValueError("Bookmark height is too large for the selected rows and margins.")

    gap_x = 0.0 if cols == 1 else (avail_w - (cols * bookmark_w)) / (cols - 1)
    gap_y = 0.0 if rows == 1 else (avail_h - (rows * bookmark_h)) / (rows - 1)

    if gap_x < 0 or gap_y < 0:
        raise ValueError("Layout spacing became negative. Reduce bookmark size or adjust margins.")

    positions: List[Tuple[float, float]] = []
    remaining = count

    for row in range(rows):
        if remaining <= 0:
            break

        items_this_row = min(cols, remaining)
        row_content_w = (items_this_row * bookmark_w) + ((items_this_row - 1) * gap_x)
        row_start_x = margin_x + (avail_w - row_content_w) / 2
        y = margin_y + row * (bookmark_h + gap_y)

        for col in range(items_this_row):
            x = row_start_x + col * (bookmark_w + gap_x)
            positions.append((x, y))

        remaining -= items_this_row

    if len(positions) != count:
        raise ValueError("Unable to place exactly 5 bookmarks with current row/column settings.")

    return positions


def draw_front(
    pdf: FPDF,
    x: float,
    y: float,
    w: float,
    h: float,
    title: str,
    image_path: str | None,
    draw_cut_lines: bool,
) -> None:
    """Draw one bookmark front with optional title and image."""
    pdf.set_draw_color(0, 0, 0)
    pdf.set_line_width(0.01)
    pdf.rect(x, y, w, h)

    if draw_cut_lines:
        pdf.set_dash_pattern(dash=0.04, gap=0.03)
        pdf.set_line_width(0.005)
        pdf.rect(x - 0.04, y - 0.04, w + 0.08, h + 0.08)
        pdf.set_dash_pattern(dash=0, gap=0)
        pdf.set_line_width(0.01)

    inner_pad = 0.12
    content_x = x + inner_pad
    content_y = y + inner_pad
    content_w = w - (2 * inner_pad)
    content_h = h - (2 * inner_pad)

    title_space = 0.0
    if title.strip():
        title_space = min(0.55, content_h * 0.28)
        pdf.set_font("Helvetica", "B", 12)
        pdf.set_xy(content_x, content_y)
        pdf.multi_cell(content_w, 0.2, title.strip(), align="C")

    image_area_y = content_y + title_space
    image_area_h = content_h - title_space

    if image_path and image_area_h > 0.2:
        with Image.open(image_path) as img:
            img_w, img_h = img.size

        image_ratio = img_w / img_h
        box_ratio = content_w / image_area_h

        if image_ratio > box_ratio:
            draw_w = content_w
            draw_h = draw_w / image_ratio
        else:
            draw_h = image_area_h
            draw_w = draw_h * image_ratio

        draw_x = content_x + (content_w - draw_w) / 2
        draw_y = image_area_y + (image_area_h - draw_h) / 2
        pdf.image(image_path, x=draw_x, y=draw_y, w=draw_w, h=draw_h)
    else:
        pdf.set_font("Helvetica", "", 9)
        pdf.set_text_color(80, 80, 80)
        pdf.set_xy(content_x, image_area_y + image_area_h / 2 - 0.1)
        pdf.multi_cell(content_w, 0.18, "Your front design appears here", align="C")
        pdf.set_text_color(0, 0, 0)


def draw_back(
    pdf: FPDF,
    x: float,
    y: float,
    w: float,
    h: float,
    lyrics: str,
    font_size_pt: int,
    align: str,
    draw_cut_lines: bool,
) -> None:
    """Draw one bookmark back with wrapped lyrics."""
    pdf.set_draw_color(0, 0, 0)
    pdf.set_line_width(0.01)
    pdf.rect(x, y, w, h)

    if draw_cut_lines:
        pdf.set_dash_pattern(dash=0.04, gap=0.03)
        pdf.set_line_width(0.005)
        pdf.rect(x - 0.04, y - 0.04, w + 0.08, h + 0.08)
        pdf.set_dash_pattern(dash=0, gap=0)
        pdf.set_line_width(0.01)

    inner_pad = 0.14
    text_x = x + inner_pad
    text_y = y + inner_pad
    text_w = w - (2 * inner_pad)
    text_h = h - (2 * inner_pad)

    line_h = (font_size_pt / 72.0) * 1.3
    max_lines = max(1, int(text_h // line_h))

    pdf.set_font("Helvetica", "", font_size_pt)
    wrapped_lines = split_lyrics_lines(pdf, lyrics, text_w, max_lines)

    if not wrapped_lines:
        pdf.set_font("Helvetica", "I", 10)
        pdf.set_text_color(80, 80, 80)
        pdf.set_xy(text_x, text_y + text_h / 2 - 0.1)
        pdf.multi_cell(text_w, 0.18, "Paste lyrics in the sidebar to print on the backs.", align="C")
        pdf.set_text_color(0, 0, 0)
        return

    text_block_h = len(wrapped_lines) * line_h
    start_y = text_y + max(0, (text_h - text_block_h) / 2)

    for line in wrapped_lines:
        pdf.set_xy(text_x, start_y)
        pdf.multi_cell(text_w, line_h, line, align=align)
        start_y += line_h


def build_pdf(
    title: str,
    lyrics: str,
    image_path: str | None,
    font_size: int,
    text_align: str,
    bookmark_w: float,
    bookmark_h: float,
    margin_x: float,
    margin_y: float,
    cols: int,
    rows: int,
    cut_lines: bool,
) -> bytes:
    positions = compute_bookmark_positions(
        page_w=LETTER_WIDTH_IN,
        page_h=LETTER_HEIGHT_IN,
        count=BOOKMARK_COUNT,
        cols=cols,
        rows=rows,
        bookmark_w=bookmark_w,
        bookmark_h=bookmark_h,
        margin_x=margin_x,
        margin_y=margin_y,
    )

    pdf = FPDF(orientation="L", unit="in", format="Letter")
    pdf.set_auto_page_break(auto=False)
    pdf.set_title("Bookmark Maker - Double-Sided Song Lyrics")

    pdf.add_page()
    for x, y in positions:
        draw_front(
            pdf=pdf,
            x=x,
            y=y,
            w=bookmark_w,
            h=bookmark_h,
            title=title,
            image_path=image_path,
            draw_cut_lines=cut_lines,
        )

    pdf.set_font("Helvetica", "", 9)
    pdf.set_xy(0.25, LETTER_HEIGHT_IN - 0.35)
    pdf.cell(
        LETTER_WIDTH_IN - 0.5,
        0.2,
        "Print double-sided, flip on short edge. Use cardstock for best results.",
        align="C",
    )

    pdf.add_page()
    for x, y in positions:
        draw_back(
            pdf=pdf,
            x=x,
            y=y,
            w=bookmark_w,
            h=bookmark_h,
            lyrics=lyrics,
            font_size_pt=font_size,
            align=text_align,
            draw_cut_lines=cut_lines,
        )

    pdf.set_font("Helvetica", "", 9)
    pdf.set_xy(0.25, LETTER_HEIGHT_IN - 0.35)
    pdf.cell(
        LETTER_WIDTH_IN - 0.5,
        0.2,
        "Print double-sided, flip on short edge. Use cardstock for best results.",
        align="C",
    )

    out = pdf.output(dest="S")
    if isinstance(out, (bytes, bytearray)):
        return bytes(out)
    return out.encode("latin-1")


def save_uploaded_image(uploaded_file) -> str:
    suffix = os.path.splitext(uploaded_file.name)[1].lower() or ".png"
    data = uploaded_file.read()
    with Image.open(BytesIO(data)) as img:
        rgb = img.convert("RGB")
        temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
        rgb.save(temp_file.name)
    return temp_file.name


def main() -> None:
    st.set_page_config(page_title="Bookmark Maker - Double-Sided Song Lyrics", page_icon="🔖", layout="wide")

    st.title("🔖 Bookmark Maker - Double-Sided Song Lyrics")
    st.caption(
        "Create a 2-page PDF with perfectly aligned fronts and backs for double-sided Letter landscape printing."
    )

    with st.sidebar:
        st.header("⚙️ Layout Settings")
        bookmark_w = st.number_input("Bookmark width (inches)", min_value=1.0, max_value=4.0, value=2.0, step=0.1)
        bookmark_h = st.number_input("Bookmark height (inches)", min_value=3.0, max_value=7.5, value=5.5, step=0.1)
        margin_x = st.number_input("Left/Right margin (inches)", min_value=0.2, max_value=1.5, value=0.5, step=0.05)
        margin_y = st.number_input("Top/Bottom margin (inches)", min_value=0.2, max_value=1.5, value=0.4, step=0.05)

        st.markdown("---")
        st.subheader("Grid Preset for 5 bookmarks")
        cols = st.selectbox("Columns", options=[2, 3, 4], index=1)
        rows = st.selectbox("Rows", options=[2, 3], index=0)
        cut_lines = st.toggle("Show dashed cut lines", value=True)

        st.info(
            "Default 3 columns x 2 rows places 3 bookmarks on top and 2 centered below. "
            "Page 1 and Page 2 use identical coordinates for perfect alignment."
        )

    col_left, col_right = st.columns(2)

    with col_left:
        st.subheader("🎨 Front Design")
        front_title = st.text_input("Front title (optional)", placeholder="Favorite Song / Artist")
        front_image = st.file_uploader("Upload front image (PNG/JPG)", type=["png", "jpg", "jpeg"])

    with col_right:
        st.subheader("🎵 Back Design")
        lyrics = st.text_area(
            "Paste song lyrics",
            height=320,
            placeholder="Paste full lyrics here...",
            help="Line breaks are preserved and text is wrapped to fit each bookmark.",
        )
        font_size = st.slider("Lyrics font size (pt)", min_value=8, max_value=18, value=11)
        align_ui = st.radio("Lyrics alignment", options=["Center", "Left"], horizontal=True)

    st.markdown(
        "### 🖨️ Printing Tips\n"
        "- Use Letter paper in landscape mode (11 x 8.5 in).\n"
        "- Print double-sided and set printer to **flip on short edge**.\n"
        "- Cardstock gives the best final bookmarks."
    )

    if st.button("Generate Double-Sided PDF", type="primary", use_container_width=True):
        image_path = None
        try:
            if front_image is not None:
                image_path = save_uploaded_image(front_image)

            pdf_bytes = build_pdf(
                title=front_title,
                lyrics=lyrics,
                image_path=image_path,
                font_size=font_size,
                text_align="C" if align_ui == "Center" else "L",
                bookmark_w=bookmark_w,
                bookmark_h=bookmark_h,
                margin_x=margin_x,
                margin_y=margin_y,
                cols=cols,
                rows=rows,
                cut_lines=cut_lines,
            )

            st.success("PDF generated successfully. Download and print double-sided (flip on short edge).")
            st.download_button(
                label="⬇️ Download Bookmark PDF",
                data=pdf_bytes,
                file_name="bookmark_maker_double_sided.pdf",
                mime="application/pdf",
                use_container_width=True,
            )
        except Exception as exc:
            st.error(f"Could not generate PDF: {exc}")
        finally:
            if image_path and os.path.exists(image_path):
                os.remove(image_path)


if __name__ == "__main__":
    main()
