#!/usr/bin/env python3
"""Minimal, dependency-free HTML -> .docx (WordprocessingML) converter.

Handles exactly what the SRS source uses: h1-h4, p, ul/ol/li, table/tr/th/td,
b/strong, i/em, span+td classes for colour, and div.note callouts.
Emits real Heading1..4 styles so Google Docs builds a document outline.
"""
import html.parser, re, zipfile, sys, os

W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
CONTENT_W = 9746          # A4 minus 0.75in margins, in twips
ESC = {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}

def esc(t):
    return ''.join(ESC.get(c, c) for c in t)

CLASS_FMT = {
    'id':      {'color': '0E4F54', 'mono': True},
    'pass':    {'color': '047857', 'b': True},
    'warncol': {'color': '9A4A09', 'b': True},
    'fail':    {'color': 'B91C1C', 'b': True},
    'ar':      {'rtl': True},
    'k':       {'color': '666666'},
    'sub':     {'i': True, 'color': '444444', 'serif': True},
    'num':     {},
}

class Doc(html.parser.HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.body = []          # list of block dicts
        self.stack = []         # inline format stack
        self.mode = None        # current block type
        self.runs = []          # accumulating inline runs
        self.in_body = False
        self.list_kind = []     # 'ul' | 'ol'
        self.table = None
        self.row = None
        self.cell = None
        self.note = None
        self.skip = 0

    # ---- inline format helpers -------------------------------------
    def fmt(self):
        f = {}
        for d in self.stack:
            f.update(d)
        return f

    def push(self, d):
        self.stack.append(d or {})

    def pop(self):
        if self.stack:
            self.stack.pop()

    def handle_data(self, data):
        if self.skip or not self.in_body:
            return
        if self.mode is None and not data.strip():
            return
        text = re.sub(r'\s+', ' ', data)
        if not text:
            return
        if self.mode is None:
            return
        self.runs.append((text, self.fmt()))

    # ---- block plumbing --------------------------------------------
    def open_block(self, btype, **kw):
        self.flush()
        self.mode = btype
        self.blockmeta = kw
        self.runs = []

    def flush(self):
        if self.mode and self.runs:
            blk = {'type': self.mode, 'runs': self.runs}
            blk.update(getattr(self, 'blockmeta', {}))
            target = self.body
            if self.cell is not None:
                target = self.cell
            elif self.note is not None:
                target = self.note['blocks']
            target.append(blk)
        self.mode = None
        self.runs = []
        self.blockmeta = {}

    # ---- tags ------------------------------------------------------
    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        cls = a.get('class', '').split()
        if tag in ('head', 'style', 'script'):
            self.skip += 1
            return
        if tag == 'body':
            self.in_body = True
            return
        if not self.in_body:
            return

        if tag in ('h1', 'h2', 'h3', 'h4'):
            self.open_block(tag)
        elif tag == 'p':
            self.open_block('p', cls=cls)
        elif tag in ('ul', 'ol'):
            self.flush()
            self.list_kind.append(tag)
        elif tag == 'li':
            self.open_block('li', kind=self.list_kind[-1] if self.list_kind else 'ul',
                            depth=max(0, len(self.list_kind) - 1))
        elif tag == 'table':
            self.flush()
            self.table = {'rows': [], 'cls': cls}
        elif tag == 'tr':
            self.row = []
        elif tag in ('td', 'th'):
            self.cell = []
            self.cellmeta = {'header': tag == 'th', 'cls': cls}
            self.open_block('p', cls=cls)
        elif tag == 'div':
            self.flush()
            self.note = {'blocks': [], 'cls': cls}
        elif tag in ('b', 'strong'):
            self.push({'b': True})
        elif tag in ('i', 'em'):
            self.push({'i': True})
        elif tag == 'span':
            f = {}
            for c in cls:
                f.update(CLASS_FMT.get(c, {}))
            self.push(f)
        elif tag == 'br':
            self.runs.append(('\n', self.fmt()))

    def handle_endtag(self, tag):
        if tag in ('head', 'style', 'script'):
            self.skip = max(0, self.skip - 1)
            return
        if not self.in_body:
            return
        if tag in ('h1', 'h2', 'h3', 'h4', 'p', 'li'):
            self.flush()
        elif tag in ('ul', 'ol'):
            self.flush()
            if self.list_kind:
                self.list_kind.pop()
        elif tag in ('td', 'th'):
            self.flush()
            blocks = self.cell if self.cell else [{'type': 'p', 'runs': []}]
            self.row.append({'blocks': blocks, **self.cellmeta})
            self.cell = None
        elif tag == 'tr':
            if self.row:
                self.table['rows'].append(self.row)
            self.row = None
        elif tag == 'table':
            self.body.append({'type': 'table', **self.table})
            self.table = None
        elif tag == 'div':
            self.flush()
            if self.note:
                self.body.append({'type': 'note', **self.note})
            self.note = None
        elif tag in ('b', 'strong', 'i', 'em', 'span'):
            self.pop()

# ------------------------------------------------------------------ render

SERIF = 'Cambria'
SANS = 'Calibri'
MONO = 'Consolas'
ARFONT = 'Arial'

def run_xml(text, f, base_sz=22):
    if not text:
        return ''
    rpr = []
    if f.get('b'):    rpr.append('<w:b/>')
    if f.get('i'):    rpr.append('<w:i/>')
    if f.get('color'): rpr.append('<w:color w:val="%s"/>' % f['color'])
    if f.get('mono'):
        rpr.append('<w:rFonts w:ascii="%s" w:hAnsi="%s"/>' % (MONO, MONO))
        rpr.append('<w:sz w:val="18"/>')
    if f.get('rtl'):
        rpr.append('<w:rFonts w:ascii="%s" w:hAnsi="%s" w:cs="%s"/>' % (ARFONT, ARFONT, ARFONT))
        rpr.append('<w:rtl/>')
    if f.get('serif'):
        rpr.append('<w:rFonts w:ascii="%s" w:hAnsi="%s"/>' % (SERIF, SERIF))
    if f.get('sz'):   rpr.append('<w:sz w:val="%d"/>' % f['sz'])
    pr = '<w:rPr>%s</w:rPr>' % ''.join(rpr) if rpr else ''
    return '<w:r>%s<w:t xml:space="preserve">%s</w:t></w:r>' % (pr, esc(text))

def runs_xml(runs):
    return ''.join(run_xml(t, f) for t, f in runs)

def para(runs, style=None, extra_ppr='', rtl=False):
    ppr = []
    if style:
        ppr.append('<w:pStyle w:val="%s"/>' % style)
    if extra_ppr:
        ppr.append(extra_ppr)
    if rtl:
        ppr.append('<w:bidi/>')
    p = '<w:pPr>%s</w:pPr>' % ''.join(ppr) if ppr else ''
    return '<w:p>%s%s</w:p>' % (p, runs_xml(runs))

def block_xml(b, in_table=False):
    t = b['type']
    if t == 'h1':
        return para(b['runs'], 'Title')
    if t in ('h2', 'h3', 'h4'):
        return para(b['runs'], 'Heading%d' % (int(t[1]) - 1))
    if t == 'li':
        numid = 2 if b.get('kind') == 'ol' else 1
        ppr = ('<w:numPr><w:ilvl w:val="%d"/><w:numId w:val="%d"/></w:numPr>'
               % (b.get('depth', 0), numid))
        return para(b['runs'], 'ListParagraph', ppr)
    cls = b.get('cls') or []
    if 'sub' in cls:
        return para(b['runs'], 'Subtitle')
    style = 'CellText' if in_table else None
    return para(b['runs'], style)

def table_xml(tbl):
    rows = tbl['rows']
    if not rows:
        return ''
    ncol = max(len(r) for r in rows)
    first = rows[0]
    # narrow first column when it is an ID column
    idcol = any('id' in (c.get('cls') or []) for r in rows for c in r[:1])
    metacol = 'meta' in (tbl.get('cls') or [])
    if idcol and ncol > 1:
        widths = [1150] + [(CONTENT_W - 1150) // (ncol - 1)] * (ncol - 1)
    elif metacol and ncol == 2:
        widths = [2200, CONTENT_W - 2200]
    else:
        widths = [CONTENT_W // ncol] * ncol
    widths[-1] += CONTENT_W - sum(widths)

    borders = ('<w:tblBorders>' + ''.join(
        '<w:%s w:val="single" w:sz="4" w:space="0" w:color="C2CBC6"/>' % s
        for s in ('top', 'left', 'bottom', 'right', 'insideH', 'insideV')) + '</w:tblBorders>')
    if metacol:
        borders = ('<w:tblBorders>' + ''.join(
            '<w:%s w:val="none" w:sz="0" w:space="0" w:color="auto"/>' % s
            for s in ('top', 'left', 'bottom', 'right', 'insideH', 'insideV')) + '</w:tblBorders>')

    out = ['<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/>', borders,
           '<w:tblCellMar><w:top w:w="60" w:type="dxa"/><w:left w:w="108" w:type="dxa"/>'
           '<w:bottom w:w="60" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar>',
           '</w:tblPr><w:tblGrid>']
    out += ['<w:gridCol w:w="%d"/>' % w for w in widths]
    out.append('</w:tblGrid>')

    for ri, r in enumerate(rows):
        header = any(c['header'] for c in r)
        trpr = '<w:trPr><w:tblHeader/><w:cantSplit/></w:trPr>' if header else '<w:trPr><w:cantSplit/></w:trPr>'
        out.append('<w:tr>' + trpr)
        for ci, c in enumerate(r):
            w = widths[ci] if ci < len(widths) else widths[-1]
            shd = '<w:shd w:val="clear" w:color="auto" w:fill="E1EDEC"/>' if header else ''
            out.append('<w:tc><w:tcPr><w:tcW w:w="%d" w:type="dxa"/>%s'
                       '<w:vAlign w:val="top"/></w:tcPr>' % (w, shd))
            blocks = c['blocks'] or [{'type': 'p', 'runs': []}]
            for b in blocks:
                if header:
                    b = dict(b, runs=[(t, {**f, 'b': True, 'color': '0E4F54'}) for t, f in b['runs']])
                out.append(block_xml(b, in_table=True))
            out.append('</w:tc>')
        out.append('</w:tr>')
    out.append('</w:tbl>')
    out.append('<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="120" w:lineRule="exact"/></w:pPr></w:p>')
    return ''.join(out)

def note_xml(n):
    warn = 'warn' in (n.get('cls') or [])
    bar = 'B45309' if warn else '0E4F54'
    fill = 'FBF6EC' if warn else 'F1F6F6'
    ppr = ('<w:pBdr><w:left w:val="single" w:sz="18" w:space="6" w:color="%s"/></w:pBdr>'
           '<w:shd w:val="clear" w:color="auto" w:fill="%s"/>'
           '<w:ind w:left="170" w:right="113"/>' % (bar, fill))
    out = []
    for i, b in enumerate(n['blocks']):
        runs = b['runs']
        if i == 0:
            runs = [(t, {**f, 'b': True, 'color': bar}) for t, f in runs]
        out.append(para(runs, 'NoteText', ppr))
    return ''.join(out)

def build(blocks):
    parts = []
    for b in blocks:
        if b['type'] == 'table':
            parts.append(table_xml(b))
        elif b['type'] == 'note':
            parts.append(note_xml(b))
        else:
            parts.append(block_xml(b))
    sect = ('<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>'
            '<w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080" '
            'w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>')
    return ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<w:document %s><w:body>%s%s</w:body></w:document>' % (W, ''.join(parts), sect))

STYLES = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles %s>
<w:docDefaults><w:rPrDefault><w:rPr>
<w:rFonts w:ascii="%s" w:hAnsi="%s" w:cs="%s"/><w:sz w:val="22"/><w:szCs w:val="22"/>
<w:color w:val="1A1A1A"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:after="140" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault>
</w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:qFormat/>
<w:pPr><w:spacing w:before="0" w:after="80"/><w:outlineLvl w:val="0"/></w:pPr>
<w:rPr><w:rFonts w:ascii="%s" w:hAnsi="%s"/><w:b/><w:color w:val="0E4F54"/><w:sz w:val="52"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:qFormat/>
<w:pPr><w:spacing w:before="0" w:after="60"/></w:pPr>
<w:rPr><w:rFonts w:ascii="%s" w:hAnsi="%s"/><w:i/><w:color w:val="444444"/><w:sz w:val="26"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>
<w:pPr><w:keepNext/><w:spacing w:before="400" w:after="140"/><w:outlineLvl w:val="0"/>
<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="4" w:color="C2CBC6"/></w:pBdr></w:pPr>
<w:rPr><w:rFonts w:ascii="%s" w:hAnsi="%s"/><w:b/><w:color w:val="0E4F54"/><w:sz w:val="34"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>
<w:pPr><w:keepNext/><w:spacing w:before="280" w:after="100"/><w:outlineLvl w:val="1"/></w:pPr>
<w:rPr><w:b/><w:color w:val="0E4F54"/><w:sz w:val="25"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>
<w:pPr><w:keepNext/><w:spacing w:before="220" w:after="80"/><w:outlineLvl w:val="2"/></w:pPr>
<w:rPr><w:b/><w:color w:val="333333"/><w:sz w:val="22"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:qFormat/>
<w:pPr><w:spacing w:after="60"/><w:ind w:left="454" w:hanging="227"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="CellText"><w:name w:val="Cell Text"/><w:basedOn w:val="Normal"/>
<w:pPr><w:spacing w:before="20" w:after="20" w:line="252" w:lineRule="auto"/></w:pPr>
<w:rPr><w:sz w:val="19"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="NoteText"><w:name w:val="Note Text"/><w:basedOn w:val="Normal"/>
<w:pPr><w:spacing w:before="60" w:after="60"/></w:pPr><w:rPr><w:sz w:val="20"/></w:rPr></w:style>
</w:styles>''' % (W, SANS, SANS, ARFONT, SERIF, SERIF, SERIF, SERIF, SERIF, SERIF)

def numbering():
    def lvls(fmt, txt, char_font=None):
        out = []
        for i in range(9):
            f = '<w:rPr><w:rFonts w:ascii="%s" w:hAnsi="%s" w:hint="default"/></w:rPr>' % (char_font, char_font) if char_font else ''
            t = txt if fmt == 'bullet' else '%%%d.' % (i + 1)
            out.append('<w:lvl w:ilvl="%d"><w:start w:val="1"/><w:numFmt w:val="%s"/>'
                       '<w:lvlText w:val="%s"/><w:lvlJc w:val="left"/>'
                       '<w:pPr><w:ind w:left="%d" w:hanging="284"/></w:pPr>%s</w:lvl>'
                       % (i, fmt, t, 454 + i * 454, f))
        return ''.join(out)
    return ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering %s>'
            '<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>%s</w:abstractNum>'
            '<w:abstractNum w:abstractNumId="2"><w:multiLevelType w:val="hybridMultilevel"/>%s</w:abstractNum>'
            '<w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>'
            '<w:num w:numId="2"><w:abstractNumId w:val="2"/></w:num>'
            '</w:numbering>' % (W, lvls('bullet', '•', 'Symbol'), lvls('decimal', '')))

CT = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>'''

RELS = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>'''

DOCRELS = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
</Relationships>'''

CORE = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
 xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/"
 xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>LabGate - Software Requirements Specification</dc:title>
<dc:subject>Sales Order Approval Chain and Laboratory Quality Control System</dc:subject>
<dc:creator>Golden Wheat Mills Company</dc:creator>
<cp:revision>1</cp:revision>
</cp:coreProperties>'''

APP = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">
<Application>LabGate SRS builder</Application></Properties>'''

src, out = sys.argv[1], sys.argv[2]
d = Doc()
d.feed(open(src, encoding='utf-8').read())
d.flush()
doc = build(d.body)

with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr('[Content_Types].xml', CT)
    z.writestr('_rels/.rels', RELS)
    z.writestr('word/document.xml', doc)
    z.writestr('word/_rels/document.xml.rels', DOCRELS)
    z.writestr('word/styles.xml', STYLES)
    z.writestr('word/numbering.xml', numbering())
    z.writestr('docProps/core.xml', CORE)
    z.writestr('docProps/app.xml', APP)

tables = doc.count('<w:tbl>')
print('blocks=%d  tables=%d  paragraphs=%d  bytes=%d'
      % (len(d.body), tables, doc.count('<w:p>'), os.path.getsize(out)))
