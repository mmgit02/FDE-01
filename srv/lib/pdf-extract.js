'use strict';
/**
 * Delivery-note extraction: PDF bytes -> text -> { poNumber, lines[], warnings[] }.
 * The text parser is heuristic by nature, so the UI lets the user correct every
 * extracted value before anything is matched or posted.
 */

// Units we recognise at the end of a line item. Values are the SAP internal code.
const UOM_ALIASES = {
  PC: 'PC', PCS: 'PC', PIECE: 'PC', PIECES: 'PC', ST: 'ST', STK: 'ST',
  EA: 'EA', EACH: 'EA',
  KG: 'KG', G: 'G', T: 'TO', TO: 'TO', TON: 'TO',
  L: 'L', LT: 'L', LTR: 'L', ML: 'ML',
  M: 'M', M2: 'M2', M3: 'M3', CM: 'CM', MM: 'MM',
  BOX: 'BOX', BX: 'BOX', CAR: 'CAR', CTN: 'CAR', KAR: 'KAR',
  PAL: 'PAL', PLT: 'PAL', PK: 'PK', PAC: 'PAC', BAG: 'BAG', BG: 'BAG', SET: 'SET',
  DR: 'DR', ROL: 'ROL', RL: 'ROL', PR: 'PR', DZ: 'DZ',
};

function normalizeUom(u) {
  const key = String(u || '').trim().toUpperCase();
  return UOM_ALIASES[key] || key;
}

/** "1,200.50" / "1.200,50" / "12,5" / "1,200" -> number (NaN if not a number). */
function parseNumber(s) {
  let t = String(s).trim();
  if (!/^\d[\d.,]*$/.test(t)) return NaN;
  const lastDot = t.lastIndexOf('.');
  const lastComma = t.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    const dec = lastDot > lastComma ? '.' : ',';
    const thou = dec === '.' ? ',' : '.';
    t = t.split(thou).join('').replace(dec, '.');
  } else if (lastComma >= 0) {
    // "1,200" -> thousands; "12,5" / "0,25" -> decimal
    t = /^\d{1,3}(,\d{3})+$/.test(t) ? t.replace(/,/g, '') : t.replace(',', '.');
  } else if (lastDot >= 0) {
    t = /^\d{1,3}(\.\d{3})+$/.test(t) && !/^\d\.\d{3}$/.test(t) ? t.replace(/\./g, '') : t;
  }
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

const PO_LABELED = /(?:purchase\s*order|\bP\.?\s?O\.?\b|order\s*(?:no|number|nr|#)|your\s*order|customer\s*order|bestell\w*)\s*(?:number|no\.?|nr\.?|#)?\s*[:#\-]?\s*(\d{10})\b/gi;

function findPoNumbers(text) {
  const found = [];
  let m;
  PO_LABELED.lastIndex = 0;
  while ((m = PO_LABELED.exec(text)) !== null) found.push(m[1]);
  if (!found.length) {
    for (const x of text.matchAll(/\b(45\d{8})\b/g)) found.push(x[1]);
  }
  return [...new Set(found)];
}

const SKIP_LINE = /^(total|sub\s*total|gross|net|weight|page|delivery\s*note|date|ship|vendor|supplier|customer|address|tel|phone|fax|email|www|item\b|pos\b|position|material\b|description\b|qty|quantity)/i;
const TAIL = /^(.*?)\s*(\d[\d.,]*)\s*([A-Za-z][A-Za-z0-9]{0,3})\s*$/;

function splitColumns(s) {
  const cols = s.split(/\t+|\s{2,}/).map(x => x.trim()).filter(Boolean);
  return cols.length > 1 ? cols : s.trim().split(/\s+/);
}

/** Parse one text line into a delivery line, or null if it is not an item row. */
function parseItemLine(line, defaultPo) {
  const raw = line.trim();
  if (raw.length < 6 || SKIP_LINE.test(raw)) return null;

  const m = TAIL.exec(raw);
  if (!m) return null;
  const uomKey = m[3].toUpperCase();
  if (!UOM_ALIASES[uomKey]) return null;
  const quantity = parseNumber(m[2]);
  if (!(quantity > 0)) return null;

  const head = splitColumns(m[1]);
  if (!head.length) return null;

  let poItem = null;
  let rest = head.slice();
  // Leading PO item number: 1-5 digits (10, 20, 00010 ...) followed by more columns.
  if (rest.length >= 2 && /^\d{1,5}$/.test(rest[0])) {
    poItem = rest.shift().padStart(5, '0');
  }
  const material = rest.shift();
  if (!material || !/^[A-Za-z0-9][A-Za-z0-9\-_/.]{1,39}$/.test(material)) return null;
  if (!/\d/.test(material) && !poItem) return null; // plain words are not material numbers
  const description = rest.join(' ').slice(0, 100);

  return {
    poNumber: defaultPo || '',
    poItem: poItem || '',
    material,
    description,
    quantity,
    uom: normalizeUom(uomKey),
  };
}

function parseDeliveryText(text) {
  const warnings = [];
  const pos = findPoNumbers(text);
  const poNumber = pos[0] || '';
  if (!pos.length) warnings.push('No PO number found - please enter it manually.');
  if (pos.length > 1) {
    warnings.push(`Several PO numbers found (${pos.join(', ')}); using ${pos[0]} for all lines.`);
  }

  const lines = [];
  for (const l of text.split(/\r?\n/)) {
    const item = parseItemLine(l, poNumber);
    if (item) lines.push(item);
  }
  if (!lines.length) warnings.push('No item lines recognised - please add lines manually.');
  if (lines.some(l => !l.poItem)) {
    warnings.push('Some lines have no PO item; they will be matched on material number.');
  }
  return { poNumber, lines, warnings };
}

/**
 * pdf.js page renderer that keeps table columns apart: items on the same row are
 * joined with two spaces when there is a visible gap between them.
 */
async function renderPage(pageData) {
  const content = await pageData.getTextContent({ normalizeWhitespace: true, disableCombineTextItems: false });
  const rows = [];
  for (const it of content.items) {
    const y = Math.round(it.transform[5]);
    let row = rows.find(r => Math.abs(r.y - y) <= 2);
    if (!row) rows.push((row = { y, items: [] }));
    row.items.push({ x: it.transform[4], w: it.width || 0, s: it.str });
  }
  rows.sort((a, b) => b.y - a.y);
  return rows.map(r => {
    r.items.sort((a, b) => a.x - b.x);
    let out = '';
    let prevEnd = null;
    for (const it of r.items) {
      if (prevEnd !== null && it.x - prevEnd > 4) out += '  ';
      out += it.s;
      prevEnd = it.x + it.w;
    }
    return out;
  }).join('\n') + '\n';
}

async function pdfToText(buffer) {
  // Require the library file directly: pdf-parse's index.js runs a debug routine
  // when it has no parent module.
  const pdfParse = require('pdf-parse/lib/pdf-parse.js');
  const parsed = await pdfParse(buffer, { pagerender: renderPage });
  return parsed.text || '';
}

async function extractFromPdf(buffer) {
  if (!buffer || buffer.length < 8 || buffer.slice(0, 5).toString('latin1') !== '%PDF-') {
    const e = new Error('The uploaded file is not a PDF.');
    e.code = 400;
    throw e;
  }
  // The bundled pdf.js (1.10) fails with "bad XRef entry" on Node Buffers in current Node
  // versions but reads a plain Uint8Array correctly, so hand it a copy of that type.
  const text = await pdfToText(new Uint8Array(buffer));
  if (!text.trim()) {
    return { poNumber: '', lines: [], warnings: ['The PDF contains no text layer (scanned image?). OCR is not supported.'], text };
  }
  return { ...parseDeliveryText(text), text };
}

module.exports = { extractFromPdf, parseDeliveryText, parseItemLine, parseNumber, normalizeUom };
