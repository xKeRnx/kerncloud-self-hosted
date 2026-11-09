"""Generate customer PDFs from the maintained Bridge Markdown sources.

Development dependency: reportlab. Supply --font-dir containing Ubuntu-R.ttf,
Ubuntu-B.ttf and Inconsolata-Regular.ttf (or use the DejaVu system fallback).
"""
from pathlib import Path
import argparse
import copy
import html
import io
import json
import re

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.platypus import SimpleDocTemplate, Paragraph, KeepTogether


def inline(text):
    text = text.replace('\u2011', '-').replace('\u2013', '-').replace('\u2014', '-')
    escaped = html.escape(text)
    return re.sub(r'`([^`]+)`', r'<font name="BridgeCode">\1</font>', escaped)


def draw_page(c, doc, language, total):
    c.saveState()
    c.setStrokeColor(colors.HexColor('#d6e1e7'))
    c.setLineWidth(0.6)
    c.line(21*mm, 280*mm, 189*mm, 280*mm)
    c.line(21*mm, 18*mm, 189*mm, 18*mm)
    c.setFont('BridgeBold', 10)
    c.setFillColor(colors.HexColor('#143342'))
    c.drawString(21*mm, 284*mm, 'KeRnCloud Bridge')
    c.setFont('Bridge', 8)
    c.setFillColor(colors.HexColor('#586b78'))
    c.drawRightString(189*mm, 284*mm, 'ANLEITUNG' if language == 'de' else 'USER GUIDE')
    c.drawString(21*mm, 12*mm, VERSION + '  |  ' + 'KeRnCloud Bridge')
    c.drawRightString(189*mm, 12*mm, ('Seite ' if language == 'de' else 'Page ') + str(doc.page) + ' / ' + str(total))
    c.restoreState()


def generate(root, language):
    src = root / ('README.' + language + '.md')
    dest = root / 'releases' / ('bridge-anleitung-de.pdf' if language == 'de' else 'bridge-guide-en.pdf')
    body = ParagraphStyle('Body', fontName='Bridge', fontSize=9.5, leading=14, textColor=colors.HexColor('#243d4b'), spaceAfter=8, alignment=TA_LEFT)
    heading = ParagraphStyle('Heading', parent=body, fontName='BridgeBold', fontSize=14, leading=19, spaceBefore=15, spaceAfter=9, keepWithNext=True, textColor=colors.HexColor('#143342'))
    title = ParagraphStyle('Title', parent=body, fontName='BridgeBold', fontSize=28, leading=33, spaceAfter=12)
    subtitle = ParagraphStyle('Subtitle', parent=body, fontSize=11, leading=16, textColor=colors.HexColor('#526f7b'), spaceAfter=18)
    item = ParagraphStyle('Item', parent=body, leftIndent=14, firstLineIndent=-10, spaceAfter=8)
    note = ParagraphStyle('Note', parent=body, fontSize=9, leading=14, borderColor=colors.HexColor('#b8d9dd'), borderWidth=0.6, borderPadding=10, backColor=colors.HexColor('#eff8f8'), spaceAfter=18)
    story = [Paragraph('Bridge einrichten &amp;<br/>sicher nutzen' if language == 'de' else 'Set up Bridge.<br/>Stay in control.', title),
             Paragraph('Windows - Linux - macOS<br/>' + ('Installation, Freigaben und Wiederherstellung' if language == 'de' else 'Installation, permissions and recovery'), subtitle),
             Paragraph('Verbinde deinen Workspace mit deinen Geräten. Du wählst die freigegebenen Ordner, Programme und Netzwerkziele direkt am Gerät.' if language == 'de' else 'Connect your workspace to your devices. Choose shared folders, programs and network targets directly on your device.', note)]
    blocks = re.split(r'\n\s*\n', src.read_text(encoding='utf-8').strip())
    for block in blocks:
        if block.startswith('# '):
            continue
        if block.startswith('## '):
            story.append(Paragraph(inline(block[3:].strip()), heading))
        elif re.match(r'^(?:- |\d+\. )', block):
            for line in block.splitlines():
                numbered = re.match(r'^(\d+)\.\s+(.*)', line)
                content = (numbered[1] + '. ' + numbered[2]) if numbered else '• ' + line.removeprefix('- ')
                story.append(KeepTogether([Paragraph(inline(content), item)]))
        else:
            story.append(Paragraph(inline(' '.join(block.splitlines())), body))
    dest.parent.mkdir(parents=True, exist_ok=True)
    options = dict(pagesize=A4, rightMargin=21*mm, leftMargin=21*mm, topMargin=24*mm, bottomMargin=25*mm,
                   title='KeRnCloud Bridge - ' + ('Anleitung Deutsch' if language == 'de' else 'English guide'), author='KeRn-WS', subject='Bridge ' + VERSION + ' setup, permissions and recovery', pageCompression=1, invariant=1)
    draft = SimpleDocTemplate(io.BytesIO(), **options)
    draft.build(copy.deepcopy(story))
    total = draft.page
    doc = SimpleDocTemplate(str(dest), **options)
    on_page = lambda c, d: draw_page(c, d, language, total)
    doc.build(story, onFirstPage=on_page, onLaterPages=on_page)
    print(str(dest))


if __name__ == '__main__':
    VERSION = json.loads((Path(__file__).resolve().parents[1] / 'package.json').read_text(encoding='utf-8'))['version']
    parser = argparse.ArgumentParser()
    parser.add_argument('--font-dir', type=Path, default=Path('/usr/share/fonts/truetype/dejavu'))
    args = parser.parse_args()
    fonts = args.font_dir
    regular = fonts / ('Ubuntu-R.ttf' if (fonts / 'Ubuntu-R.ttf').exists() else 'DejaVuSans.ttf')
    bold = fonts / ('Ubuntu-B.ttf' if (fonts / 'Ubuntu-B.ttf').exists() else 'DejaVuSans-Bold.ttf')
    mono = fonts / ('Inconsolata-Regular.ttf' if (fonts / 'Inconsolata-Regular.ttf').exists() else 'DejaVuSansMono.ttf')
    for name, filename in [('Bridge', regular), ('BridgeBold', bold), ('BridgeCode', mono)]:
        pdfmetrics.registerFont(TTFont(name, str(filename)))
    pdfmetrics.registerFontFamily('Bridge', normal='Bridge', bold='BridgeBold')
    for lang in ['de', 'en']:
        generate(Path(__file__).resolve().parents[1], lang)
