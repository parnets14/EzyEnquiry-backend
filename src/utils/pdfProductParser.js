/**
 * pdfProductParser.js
 *
 * Extracts structured product rows from tiles/sanitary-ware catalogue PDFs.
 * Returns an array of plain objects that match the bulk-upload spreadsheet
 * column schema (same field names the bulk-upload controller understands:
 * name, code, size, finish, category, brand, mrp, etc.).
 *
 * PDF types handled:
 *   - JK CREANZA / clearing-stock sheets  → Tiles category
 *   - VARSO MRP                           → sanitaryware / auto-detect category
 *   - CERA Catalogue (price-list pages)   → Sanitaryware category
 *   - Image-only PDFs (BDM POSTER, etc.)  → returns [] with a warning flag
 */

const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.mjs')

/* ── helpers ──────────────────────────────────────────────── */

async function extractAllText(buffer, maxPages) {
  const data = new Uint8Array(buffer)
  const doc  = await pdfjsLib.getDocument({ data, verbosity: 0 }).promise
  const limit = maxPages ? Math.min(doc.numPages, maxPages) : doc.numPages
  const pages = []
  for (let i = 1; i <= limit; i++) {
    const page    = await doc.getPage(i)
    const content = await page.getTextContent()
    pages.push(content.items.map(it => it.str).join(' ').replace(/\s+/g, ' ').trim())
  }
  return { numPages: doc.numPages, pages }
}

function slug(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '')
}

/* ── Detector: decide which parser to use ─────────────────── */

function detectType(fileName, firstPageText) {
  const f  = slug(fileName)
  const t  = slug(firstPageText.slice(0, 400))

  if (f.includes('creanza') || f.includes('jk') || t.includes('clearingstock'))
    return 'JK_CREANZA'
  if (f.includes('varso'))
    return 'VARSO'
  if (f.includes('cera') || t.includes('ceraindia') || t.includes('ceraanitaryware'))
    return 'CERA'
  if (f.includes('bdm') || f.includes('kalingastone') || f.includes('signature')
      || f.includes('octagonal') || f.includes('tessa'))
    return 'IMAGE_ONLY'

  // Generic fallback: if text is very sparse → image-only
  const totalTextLen = firstPageText.replace(/\s/g, '').length
  if (totalTextLen < 30) return 'IMAGE_ONLY'

  return 'GENERIC'
}

/* ── Parser 1: JK Creanza / clearing-stock format ─────────── */
//
// Each page text looks like:
//   ROYAL SALENTO BEIGE  GVT TILES  SIZE   FINISH   BOX 2X4   MATT   AVAILABILITY 33-box
//   ROYAL STATUARIO BORGHINI  GVT TILES  SIZE   FINISH   BOX 2X4   MATT   AVAILABILITY 29-box  …
//
// Pattern: NAME  TILE_TYPE  SIZE  FINISH  BOX_FORMAT  FINISH_WORD  AVAILABILITY  N-box

function parseJKCreanza(pages) {
  const rows = []
  const seen = new Set()

  // Match: NAME ... AVAILABILITY <N>-box (the product block)
  // We'll split by "AVAILABILITY" and look backwards for the name
  for (const pageText of pages) {
    // Remove the CLEARING STOCK header line
    const clean = pageText.replace(/CLEARING STOCK[^\n]*/gi, ' ')
    // Split on AVAILABILITY token
    const chunks = clean.split(/AVAILABILITY\s*/i)
    for (let ci = 0; ci < chunks.length - 1; ci++) {
      const before = chunks[ci].trim()
      const after  = chunks[ci + 1].trim()

      // After: "<N>-box …"
      const availMatch = after.match(/^(\d+)-box/i)
      const availability = availMatch ? parseInt(availMatch[1]) : null

      // Before: scan backwards for the product name — take last meaningful stretch
      // The format ends in "…  BOX 2X4  MATT" so name is the first capitalised phrase
      // Strip trailing metadata tokens (GVT TILES, SIZE, FINISH, BOX …, MATT, GLOSSY…)
      const stripped = before
        .replace(/\b(GVT TILES?|FULL BODY TILES?|COLOR BODY|EVOQ ART|INKJET|SIZE|FINISH|BOX \d+X\d+|MATT|GLOSSY|SATIN|NATURAL|RUSTIC|POLISHED|UNPOLISHED)\b/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim()

      // Take the last 80 chars, find the longest ALL-CAPS word sequence
      const tail = stripped.slice(-120)
      const nameMatch = tail.match(/([A-Z][A-Z0-9 '-]{3,})/)
      const name = nameMatch ? nameMatch[1].replace(/\s+/g, ' ').trim() : ''

      if (!name || name.length < 4) continue
      const key = slug(name)
      if (seen.has(key)) continue
      seen.add(key)

      rows.push({
        name,
        size:         '1200x600',      // all items in this sheet are 2X4
        finish:       'Matt',
        category:     'Tiles',
        brand:        'JK',
        application:  'Wall & Floor',
        description:  availability ? `Clearing stock — ${availability} box(es) available` : 'Clearing stock',
        _review:      false,
      })
    }
  }

  return rows
}

/* ── Parser 2: VARSO MRP format ────────────────────────────── */
//
// Page text:  PHOTO  VC NAME  SIZE  MRP
//   PORSCHE 1006 MATT   510 X 360 X 815 MM   22500
//   KIA 1009 GLOSSY     430 X 430 X 840 MM   19990
//
// Each product block: NAME [FINISH]  SIZE  MRP

function parseVarso(pages) {
  const rows = []
  const seen = new Set()

  // Combined text of all pages
  const fullText = pages.join(' ')

  // Pattern: word sequences (product name) + dimension WxHxD MM + price
  const productRe = /([A-Z][A-Z0-9 ]+?(?:MATT|GLOSSY|SATIN|MATTE)?)\s+([\d]+\s*X\s*[\d]+\s*X\s*[\d]+\s*MM)\s+([\d]+)/gi
  let m
  while ((m = productRe.exec(fullText)) !== null) {
    const rawName = m[1].replace(/\s+/g, ' ').trim()
    const rawSize = m[2].replace(/\s+/g, ' ').trim()
    const mrpVal  = m[3].trim()

    if (!rawName || rawName.length < 4) continue

    // Derive finish from name
    let finish = ''
    const fMatch = rawName.match(/\b(MATT|GLOSSY|SATIN|MATTE)\b/i)
    if (fMatch) finish = fMatch[1].toUpperCase() === 'MATTE' ? 'Matt' : fMatch[1]

    const name = rawName.replace(/\b(MATT|GLOSSY|SATIN|MATTE)\b/gi, '').replace(/\s+/g, ' ').trim()
    if (name.length < 3) continue

    const key = slug(name)
    if (seen.has(key)) continue
    seen.add(key)

    // Determine category from size / context — 3D dimensions → sanitaryware/furniture
    const dims = rawSize.split(/\s*X\s*/i).map(d => parseFloat(d))
    const isFlat = dims.length === 2 || (dims.length === 3 && dims[2] < 30)
    const category = isFlat ? 'Tiles' : 'Sanitaryware'

    rows.push({
      name,
      size:     rawSize,
      finish,
      mrp:      mrpVal,
      category,
      brand:    'VARSO',
      _review:  false,
    })
  }

  return rows
}

/* ── Parser 3: CERA Catalogue ───────────────────────────────── */
//
// Product blocks look like:
//   CHARM 6D  650 x 355 x 745 mm  Cat. No. S1013271  `  19,490
//   CARLTON - SILKY BLACK  Rimless wall hung EWC  490 x 350 x 360 mm  Cat. No. S1044147BK  `  18,360

function parseCera(pages) {
  const rows = []
  const seen = new Set()
  const fullText = pages.join(' ')

  // Match: NAME ... Cat. No. XXXXX ... ` PRICE
  const catRe = /([A-Z][A-Z0-9 \-'*]+?)\s+(?:[\d]+\s*x\s*[\d]+\s*x\s*[\d]+\s*mm)\s+Cat\.\s*No\.\s*([A-Z0-9]+)\s+[`₹\\u20B9]\s+([\d,]+)/gi
  let m
  while ((m = catRe.exec(fullText)) !== null) {
    let name = m[1].replace(/\s+/g, ' ').replace(/\*+/g, '').trim()
    const catNo = m[2].trim()
    const mrpRaw = m[3].replace(/,/g, '').trim()

    // Dimension extraction from surrounding text
    const sizeRe = /(\d+)\s*x\s*(\d+)\s*x\s*(\d+)\s*mm/i
    const surrounding = fullText.slice(Math.max(0, m.index - 20), m.index + m[0].length + 10)
    const sizeM = surrounding.match(sizeRe)
    const size = sizeM ? `${sizeM[1]}x${sizeM[2]}x${sizeM[3]} mm` : ''

    if (!name || name.length < 3) continue
    // Skip lines that are clearly headers
    if (/^\d+$/.test(name) || /^(WALL|FLOOR|TWO PIECE|ONE PIECE|PRICES MENTIONED)/i.test(name)) continue

    const key = slug(name + catNo)
    if (seen.has(key)) continue
    seen.add(key)

    rows.push({
      name,
      code:        catNo,
      size,
      mrp:         mrpRaw,
      category:    'Sanitaryware',
      brand:       'CERA',
      description: `Cat. No. ${catNo}`,
      unit:        'Piece',
      _review:     false,
    })
  }

  return rows
}

/* ── Parser 4: Image-only (BDM POSTER, KalingaStone, etc.) ── */

function parseImageOnly(fileName) {
  return {
    rows:    [],
    warning: `"${fileName}" is an image-based PDF — text cannot be automatically extracted. ` +
             `Please add products manually or use the Excel upload for this catalogue.`,
  }
}

/* ── Main export ─────────────────────────────────────────────── */

/**
 * parsePdfToProducts(buffer, fileName)
 *
 * @param {Buffer}  buffer    - raw PDF file buffer
 * @param {string}  fileName  - original file name (used for type detection)
 * @returns {{ rows: object[], warning?: string, pdfType: string, numPages: number }}
 */
async function parsePdfToProducts(buffer, fileName) {
  let extracted
  try {
    extracted = await extractAllText(buffer, null)
  } catch (e) {
    return { rows: [], warning: `Failed to read PDF: ${e.message}`, pdfType: 'ERROR', numPages: 0 }
  }

  const { numPages, pages } = extracted
  const firstPage = pages[0] || ''

  const pdfType = detectType(fileName, firstPage)

  if (pdfType === 'IMAGE_ONLY') {
    const { rows, warning } = parseImageOnly(fileName)
    return { rows, warning, pdfType, numPages }
  }

  let rows = []
  if (pdfType === 'JK_CREANZA') rows = parseJKCreanza(pages)
  else if (pdfType === 'VARSO')  rows = parseVarso(pages)
  else if (pdfType === 'CERA')   rows = parseCera(pages)
  else {
    // GENERIC: try VARSO-style then CERA-style
    rows = parseVarso(pages)
    if (!rows.length) rows = parseCera(pages)
  }

  // Flag rows where name looks uncertain (very short, numbers only, etc.)
  rows = rows.map(r => ({
    ...r,
    _review: r._review || r.name.length < 5 || /^\d+$/.test(r.name),
  }))

  const warning = rows.length === 0
    ? `No products could be extracted from "${fileName}". ` +
      `The PDF may be image-based or use an unsupported layout. ` +
      `Please review manually.`
    : undefined

  return { rows, warning, pdfType, numPages }
}

module.exports = { parsePdfToProducts }
