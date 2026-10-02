# -*- coding: utf-8 -*-
"""
مولّد أصول الهوية — معرض الأعمال (Nova)
────────────────────────────────────────────────────────────────
ينتج:
  assets/icon-192.png            أيقونة PWA 192
  assets/icon-512.png            أيقونة PWA 512
  assets/icon-maskable-512.png   أيقونة maskable (منطقة آمنة 80%)
  assets/apple-touch-icon.png    أيقونة iOS 180
  assets/og-image.png            صورة المشاركة 1200×630

التشغيل:
  python tools/make-assets.py
"""
import os
from PIL import Image, ImageDraw, ImageFont, features
import arabic_reshaper
from bidi.algorithm import get_display

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, 'assets')

AMBER = (245, 158, 11)
AMBER_DARK = (217, 119, 6)
TEAL = (71, 222, 179)
INK = (13, 14, 18)
WHITE = (255, 255, 255)
MUTED = (150, 152, 165)

ARIAL_BOLD = r'C:\Windows\Fonts\arialbd.ttf'
ARIAL = r'C:\Windows\Fonts\arial.ttf'


def font(path, size):
    return ImageFont.truetype(path, size)


def ar(text):
    """تشكيل النص العربي + ترتيب RTL الصحيح"""
    return get_display(arabic_reshaper.reshape(text))


def center_text(draw, xy, text, fnt, fill):
    """رسم نص في المنتصف تماماً (أفقياً ورأسياً) عبر bbox الحقيقي"""
    box = draw.textbbox((0, 0), text, font=fnt)
    w, h = box[2] - box[0], box[3] - box[1]
    draw.text((xy[0] - w / 2 - box[0], xy[1] - h / 2 - box[1]), text, font=fnt, fill=fill)


def make_icon(size, path, maskable=False):
    """أيقونة مربّعة — maskable تعني خلفية كاملة + محتوى داخل 80% آمنة"""
    img = Image.new('RGB', (size, size), AMBER)
    d = ImageDraw.Draw(img)

    if not maskable:
        # حواف دائرية للعرض العادي (RGBA)
        img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        d.rounded_rectangle([0, 0, size - 1, size - 1], radius=int(size * 0.22), fill=AMBER)

    # الحرف «ن» — نسبة 58% للعادي، 46% لـ maskable (داخل المنطقة الآمنة)
    ratio = 0.46 if maskable else 0.58
    fnt = font(ARIAL_BOLD, int(size * ratio))
    center_text(d, (size / 2, size * 0.53), ar('ن'), fnt, WHITE)

    # نقطة teal مميّزة (أعلى اليسار البصري في RTL = أعلى يمين الصورة)
    cx = int(size * (0.74 if not maskable else 0.68))
    cy = int(size * (0.26 if not maskable else 0.32))
    r_outer = int(size * 0.055)
    r_inner = int(size * 0.030)
    d.ellipse([cx - r_outer, cy - r_outer, cx + r_outer, cy + r_outer], fill=INK)
    d.ellipse([cx - r_inner, cy - r_inner, cx + r_inner, cy + r_inner], fill=TEAL)

    img.save(path, 'PNG', optimize=True)
    return path


def make_og(width=1200, height=630):
    """صورة المشاركة الاجتماعية"""
    img = Image.new('RGB', (width, height), INK)
    d = ImageDraw.Draw(img)

    # شبكة خفيفة في الخلفية
    for x in range(0, width, 60):
        d.line([(x, 0), (x, height)], fill=(20, 21, 27), width=1)
    for y in range(0, height, 60):
        d.line([(0, y), (width, y)], fill=(20, 21, 27), width=1)

    # توهّج علوي (تدرّج لوني بسيط)
    for i in range(240):
        a = int(16 * (1 - i / 240))
        d.rectangle([0, i, width, i + 1], fill=(INK[0] + a, INK[1] + int(a * 0.75), INK[2]))

    # شريط برتقالي جانبي (يمين — لأن الاتجاه RTL)
    d.rectangle([width - 16, 0, width, height], fill=AMBER)

    # علامة مائية كبيرة على اليسار — تملأ الفراغ بتوازن
    f_wm = font(ARIAL_BOLD, 430)
    wm = ar('ن')
    box = d.textbbox((0, 0), wm, font=f_wm)
    wm_w, wm_h = box[2] - box[0], box[3] - box[1]
    d.text((300 - wm_w / 2 - box[0], 315 - wm_h / 2 - box[1]), wm, font=f_wm, fill=(34, 26, 12))

    # حلقة رقيقة حول العلامة المائية
    d.ellipse([300 - 195, 315 - 195, 300 + 195, 315 + 195], outline=(46, 36, 16), width=2)

    # اسم العلامة اللاتيني أسفل اليسار
    f_mark = font(ARIAL_BOLD, 30)
    d.text((150, 520), 'N O V A', font=f_mark, fill=(92, 68, 20))
    d.text((150, 560), 'DIGITAL SHOWCASE', font=font(ARIAL, 19), fill=(64, 54, 40))

    # الشعار داخل مربّع برتقالي
    box = 148
    bx, by = width - 120 - box, 96
    d.rounded_rectangle([bx, by, bx + box, by + box], radius=34, fill=AMBER)
    f_logo = font(ARIAL_BOLD, int(box * 0.56))
    center_text(d, (bx + box / 2, by + box * 0.54), ar('ن'), f_logo, WHITE)
    d.ellipse([bx + box - 40, by + 12, bx + box - 12, by + 40], fill=INK)
    d.ellipse([bx + box - 34, by + 18, bx + box - 18, by + 34], fill=TEAL)

    # العنوان الرئيسي
    f_title = font(ARIAL_BOLD, 78)
    d.text((width - 120, 300), ar('معرض الأعمال'), font=f_title, fill=WHITE, anchor='ra')

    # السطر الوصفي
    f_sub = font(ARIAL, 38)
    d.text((width - 120, 410), ar('منتجات رقمية للمطوّرين — أدوات · APIs · قوالب'), font=f_sub, fill=MUTED, anchor='ra')

    # شارات
    f_badge = font(ARIAL_BOLD, 27)
    badges = ['دفع بالعملات الرقمية', 'ترخيص رقمي فوري', 'يعمل بلا سيرفر']
    x = width - 120
    for b in badges:
        t = ar(b)
        bb = d.textbbox((0, 0), t, font=f_badge)
        w = bb[2] - bb[0] + 44
        d.rounded_rectangle([x - w, 486, x, 486 + 52], radius=26, fill=(28, 30, 38), outline=(52, 55, 66), width=2)
        d.text((x - w / 2, 486 + 26), t, font=f_badge, fill=AMBER, anchor='mm')
        x -= w + 14

    out = os.path.join(ASSETS, 'og-image.png')
    img.save(out, 'PNG', optimize=True)
    return out


if __name__ == '__main__':
    os.makedirs(ASSETS, exist_ok=True)
    print('raqm:', features.check('raqm'), '| freetype:', features.check('freetype2'))
    made = []
    made.append(make_icon(192, os.path.join(ASSETS, 'icon-192.png')))
    made.append(make_icon(512, os.path.join(ASSETS, 'icon-512.png')))
    made.append(make_icon(512, os.path.join(ASSETS, 'icon-maskable-512.png'), maskable=True))
    made.append(make_icon(180, os.path.join(ASSETS, 'apple-touch-icon.png')))
    made.append(make_og())
    for m in made:
        print('  ✅', os.path.relpath(m, ROOT), os.path.getsize(m), 'بايت')
