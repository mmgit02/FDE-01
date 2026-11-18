'use strict';
const { normalizeUom } = require('./pdf-extract');

const EPS = 0.0005;

const stripZeros = s => String(s || '').trim().replace(/^0+(?=.)/, '').toUpperCase();
const pad5 = s => String(s || '').trim().padStart(5, '0');

/** Candidate S/4 items for a delivery line: by PO item if given, else by material. */
function findCandidates(line, s4Items) {
  if (line.poItem) {
    return s4Items.filter(i => pad5(i.PurchaseOrderItem) === pad5(line.poItem));
  }
  const mat = stripZeros(line.material);
  return s4Items.filter(i => stripZeros(i.Material) === mat);
}

/**
 * Compare one delivery line with the S/4 purchase order items.
 * Quantity tolerance is applied against the PO item quantity:
 *   |delivery - PO| <= tolerance%      -> MATCHED (exact) / WITHIN_TOLERANCE
 *   delivery below PO quantity         -> PARTIAL (legitimate partial delivery, selectable)
 *   delivery above PO qty + tolerance  -> OVER_TOLERANCE (not selectable)
 */
function matchLine(line, s4Items, tolerancePct) {
  const base = {
    poNumber: line.poNumber, poItem: line.poItem || '', material: line.material,
    description: line.description || '', quantity: line.quantity, uom: line.uom,
    selectable: false, message: '', s4Material: '', s4Text: '', s4Quantity: null, s4Uom: '', deviationPct: null,
  };

  const cands = findCandidates(line, s4Items);
  if (!cands.length) {
    return { ...base, status: 'NOT_FOUND', message: `No matching item on PO ${line.poNumber}.` };
  }
  // With several candidates (same material on several items) prefer the closest quantity.
  const item = cands.slice().sort((a, b) =>
    Math.abs(Number(a.OrderQuantity) - line.quantity) - Math.abs(Number(b.OrderQuantity) - line.quantity))[0];

  const poQty = Number(item.OrderQuantity);
  const out = {
    ...base,
    poItem: pad5(item.PurchaseOrderItem),
    s4Material: item.Material || '',
    s4Text: item.PurchaseOrderItemText || '',
    s4Quantity: poQty,
    s4Uom: item.PurchaseOrderQuantityUnit || '',
  };

  if (item.PurchasingDocumentDeletionCode) {
    return { ...out, status: 'ITEM_CLOSED', message: 'PO item is deleted or blocked.' };
  }
  if (item.IsCompletelyDelivered === true) {
    return { ...out, status: 'ITEM_CLOSED', message: 'PO item is flagged as completely delivered.' };
  }
  if (line.poItem && line.material && stripZeros(item.Material) !== stripZeros(line.material)) {
    return { ...out, status: 'MATERIAL_MISMATCH',
      message: `PO item ${out.poItem} is material ${item.Material}, delivery note says ${line.material}.` };
  }
  if (normalizeUom(item.PurchaseOrderQuantityUnit) !== normalizeUom(line.uom)) {
    return { ...out, status: 'UOM_MISMATCH',
      message: `Unit differs: PO uses ${item.PurchaseOrderQuantityUnit}, delivery note ${line.uom}.` };
  }

  const diff = line.quantity - poQty;
  const pct = poQty > 0 ? (diff / poQty) * 100 : (line.quantity > 0 ? Infinity : 0);
  out.deviationPct = Number.isFinite(pct) ? Math.round(pct * 100) / 100 : null;

  if (Math.abs(diff) <= EPS) return { ...out, status: 'MATCHED', selectable: true, message: 'Quantity equals PO quantity.' };
  if (Math.abs(pct) <= tolerancePct) {
    return { ...out, status: 'WITHIN_TOLERANCE', selectable: true,
      message: `Deviation ${out.deviationPct}% is within the ${tolerancePct}% tolerance.` };
  }
  if (diff < 0) {
    return { ...out, status: 'PARTIAL', selectable: true,
      message: `Partial delivery: ${line.quantity} of ${poQty} ${out.s4Uom}.` };
  }
  return { ...out, status: 'OVER_TOLERANCE',
    message: `Delivery exceeds PO quantity by ${out.deviationPct}% (tolerance ${tolerancePct}%).` };
}

module.exports = { matchLine, findCandidates, pad5 };
