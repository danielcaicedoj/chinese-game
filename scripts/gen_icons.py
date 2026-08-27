from PIL import Image, ImageDraw, ImageFont
import os

BG = (16, 20, 24, 255)       # --bg
ACCENT = (77, 163, 255, 255) # --accent
FONT_PATH = r"C:\Windows\Fonts\msyhbd.ttc"
CHAR = "汉"

OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "icons")
os.makedirs(OUT_DIR, exist_ok=True)

def make_icon(size, filename, padding_ratio=0.18):
    img = Image.new("RGBA", (size, size), BG)
    draw = ImageDraw.Draw(img)

    font_size = int(size * (1 - padding_ratio * 2))
    font = ImageFont.truetype(FONT_PATH, font_size)

    bbox = draw.textbbox((0, 0), CHAR, font=font)
    w = bbox[2] - bbox[0]
    h = bbox[3] - bbox[1]
    x = (size - w) / 2 - bbox[0]
    y = (size - h) / 2 - bbox[1]

    draw.text((x, y), CHAR, font=font, fill=ACCENT)
    img.save(os.path.join(OUT_DIR, filename), "PNG")
    print(f"Saved {filename} ({size}x{size})")

def make_maskable_icon(size, filename, safe_ratio=0.6):
    # Maskable: el contenido visible debe caber en el "safe zone" central
    # (aprox. 80% del lienzo), así que dejamos más margen.
    img = Image.new("RGBA", (size, size), BG)
    draw = ImageDraw.Draw(img)

    font_size = int(size * safe_ratio)
    font = ImageFont.truetype(FONT_PATH, font_size)

    bbox = draw.textbbox((0, 0), CHAR, font=font)
    w = bbox[2] - bbox[0]
    h = bbox[3] - bbox[1]
    x = (size - w) / 2 - bbox[0]
    y = (size - h) / 2 - bbox[1]

    draw.text((x, y), CHAR, font=font, fill=ACCENT)
    img.save(os.path.join(OUT_DIR, filename), "PNG")
    print(f"Saved {filename} ({size}x{size})")

make_icon(192, "icon-192.png")
make_icon(512, "icon-512.png")
make_maskable_icon(192, "icon-maskable-192.png")
make_maskable_icon(512, "icon-maskable-512.png")
