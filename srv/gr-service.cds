using gr.automation as db from '../db/schema';

service GRService @(path: '/api/gr') {

  entity POItems    as projection on db.ExtractedPOItems;
  entity GRDocs     as projection on db.GRDocuments;

  /**
   * Upload a PDF delivery note; returns sessionId + extracted PO header
   */
  action uploadPDF(
    fileName    : String,
    fileContent : String   // base64-encoded PDF bytes
  ) returns {
    sessionId   : String;
    poNumber    : String;
    itemCount   : Integer;
    rawText     : String;
  };

  /**
   * Match extracted items against S/4HANA via destination DED_HTTP_200
   */
  action matchWithS4(
    sessionId   : String
  ) returns array of {
    id          : UUID;
    poItem      : String;
    material    : String;
    description : String;
    extractedQty: Decimal;
    openQty     : Decimal;
    uom         : String;
    matchStatus : String;
    grQty       : Decimal;
  };

  /**
   * Post goods receipt for selected items
   */
  action createGoodsReceipt(
    sessionId   : String,
    postingDate : String,
    items       : array of {
      id        : UUID;
      grQty     : Decimal;
    }
  ) returns {
    matDocument : String;
    fiscalYear  : String;
    message     : String;
  };
}
