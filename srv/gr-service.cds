// Stateless service: no entities, no local database.
@path     : '/api/gr'
@protocol : 'rest'
@requires : 'authenticated-user'
service GRService {

  /** One delivery-note line, as extracted from the PDF (and editable by the user). */
  type DeliveryLine {
    poNumber    : String(10);
    poItem      : String(5);
    material    : String(40);
    description : String(100);
    quantity    : Double;
    uom         : String(3);
  }

  /** A delivery-note line after matching against the S/4HANA purchase order. */
  type MatchLine {
    poNumber     : String(10);
    poItem       : String(5);
    material     : String(40);
    description  : String(100);
    quantity     : Double;
    uom          : String(3);
    status       : String(20); // MATCHED | WITHIN_TOLERANCE | PARTIAL | OVER_TOLERANCE | UOM_MISMATCH | MATERIAL_MISMATCH | ITEM_CLOSED | NOT_FOUND
    selectable   : Boolean;
    message      : String(300);
    s4Material   : String(40);
    s4Text       : String(100);
    s4Quantity   : Double;
    s4Uom        : String(3);
    deviationPct : Double;
  }

  type PostedItem {
    poNumber : String(10);
    poItem   : String(5);
    material : String(40);
    quantity : Double;
    uom      : String(3);
    plant    : String(4);
    storageLocation : String(4);
  }

  type ExtractResult {
    fileName : String;
    poNumber : String(10);
    lines    : many DeliveryLine;
    warnings : many String;
  }

  type MatchResult {
    tolerancePct : Double;
    lines        : many MatchLine;
  }

  type PostResult {
    dryRun           : Boolean;
    materialDocument : String(10);
    fiscalYear       : String(4);
    items            : many PostedItem;
    message          : String(300);
  }

  type ConfigInfo {
    tolerancePct : Double;
    destination  : String;
    user         : String;
  }

  function config() returns ConfigInfo;

  /** Parse a delivery note PDF (base64) and extract PO number, item, material, quantity, UoM. */
  action extractFromPDF(fileName : String, fileContent : String) returns ExtractResult;

  /** Match the lines against the purchase orders in S/4HANA and apply the quantity tolerance. */
  action matchPurchaseOrders(lines : many DeliveryLine) returns MatchResult;

  /** Create the goods receipt (movement type 101) for the selected lines. dryRun=true only validates. */
  action postGoodsReceipt(lines : many DeliveryLine, postingDate : Date, dryRun : Boolean) returns PostResult;
}
