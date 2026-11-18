'use strict';
const cds = require('@sap/cds');
const { extractFromPdf } = require('./lib/pdf-extract');
const { matchLine } = require('./lib/matching');
const s4 = require('./lib/s4');

const TOLERANCE_PCT = Number.isFinite(Number(process.env.QTY_TOLERANCE_PCT))
  ? Number(process.env.QTY_TOLERANCE_PCT) : 10;
const MAX_LINES = 200;

function clean(lines, req) {
  if (!Array.isArray(lines) || !lines.length) req.reject(400, 'No lines supplied.');
  if (lines.length > MAX_LINES) req.reject(400, `Too many lines (max ${MAX_LINES}).`);
  return lines.map((l, i) => {
    const n = i + 1;
    const poNumber = String(l.poNumber || '').trim();
    const quantity = Number(l.quantity);
    if (!/^\d{10}$/.test(poNumber)) req.reject(400, `Line ${n}: PO number must be 10 digits.`);
    if (!(quantity > 0)) req.reject(400, `Line ${n}: quantity must be greater than 0.`);
    if (!String(l.uom || '').trim()) req.reject(400, `Line ${n}: unit of measure is missing.`);
    if (!String(l.poItem || '').trim() && !String(l.material || '').trim()) {
      req.reject(400, `Line ${n}: give a PO item or a material.`);
    }
    return {
      poNumber,
      poItem: String(l.poItem || '').trim(),
      material: String(l.material || '').trim(),
      description: String(l.description || '').slice(0, 100),
      quantity,
      uom: String(l.uom).trim().toUpperCase(),
    };
  });
}

/** Read each PO once from S/4 and match every line against it. */
async function matchAll(lines) {
  const poItems = new Map();
  for (const po of new Set(lines.map(l => l.poNumber))) {
    poItems.set(po, await s4.fetchPurchaseOrderItems(po));
  }
  return lines.map(l => ({ match: matchLine(l, poItems.get(l.poNumber), TOLERANCE_PCT), s4Items: poItems.get(l.poNumber) }));
}

module.exports = class GRService extends cds.ApplicationService {
  init() {
    this.on('config', req => ({
      tolerancePct: TOLERANCE_PCT,
      destination: s4.DESTINATION.destinationName,
      user: req.user?.id || '',
    }));

    this.on('extractFromPDF', async req => {
      const { fileName, fileContent } = req.data;
      if (!fileContent) req.reject(400, 'No file content supplied.');      let result;
      try {
        result = await extractFromPdf(Buffer.from(fileContent, 'base64'));
      } catch (err) {
        if (err.code === 400) req.reject(400, err.message);
        cds.log('gr').error('PDF extraction failed:', err.message, err.stack);
        req.reject(422, 'The PDF could not be read.');
      }
      return { fileName: fileName || '', poNumber: result.poNumber, lines: result.lines, warnings: result.warnings };
    });

    this.on('matchPurchaseOrders', async req => {
      const lines = clean(req.data.lines, req);
      try {
        const matched = await matchAll(lines);
        return { tolerancePct: TOLERANCE_PCT, lines: matched.map(m => m.match) };
      } catch (err) {
        req.reject(err.code === 400 || err.code === 502 ? err.code : 500, err.message);
      }
    });

    this.on('postGoodsReceipt', async req => {
      const lines = clean(req.data.lines, req);
      const dryRun = req.data.dryRun === true;
      const postingDate = req.data.postingDate || new Date().toISOString().slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(postingDate)) req.reject(400, 'Invalid posting date.');

      try {
        // Never trust the browser: match again against S/4 right before posting.
        const matched = await matchAll(lines);
        const blocked = matched.filter(m => !m.match.selectable);
        if (blocked.length) {
          req.reject(409, `Cannot post: ${blocked.map(b =>
            `PO ${b.match.poNumber}/${b.match.poItem || b.match.material} - ${b.match.message}`).join('; ')}`);
        }

        const items = matched.map(({ match, s4Items }) => {
          const s4Item = s4Items.find(i => String(i.PurchaseOrderItem).padStart(5, '0') === match.poItem);
          return {
            poNumber: match.poNumber, poItem: match.poItem,
            s4Material: s4Item.Material, material: s4Item.Material,
            quantity: match.quantity, uom: match.s4Uom, s4Uom: match.s4Uom,
            plant: s4Item.Plant || '', storageLocation: s4Item.StorageLocation || '',
          };
        });

        const payload = s4.buildGoodsReceiptPayload(items, postingDate);
        const view = items.map(i => ({
          poNumber: i.poNumber, poItem: i.poItem, material: i.material,
          quantity: i.quantity, uom: i.uom, plant: i.plant, storageLocation: i.storageLocation,
        }));

        if (dryRun) {
          return { dryRun: true, materialDocument: '', fiscalYear: '', items: view,
            message: `Validation passed for ${view.length} item(s). Nothing was posted.` };
        }

        const posted = await s4.postMaterialDocument(payload);
        cds.log('gr').info(`GR ${posted.materialDocument}/${posted.fiscalYear} posted by ${req.user?.id} (${view.length} items)`);
        return { dryRun: false, ...posted, items: view,
          message: `Goods receipt ${posted.materialDocument}/${posted.fiscalYear} created.` };
      } catch (err) {
        if (err.code && err.code >= 400 && err.code < 600 && typeof err.code === 'number') req.reject(err.code, err.message);
        throw err;
      }
    });

    return super.init();
  }
};
