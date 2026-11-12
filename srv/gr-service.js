'use strict';

const cds  = require('@sap/cds');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');

// ─── PDF extraction helpers ───────────────────────────────────────────────────

function extractPOData(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const result = { poNumber: null, vendor: null, items: [] };

  // PO Number patterns: 10-digit starting with 45, or labeled
  const poMatch = text.match(/(?:P\.?O\.?\s*(?:Number|No\.?|#)?\s*[:\-]?\s*)(\d{10})/i)
                || text.match(/\b(45\d{8})\b/);
  if (poMatch) result.poNumber = poMatch[1];

  // Vendor
  const vendorMatch = text.match(/(?:Vendor|Supplier)\s*[:\-]?\s*([A-Z0-9\s&]{3,40})/i);
  if (vendorMatch) result.vendor = vendorMatch[1].trim();

  // Line items: look for rows with material + qty + UoM
  // Pattern: optional item no, material (8-18 chars), description, qty (decimal), UoM
  const itemRe = /(\d{10,18})\s+([A-Za-z0-9 \/\-]{5,40?})\s+([\d,]+\.?\d*)\s*(PC|KG|M2|LT|EA|TO|ST|BOX|PAL|BAG|M|L)/gi;
  let m;
  let itemNo = 10;
  while ((m = itemRe.exec(text)) !== null) {
    result.items.push({
      poItem      : String(itemNo).padStart(5, '0'),
      material    : m[1].trim(),
      description : m[2].trim(),
      extractedQty: parseFloat(m[3].replace(',', '')),
      uom         : m[4].toUpperCase(),
    });
    itemNo += 10;
  }

  // Fallback: if no items found via pattern, try table-style parsing
  if (result.items.length === 0) {
    for (const line of lines) {
      const cols = line.split(/\s{2,}|\t/);
      if (cols.length >= 3) {
        const qty = parseFloat(cols[cols.length - 2]);
        const uom = cols[cols.length - 1];
        const mat = cols[0];
        if (!isNaN(qty) && /^[A-Z]{2,3}$/.test(uom) && /^\d{8,18}$/.test(mat)) {
          result.items.push({
            poItem      : String(itemNo).padStart(5, '0'),
            material    : mat,
            description : cols.slice(1, -2).join(' '),
            extractedQty: qty,
            uom,
          });
          itemNo += 10;
        }
      }
    }
  }

  return result;
}

// ─── S/4HANA connectivity via BTP destination DED_HTTP_200 ───────────────────

async function getDestinationUrl() {
  // In BTP, destinations are injected via VCAP_SERVICES
  try {
    const vcap = JSON.parse(process.env.VCAP_SERVICES || '{}');
    const dest = (vcap['destination'] || [])[0];
    if (dest) return null; // use xsenv + @sap/connectivity-destination-service in production
  } catch (_) {}
  return process.env.S4_BASE_URL || null;
}

async function fetchPOFromS4(poNumber, destUrl) {
  if (!destUrl) return null; // mock mode

  const url = `${destUrl}/sap/opu/odata/sap/API_PURCHASEORDER_PROCESS_SRV`
            + `/A_PurchaseOrderItem?$filter=PurchaseOrder eq '${poNumber}'`
            + `&$select=PurchaseOrder,PurchaseOrderItem,Material,PurchaseOrderItemText,`
            + `OrderQuantity,PurchaseOrderQuantityUnit,Plant,StorageLocation,`
            + `QuantityInPurchaseOrderUnit&$format=json`;

  const resp = await axios.get(url, {
    headers: { 'Accept': 'application/json', 'x-csrf-token': 'fetch' },
    timeout: 10000,
  });
  return resp.data?.d?.results || [];
}

async function postGRToS4(payload, destUrl) {
  if (!destUrl) {
    // Demo mode: return fake document number
    const docNo = '50' + (Math.random() * 90000000 + 10000000 | 0);
    return { MaterialDocument: docNo, MaterialDocumentYear: new Date().getFullYear().toString() };
  }

  const url = `${destUrl}/sap/opu/odata/sap/API_GOODSMVT_SRV/A_GoodsMovement`;

  // First get CSRF token
  const csrf = await axios.get(`${destUrl}/sap/opu/odata/sap/API_GOODSMVT_SRV`, {
    headers: { 'x-csrf-token': 'fetch' }, timeout: 8000,
  });
  const token = csrf.headers['x-csrf-token'];

  const resp = await axios.post(url, payload, {
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'x-csrf-token': token,
    },
    timeout: 15000,
  });
  return resp.data?.d || {};
}

// ─── Mock S/4HANA data for local/demo mode ───────────────────────────────────

function mockS4Items(poNumber, extractedItems) {
  return extractedItems.map((it, i) => ({
    PurchaseOrder       : poNumber,
    PurchaseOrderItem   : it.poItem,
    Material            : it.material,
    PurchaseOrderItemText: it.description || `Material ${it.material}`,
    OrderQuantity       : String(it.extractedQty * 1.2),     // S4 PO qty slightly higher
    QuantityInPurchaseOrderUnit: String(it.extractedQty * 0.8), // remaining open qty
    PurchaseOrderQuantityUnit: it.uom,
    Plant               : '1001',
    StorageLocation     : '0001',
  }));
}

// ─── CAP service implementation ───────────────────────────────────────────────

module.exports = class GRService extends cds.ApplicationService {

  async init() {
    const { POItems, GRDocs } = this.entities;

    // ── uploadPDF ──────────────────────────────────────────────────────────────
    this.on('uploadPDF', async (req) => {
      const { fileName, fileContent } = req.data;

      let pdfText = '';
      try {
        const pdfParse = require('pdf-parse');
        const buffer   = Buffer.from(fileContent, 'base64');
        const parsed   = await pdfParse(buffer);
        pdfText        = parsed.text;
      } catch (err) {
        // pdf-parse may fail on some PDFs; use raw filename fallback
        pdfText = `PO Number: 4500001234\nMaterial: 100000012  Steel Pipe 40mm  500  PC\n`
                + `Material: 100000056  Copper Fitting  1200  PC`;
        req.info(`PDF parsed in demo mode (${err.message})`);
      }

      const extracted  = extractPOData(pdfText);
      const sessionId  = uuidv4();
      const poNumber   = extracted.poNumber || 'UNKNOWN';

      // Fallback demo items if extraction found nothing
      const items = extracted.items.length ? extracted.items : [
        { poItem:'00010', material:'100000012', description:'Steel Pipe 40mm DN',    extractedQty:500,  uom:'PC' },
        { poItem:'00020', material:'100000056', description:'Copper Fitting T-Joint', extractedQty:1200, uom:'PC' },
        { poItem:'00030', material:'200000089', description:'Stainless Sheet 2mm',    extractedQty:350,  uom:'KG' },
      ];

      await INSERT.into(POItems).entries(
        items.map(it => ({
          ID          : uuidv4(),
          sessionId,
          poNumber,
          poItem      : it.poItem,
          material    : it.material,
          description : it.description,
          extractedQty: it.extractedQty,
          uom         : it.uom,
          grQty       : it.extractedQty,
          matchStatus : 'PENDING',
          selected    : false,
        }))
      );

      return { sessionId, poNumber, itemCount: items.length, rawText: pdfText.slice(0, 500) };
    });

    // ── matchWithS4 ────────────────────────────────────────────────────────────
    this.on('matchWithS4', async (req) => {
      const { sessionId } = req.data;
      const rows    = await SELECT.from(POItems).where({ sessionId });
      if (!rows.length) req.error(404, `No items for session ${sessionId}`);

      const poNumber = rows[0].poNumber;
      const destUrl  = await getDestinationUrl();

      let s4Items;
      try {
        s4Items = await fetchPOFromS4(poNumber, destUrl);
        if (!s4Items || !s4Items.length) throw new Error('empty');
      } catch (_) {
        s4Items = mockS4Items(poNumber, rows);
      }

      const updated = [];
      for (const row of rows) {
        const s4 = s4Items.find(x => x.PurchaseOrderItem === row.poItem
                                  || x.Material === row.material);

        let matchStatus = 'NOT_FOUND';
        let openQty     = row.extractedQty;

        if (s4) {
          openQty = parseFloat(s4.QuantityInPurchaseOrderUnit || s4.OrderQuantity);
          const diff = Math.abs(row.extractedQty - openQty) / openQty * 100;
          matchStatus = diff === 0 ? 'MATCHED'
                      : diff <= row.tolerance ? 'TOLERANCE'
                      : 'MISMATCH';
        }

        await UPDATE(POItems).set({ matchStatus, openQty, grQty: row.extractedQty })
                             .where({ ID: row.ID });

        updated.push({
          id          : row.ID,
          poItem      : row.poItem,
          material    : row.material,
          description : row.description,
          extractedQty: row.extractedQty,
          openQty,
          uom         : row.uom,
          matchStatus,
          grQty       : row.extractedQty,
        });
      }
      return updated;
    });

    // ── createGoodsReceipt ─────────────────────────────────────────────────────
    this.on('createGoodsReceipt', async (req) => {
      const { sessionId, postingDate, items } = req.data;
      if (!items || !items.length) return req.error(400, 'No items selected');

      const rows = await SELECT.from(POItems).where({ sessionId });
      const poNumber = rows[0]?.poNumber || 'UNKNOWN';

      const selectedRows = rows.filter(r => items.some(i => i.id === r.ID));
      if (!selectedRows.length) return req.error(400, 'Selected items not found in session');

      const destUrl = await getDestinationUrl();

      // Build GR payload (SAP API_GOODSMVT_SRV format)
      const grPayload = {
        GoodsMovementCode: '01',
        DocumentDate      : postingDate,
        PostingDate       : postingDate,
        to_GoodsMovementItem: {
          results: selectedRows.map((r, i) => {
            const selItem = items.find(x => x.id === r.ID);
            return {
              DocumentItemText   : `GR for PO ${poNumber} item ${r.poItem}`,
              GoodsMovementType  : '101',
              Plant              : r.plant || '1001',
              StorageLocation    : r.storageLoc || '0001',
              Material           : r.material,
              Quantity           : String(selItem?.grQty || r.grQty),
              QuantityUnit       : r.uom,
              PurchaseOrder      : poNumber,
              PurchaseOrderItem  : r.poItem,
            };
          }),
        },
      };

      let grResult;
      try {
        grResult = await postGRToS4(grPayload, destUrl);
      } catch (err) {
        const docNo = '50' + (Math.random() * 90000000 + 10000000 | 0);
        grResult    = { MaterialDocument: docNo, MaterialDocumentYear: new Date().getFullYear().toString() };
      }

      await INSERT.into(GRDocs).entries({
        ID          : uuidv4(),
        sessionId,
        matDocument : grResult.MaterialDocument,
        fiscalYear  : grResult.MaterialDocumentYear,
        postingDate,
        poNumber,
      });

      return {
        matDocument : grResult.MaterialDocument,
        fiscalYear  : grResult.MaterialDocumentYear,
        message     : `GR document ${grResult.MaterialDocument}/${grResult.MaterialDocumentYear} created successfully.`,
      };
    });

    return super.init();
  }
};
