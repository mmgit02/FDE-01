'use strict';
/**
 * S/4HANA access through the BTP destination (default DED_HTTP_200).
 * Destination lookup, proxying (incl. Cloud Connector) and CSRF handling are
 * done by the SAP Cloud SDK; no credentials ever appear in this code.
 */
const { executeHttpRequest } = require('@sap-cloud-sdk/http-client');

const DESTINATION = { destinationName: process.env.S4_DESTINATION || 'DED_HTTP_200' };
const PO_SERVICE  = '/sap/opu/odata/sap/API_PURCHASEORDER_PROCESS_SRV';
const MAT_DOC_SRV = '/sap/opu/odata/sap/API_MATERIAL_DOCUMENT_SRV';

/** Turn an SDK/axios error into a short message that is safe to show to the user. */
function describeError(err) {
  const data = err?.cause?.response?.data || err?.response?.data;
  const status = err?.cause?.response?.status || err?.response?.status;
  const s4msg = data?.error?.message?.value
    || (Array.isArray(data?.error?.innererror?.errordetails) && data.error.innererror.errordetails[0]?.message);
  const base = s4msg || err?.rootCause?.message || err?.message || 'Unknown error';
  return `${status ? `HTTP ${status}: ` : ''}${String(base).slice(0, 280)}`;
}

function s4Error(prefix, err) {
  const e = new Error(`${prefix}: ${describeError(err)}`);
  e.code = 502;
  e.cause = err;
  return e;
}

/** All items of one purchase order. */
async function fetchPurchaseOrderItems(poNumber) {
  if (!/^\d{10}$/.test(poNumber)) {
    const e = new Error(`Invalid PO number "${poNumber}" (10 digits expected).`);
    e.code = 400;
    throw e;
  }
  try {
    const resp = await executeHttpRequest(DESTINATION, {
      method: 'GET',
      // poNumber is validated as 10 digits above, so it cannot break out of the filter.
      url: `${PO_SERVICE}/A_PurchaseOrderItem?$filter=${encodeURIComponent(`PurchaseOrder eq '${poNumber}'`)}&$top=500&$format=json`,
      headers: { Accept: 'application/json' },
    });
    return resp.data?.d?.results || [];
  } catch (err) {
    throw s4Error(`Reading PO ${poNumber} from S/4HANA failed`, err);
  }
}

/** Build the API_MATERIAL_DOCUMENT_SRV payload for movement type 101 against POs. */
function buildGoodsReceiptPayload(items, postingDate) {
  const d = `${postingDate}T00:00:00`;
  return {
    PostingDate: d,
    DocumentDate: d,
    GoodsMovementCode: '01',
    to_MaterialDocumentItem: items.map(i => ({
      Material: i.s4Material,
      Plant: i.plant,
      StorageLocation: i.storageLocation,
      GoodsMovementType: '101',
      GoodsMovementRefDocType: 'B',
      PurchaseOrder: i.poNumber,
      PurchaseOrderItem: i.poItem,
      QuantityInEntryUnit: String(i.quantity),
      EntryUnit: i.s4Uom,
    })),
  };
}

async function postMaterialDocument(payload) {
  try {
    const resp = await executeHttpRequest(DESTINATION, {
      method: 'POST',
      url: `${MAT_DOC_SRV}/A_MaterialDocumentHeader`,
      data: payload,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    });
    const d = resp.data?.d || {};
    if (!d.MaterialDocument) throw new Error('S/4HANA answered without a material document number.');
    return { materialDocument: d.MaterialDocument, fiscalYear: d.MaterialDocumentYear };
  } catch (err) {
    throw s4Error('Posting the goods receipt failed', err);
  }
}

module.exports = { fetchPurchaseOrderItems, buildGoodsReceiptPayload, postMaterialDocument, DESTINATION };
