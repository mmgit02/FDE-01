'use strict';
/** Build a minimal single-page PDF whose text layer contains the given rows (cells are x-positioned). */
function makePdf(rows) {
  let y = 780;
  let content = 'BT\n/F1 11 Tf\n';
  const ops = [];
  for (const row of rows) {
    const cells = Array.isArray(row) ? row : [row];
    let x = 40;
    for (const cell of cells) {
      ops.push(`1 0 0 1 ${x} ${y} Tm (${String(cell).replace(/([()\\])/g, '\\$1')}) Tj`);
      x += 100;
    }
    y -= 18;
  }
  content += ops.join('\n') + '\nET';
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((o, i) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach(o => { pdf += `${String(o).padStart(10, '0')} 00000 n \n`; });
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

module.exports = { makePdf };
