#!/usr/bin/env python3
"""Render the BrainHalf Open Graph banner (1200x630) to public/og-image.png.

Pure Pillow — no design tooling required. Run once, commit the PNG:
    python3 scripts/generate-og-image.py
"""

from PIL import Image, ImageDraw, ImageFont

W, H = 1200, 630
BG = (30, 24, 21)          # warm charcoal (matches dark theme --background)
CARD = (44, 36, 31)        # card surface
CARD_EDGE = (66, 54, 46)
ORANGE = (249, 115, 22)    # --primary
TEXT = (240, 234, 226)
MUTED = (168, 156, 146)
GREEN = (52, 211, 153)
LINE = (84, 70, 60)

FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
FONT_REG = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"


def rr(draw, box, radius, fill=None, outline=None, width=1):
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def main():
    # Soft radial glow behind the illustration (right side)
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    for r in range(520, 0, -2):
        t = r / 520
        c = tuple(int(BG[i] + (ORANGE[i] - BG[i]) * 0.16 * (1 - t)) for i in range(3))
        d.ellipse((900 - r, 300 - r, 900 + r, 300 + r), fill=c)

    # ---- Left: logo + wordmark + tagline ----
    rr(d, (90, 180, 160, 250), 18, fill=ORANGE)
    # Simple document glyph inside the logo square
    rr(d, (111, 197, 139, 233), 5, fill=(255, 255, 255))
    for y in (205, 213, 221):
        d.line((117, y, 133, y), fill=ORANGE, width=3)

    f_word = ImageFont.truetype(FONT_BOLD, 72)
    brain_w = d.textlength("brain", font=f_word)
    d.text((190, 178), "brain", font=f_word, fill=TEXT)
    d.text((190 + brain_w, 178), "half", font=f_word, fill=ORANGE)

    f_tag = ImageFont.truetype(FONT_REG, 24)
    d.text((90, 285), "AI-powered OCR for invoices & receipts", font=f_tag, fill=MUTED)

    # Feature chips, two rows so they stay inside the left column
    f_sub = ImageFont.truetype(FONT_BOLD, 22)
    chips_row1 = ["No templates", "Confidence scores"]
    x = 90
    for chip in chips_row1:
        w = d.textlength(chip, font=f_sub)
        rr(d, (x, 350, x + w + 36, 394), 22, fill=None, outline=CARD_EDGE, width=2)
        d.text((x + 18, 361), chip, font=f_sub, fill=TEXT)
        x += w + 36 + 16
    chip = "CSV · Excel · JSON export"
    w = d.textlength(chip, font=f_sub)
    rr(d, (90, 410, 90 + w + 36, 454), 22, fill=None, outline=CARD_EDGE, width=2)
    d.text((108, 421), chip, font=f_sub, fill=TEXT)

    d.text((90, 540), "brainhalf.com", font=ImageFont.truetype(FONT_BOLD, 26), fill=MUTED)

    # ---- Right: document -> extracted table illustration ----
    # Document card
    rr(d, (640, 120, 880, 480), 20, fill=CARD, outline=CARD_EDGE, width=2)
    d.text((668, 148), "INVOICE #INV-8902", font=ImageFont.truetype(FONT_BOLD, 20), fill=ORANGE)
    for i, y in enumerate((190, 218, 246, 274)):
        w = 170 if i != 1 else 120
        rr(d, (668, y, 668 + w, y + 12), 6, fill=LINE)
    # Highlighted extracted row
    rr(d, (668, 316, 872, 356), 8, fill=(70, 45, 26), outline=ORANGE, width=2)
    d.text((680, 325), "Total", font=ImageFont.truetype(FONT_REG, 18), fill=TEXT)
    d.text((745, 325), "$1,450.00", font=ImageFont.truetype(FONT_BOLD, 18), fill=ORANGE)
    # Arrow
    d.line((890, 300, 950, 300), fill=ORANGE, width=4)
    d.polygon(((950, 290), (968, 300), (950, 310)), fill=ORANGE)

    # Extracted data card
    rr(d, (980, 150, 1150, 450), 20, fill=CARD, outline=CARD_EDGE, width=2)
    rows = [("Vendor", "Acme Cloud"), ("Date", "Oct 24, 2026"), ("Subtotal", "$1,250.00"), ("Tax", "$200.00"), ("Total", "$1,450.00")]
    f_key = ImageFont.truetype(FONT_REG, 15)
    f_val = ImageFont.truetype(FONT_BOLD, 15)
    for i, (k, v) in enumerate(rows):
        y = 178 + i * 52
        if i:
            d.line((1000, y - 14, 1130, y - 14), fill=CARD_EDGE, width=1)
        d.text((1000, y), k, font=f_key, fill=MUTED)
        d.text((1000, y + 20), v, font=f_val, fill=TEXT)
        # green check
        d.ellipse((1116, y + 20, 1134, y + 38), fill=GREEN)
        d.line((1121, y + 29, 1125, y + 33), fill=BG, width=2)
        d.line((1125, y + 33, 1130, y + 25), fill=BG, width=2)

    img.save("public/og-image.png", optimize=True)
    print("Wrote public/og-image.png (1200x630)")


if __name__ == "__main__":
    main()
