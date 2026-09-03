/**
 * exporter.js
 * Shared helpers to stream report data as Excel (.xlsx) or PDF.
 *
 * Usage:
 *   const { sendExcel, sendPdf } = require('../../utils/exporter');
 *   const columns = [{ key: 'period', header: 'Date', width: 18 }, ...];
 *   if (format === 'excel') return sendExcel(res, { title, columns, rows });
 *   if (format === 'pdf')   return sendPdf(res,   { title, columns, rows });
 */

const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');

function safeFileName(title) {
  return String(title || 'report')
    .replace(/[^a-z0-9]+/gi, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase() || 'report';
}

/**
 * Stream an Excel workbook.
 * @param {object} opts { title, columns:[{key,header,width}], rows:[obj], totals:{key:value} }
 */
async function sendExcel(res, { title = 'Report', columns = [], rows = [], totals = null } = {}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'EzyEnquiry';
  wb.created = new Date();
  const ws = wb.addWorksheet(title.slice(0, 31)); // Excel sheet name max 31 chars

  // Title row
  ws.mergeCells(1, 1, 1, Math.max(columns.length, 1));
  const titleCell = ws.getCell(1, 1);
  titleCell.value = title;
  titleCell.font = { size: 14, bold: true, color: { argb: 'FF01152D' } };
  titleCell.alignment = { horizontal: 'left' };
  ws.addRow([]); // spacer

  // Header + column widths
  ws.columns = columns.map(c => ({ key: c.key, width: c.width || 18 }));
  const headerRow = ws.addRow(columns.map(c => c.header));
  headerRow.eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFD5C02' } };
    cell.alignment = { horizontal: 'left' };
  });

  // Data
  rows.forEach(r => ws.addRow(columns.map(c => r[c.key] ?? '')));

  // Totals row
  if (totals) {
    const totalRow = ws.addRow(columns.map((c, i) => (i === 0 ? 'TOTAL' : (totals[c.key] ?? ''))));
    totalRow.eachCell(cell => { cell.font = { bold: true }; });
  }

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${safeFileName(title)}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
}

/**
 * Stream a PDF document (simple tabular layout).
 * @param {object} opts { title, columns:[{key,header,width}], rows:[obj], totals:{key:value} }
 */
function sendPdf(res, { title = 'Report', columns = [], rows = [], totals = null } = {}) {
  const doc = new PDFDocument({ margin: 36, size: 'A4', layout: 'landscape' });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${safeFileName(title)}.pdf"`);
  doc.pipe(res);

  // Title
  doc.fontSize(16).fillColor('#01152D').text(title, { align: 'left' });
  doc.moveDown(0.3);
  doc.fontSize(8).fillColor('#64748b').text(`Generated: ${new Date().toLocaleString('en-IN')}`);
  doc.moveDown(0.6);

  const pageLeft  = doc.page.margins.left;
  const pageRight = doc.page.width - doc.page.margins.right;
  const usable    = pageRight - pageLeft;

  // Column widths — use provided width ratios or split evenly
  const totalWidthUnits = columns.reduce((s, c) => s + (c.width || 1), 0) || 1;
  const colX = [];
  let x = pageLeft;
  const colWidths = columns.map(c => {
    const w = ((c.width || 1) / totalWidthUnits) * usable;
    colX.push(x);
    x += w;
    return w;
  });

  const rowHeight = 18;

  function drawHeader(y) {
    doc.rect(pageLeft, y, usable, rowHeight).fill('#FD5C02');
    doc.fillColor('#FFFFFF').fontSize(8).font('Helvetica-Bold');
    columns.forEach((c, i) => {
      doc.text(String(c.header), colX[i] + 3, y + 5, { width: colWidths[i] - 6, ellipsis: true });
    });
    doc.font('Helvetica').fillColor('#111827');
    return y + rowHeight;
  }

  let y = drawHeader(doc.y);

  const drawRow = (values, bold = false) => {
    if (y + rowHeight > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
      y = drawHeader(doc.page.margins.top);
    }
    doc.fontSize(8).font(bold ? 'Helvetica-Bold' : 'Helvetica').fillColor('#111827');
    values.forEach((v, i) => {
      doc.text(v === null || v === undefined ? '' : String(v), colX[i] + 3, y + 5, {
        width: colWidths[i] - 6, ellipsis: true,
      });
    });
    doc.moveTo(pageLeft, y + rowHeight).lineTo(pageRight, y + rowHeight).strokeColor('#e2e8f0').stroke();
    y += rowHeight;
  };

  rows.forEach(r => drawRow(columns.map(c => r[c.key])));

  if (totals) {
    drawRow(columns.map((c, i) => (i === 0 ? 'TOTAL' : (totals[c.key] ?? ''))), true);
  }

  doc.end();
}

module.exports = { sendExcel, sendPdf };
