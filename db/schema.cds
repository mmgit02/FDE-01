namespace gr.automation;

entity ExtractedPOItems {
  key ID          : UUID;
      sessionId   : String(36);
      poNumber    : String(10);
      poItem      : String(5);
      material    : String(40);
      description : String(100);
      extractedQty: Decimal(13, 3);
      uom         : String(3);
      plant       : String(4);
      storageLoc  : String(4);
      openQty     : Decimal(13, 3);
      grQty       : Decimal(13, 3);
      tolerance   : Decimal(5, 2) default 10;
      matchStatus : String(20);  // MATCHED, TOLERANCE, NOT_FOUND, PENDING
      selected    : Boolean      default false;
}

entity GRDocuments {
  key ID          : UUID;
      sessionId   : String(36);
      matDocument : String(10);
      fiscalYear  : String(4);
      postingDate : Date;
      poNumber    : String(10);
      createdAt   : Timestamp @cds.on.insert: $now;
}
