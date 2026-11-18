'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { matchLine } = require('../srv/lib/matching');

const po = [
  { PurchaseOrderItem: '00010', Material: '100000012', PurchaseOrderItemText: 'Steel Pipe', OrderQuantity: '500.000', PurchaseOrderQuantityUnit: 'PC' },
  { PurchaseOrderItem: '00020', Material: '100000056', PurchaseOrderItemText: 'Copper', OrderQuantity: '1000.000', PurchaseOrderQuantityUnit: 'KG' },
  { PurchaseOrderItem: '00030', Material: '000000000000000077', PurchaseOrderItemText: 'Closed', OrderQuantity: '10', PurchaseOrderQuantityUnit: 'PC', IsCompletelyDelivered: true },
];
const line = (o) => ({ poNumber: '4500001234', poItem: '', material: '', description: '', quantity: 1, uom: 'PC', ...o });

test('exact quantity -> MATCHED', () => {
  const r = matchLine(line({ poItem: '00010', material: '100000012', quantity: 500 }), po, 10);
  assert.equal(r.status, 'MATCHED'); assert.equal(r.selectable, true);
});

test('within tolerance (either direction) -> WITHIN_TOLERANCE', () => {
  assert.equal(matchLine(line({ poItem: '00010', quantity: 540 }), po, 10).status, 'WITHIN_TOLERANCE');
  assert.equal(matchLine(line({ poItem: '00010', quantity: 460 }), po, 10).status, 'WITHIN_TOLERANCE');
});

test('well below PO quantity -> PARTIAL, selectable', () => {
  const r = matchLine(line({ poItem: '00010', quantity: 100 }), po, 10);
  assert.equal(r.status, 'PARTIAL'); assert.equal(r.selectable, true);
});

test('above tolerance -> OVER_TOLERANCE, not selectable', () => {
  const r = matchLine(line({ poItem: '00010', quantity: 600 }), po, 10);
  assert.equal(r.status, 'OVER_TOLERANCE'); assert.equal(r.selectable, false);
});

test('tolerance 0 makes 1% over a rejection', () => {
  assert.equal(matchLine(line({ poItem: '00010', quantity: 505 }), po, 0).status, 'OVER_TOLERANCE');
});

test('match by material when no PO item, ignoring leading zeros', () => {
  const r = matchLine(line({ material: '0000100000056', quantity: 1000, uom: 'KG' }), po, 10);
  assert.equal(r.poItem, '00020'); assert.equal(r.status, 'MATCHED');
});

test('unit and material mismatches are blocked', () => {
  assert.equal(matchLine(line({ poItem: '00010', quantity: 500, uom: 'KG' }), po, 10).status, 'UOM_MISMATCH');
  assert.equal(matchLine(line({ poItem: '00010', material: '999', quantity: 500 }), po, 10).status, 'MATERIAL_MISMATCH');
});

test('unit aliases are equivalent (PCS == PC handled upstream, EA vs PC is not)', () => {
  assert.equal(matchLine(line({ poItem: '00010', quantity: 500, uom: 'PCS' }), po, 10).status, 'MATCHED');
  assert.equal(matchLine(line({ poItem: '00010', quantity: 500, uom: 'EA' }), po, 10).status, 'UOM_MISMATCH');
});

test('unknown item and closed item', () => {
  assert.equal(matchLine(line({ poItem: '00099', quantity: 1 }), po, 10).status, 'NOT_FOUND');
  const r = matchLine(line({ poItem: '00030', quantity: 10 }), po, 10);
  assert.equal(r.status, 'ITEM_CLOSED'); assert.equal(r.selectable, false);
});
