'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseDeliveryText, parseItemLine, parseNumber, extractFromPdf } = require('../srv/lib/pdf-extract');
const { makePdf } = require('./helpers');

test('parseNumber handles US, EU and plain formats', () => {
  assert.equal(parseNumber('1,200.50'), 1200.5);
  assert.equal(parseNumber('1.200,50'), 1200.5);
  assert.equal(parseNumber('12,5'), 12.5);
  assert.equal(parseNumber('1,200'), 1200);
  assert.equal(parseNumber('500'), 500);
  assert.ok(Number.isNaN(parseNumber('abc')));
});

test('parseItemLine: columns with item, material, description, qty, uom', () => {
  const l = parseItemLine('10   100000012   Steel Pipe 40mm   500   PC', '4500001234');
  assert.deepEqual(l, { poNumber: '4500001234', poItem: '00010', material: '100000012',
    description: 'Steel Pipe 40mm', quantity: 500, uom: 'PC' });
});

test('parseItemLine: no item number, "qty uom" in one cell, uom alias', () => {
  const l = parseItemLine('TG11   Trading goods   1,250.5 pcs', '4500001234');
  assert.equal(l.poItem, '');
  assert.equal(l.material, 'TG11');
  assert.equal(l.quantity, 1250.5);
  assert.equal(l.uom, 'PC');
});

test('parseItemLine ignores headers, totals and prose', () => {
  assert.equal(parseItemLine('Item  Material  Description  Qty  UoM', ''), null);
  assert.equal(parseItemLine('Total weight 120 KG', ''), null);
  assert.equal(parseItemLine('Delivery date 18.11.2026', ''), null);
  assert.equal(parseItemLine('Thank you for your business', ''), null);
});

test('parseDeliveryText finds labelled PO number and warns on several', () => {
  const r = parseDeliveryText('Delivery Note 80001\nPurchase Order: 4500001234\n10  M-100  Bolt  5  PC\n');
  assert.equal(r.poNumber, '4500001234');
  assert.equal(r.lines.length, 1);
  const multi = parseDeliveryText('PO No. 4500001234\nYour order 4500009999\n10  M-100  Bolt  5  PC\n');
  assert.ok(multi.warnings.some(w => /Several PO numbers/.test(w)));
});

test('extractFromPdf reads a real PDF text layer with table columns', async () => {
  const pdf = makePdf([
    'DELIVERY NOTE',
    'Purchase Order: 4500001234',
    ['Item', 'Material', 'Description', 'Qty', 'UoM'],
    ['10', '100000012', 'Steel Pipe', '500', 'PC'],
    ['20', '100000056', 'Copper Fitting', '1,200.5', 'KG'],
  ]);
  const r = await extractFromPdf(pdf);
  assert.equal(r.poNumber, '4500001234');
  assert.equal(r.lines.length, 2);
  assert.deepEqual(r.lines[0], { poNumber: '4500001234', poItem: '00010', material: '100000012',
    description: 'Steel Pipe', quantity: 500, uom: 'PC' });
  assert.equal(r.lines[1].quantity, 1200.5);
  assert.equal(r.lines[1].uom, 'KG');
});

test('extractFromPdf works with a Buffer decoded from base64 (as in the service)', async () => {
  const b64 = makePdf([['Purchase Order: 4500001234'], ['10', 'M-100', 'Bolt', '5', 'PC']]).toString('base64');
  const r = await extractFromPdf(Buffer.from(b64, 'base64'));
  assert.equal(r.lines.length, 1);
});

test('extractFromPdf rejects non-PDF input', async () => {
  await assert.rejects(() => extractFromPdf(Buffer.from('hello world, not a pdf')), /not a PDF/);
});
