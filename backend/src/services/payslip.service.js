const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const dayjs = require('dayjs');

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const resolveUpload = (urlPath) => {
  if (!urlPath) return null;
  const abs = path.join(process.cwd(), urlPath.replace(/^\/+/, ''));
  return fs.existsSync(abs) ? abs : null;
};

const fmt = (currency, n) => `${currency} ${Number(n || 0).toFixed(2)}`;

function drawHeaderBand(doc, { brand, company, monthLabel, logoPath }) {
  const pageWidth = doc.page.width;
  doc.save();
  doc.rect(0, 0, pageWidth, 90).fill(brand);
  doc.restore();

  if (logoPath) {
    try {
      doc.image(logoPath, 40, 18, { fit: [54, 54] });
    } catch (_) {
      /* ignore broken image */
    }
  }

  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(20).text(company, 110, 24, { width: 320 });
  doc.font('Helvetica').fontSize(10).fillColor('#e8ecff').text('PAYSLIP', 110, 50);

  doc
    .font('Helvetica-Bold')
    .fontSize(12)
    .fillColor('#ffffff')
    .text(monthLabel, pageWidth - 220, 32, { width: 180, align: 'right' });
  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor('#e8ecff')
    .text('Statement of Earnings & Deductions', pageWidth - 220, 50, { width: 180, align: 'right' });
}

function drawStatusStamp(doc, status) {
  const upper = String(status || 'GENERATED').toUpperCase();
  const colors = {
    PAID: '#1aab50',
    GENERATED: '#5b6ef5',
    DRAFT: '#888888',
  };
  const color = colors[upper] || colors.GENERATED;
  const pageWidth = doc.page.width;
  doc.save();
  // Position stamp just under the header band, top-right.
  doc.translate(pageWidth - 110, 110).rotate(-12);
  doc.lineWidth(2).strokeColor(color);
  doc.roundedRect(0, 0, 90, 32, 4).stroke();
  doc
    .font('Helvetica-Bold')
    .fontSize(16)
    .fillColor(color)
    .text(upper, 0, 8, { width: 90, align: 'center' });
  doc.restore();
}

function drawSection(doc, title, brand) {
  doc.moveDown(0.6);
  const y = doc.y;
  doc.save();
  doc.rect(40, y, 4, 14).fill(brand);
  doc.restore();
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#222').text(title, 52, y);
  doc.moveDown(0.4);
}

function drawIdentity(doc, employee) {
  const y = doc.y;
  const colW = (doc.page.width - 80) / 2;
  const rows = [
    ['Employee', employee.fullName || '—'],
    ['Employee ID', employee.employeeId || '—'],
    ['Designation', employee.designation || '—'],
    ['Email', employee.email || '—'],
  ];
  doc.font('Helvetica').fontSize(10);
  rows.forEach((row, idx) => {
    const col = idx % 2;
    const rowIdx = Math.floor(idx / 2);
    const x = 40 + col * colW;
    const ry = y + rowIdx * 16;
    doc.fillColor('#777').text(`${row[0]}:`, x, ry, { continued: true, width: colW });
    doc.fillColor('#000').text(`  ${row[1]}`);
  });
  doc.y = y + Math.ceil(rows.length / 2) * 16 + 4;
}

function drawStatTiles(doc, tiles, brand) {
  const pageWidth = doc.page.width - 80;
  const gap = 8;
  const tileW = (pageWidth - gap * (tiles.length - 1)) / tiles.length;
  const y = doc.y;
  tiles.forEach((t, i) => {
    const x = 40 + i * (tileW + gap);
    doc.save();
    doc.roundedRect(x, y, tileW, 46, 6).fill('#f4f5fb');
    doc.restore();
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor('#777')
      .text(t.label, x + 8, y + 8, { width: tileW - 16 });
    doc
      .font('Helvetica-Bold')
      .fontSize(14)
      .fillColor(t.color || brand)
      .text(t.value, x + 8, y + 22, { width: tileW - 16 });
  });
  doc.y = y + 52;
}

function drawAttendanceLines(doc, meta, currency) {
  const offNames = (meta.offDays || []).map((d) => DAY_NAMES[d]).join(', ') || 'None';
  doc.font('Helvetica').fontSize(9).fillColor('#444');
  doc.text(
    `Month Days: ${meta.monthDays ?? '—'}    Off Days (${offNames}): ${meta.offDayCount ?? 0}    Public Holidays: ${meta.holidayCount ?? 0}    Working Days: ${meta.workingDays}`
  );
  doc.text(
    `Per-Day Rate: ${fmt(currency, meta.perDayRate)}    Late Grace: ${meta.lateGraceCount ?? 0}    Chargeable Lates: ${meta.chargeableLates ?? 0} @ ${fmt(currency, meta.perLateCharge)}`
  );
}

function drawTicketBlock(doc, meta, currency) {
  doc.font('Helvetica').fontSize(9).fillColor('#444');
  doc.text(
    `Daily Target: ${meta.dailyTicketTarget}    Extra Tickets (month): ${meta.extraTickets}    Per-Ticket Incentive: ${fmt(currency, meta.incentivePerExtraTicket)}`
  );
  doc.font('Helvetica-Bold').fillColor('#1aab50').text(
    `Ticket Incentive Earned: ${fmt(currency, meta.ticketIncentive)}`
  );
}

function drawTwoColumnBreakdown(doc, currency, earnings, deductions, brand) {
  const startY = doc.y;
  const pageW = doc.page.width - 80;
  const colW = (pageW - 16) / 2;

  const drawColumn = (x, title, rows, total, totalLabel, accent) => {
    let y = startY;
    doc.save();
    doc.roundedRect(x, y, colW, 12 + rows.length * 16 + 28, 6).fill('#fafbff');
    doc.restore();

    doc.font('Helvetica-Bold').fontSize(10).fillColor(brand).text(title, x + 10, y + 8);
    y += 24;

    doc.font('Helvetica').fontSize(10);
    rows.forEach(([label, value]) => {
      doc.fillColor('#444').text(label, x + 10, y, { width: colW - 20 - 80 });
      doc
        .fillColor(value < 0 ? '#d33' : '#000')
        .text(fmt(currency, Math.abs(value)), x + colW - 90, y, { width: 80, align: 'right' });
      y += 16;
    });

    // total row
    doc.save();
    doc.moveTo(x + 10, y + 2).lineTo(x + colW - 10, y + 2).strokeColor('#dcdde6').lineWidth(0.5).stroke();
    doc.restore();
    doc.font('Helvetica-Bold').fontSize(11).fillColor(accent).text(totalLabel, x + 10, y + 6);
    doc.text(fmt(currency, total), x + colW - 90, y + 6, { width: 80, align: 'right' });

    return y + 26;
  };

  const grossTotal = earnings.reduce((s, [, v]) => s + Number(v || 0), 0);
  const deductionsTotal = deductions.reduce((s, [, v]) => s + Math.abs(Number(v || 0)), 0);

  const endLeft = drawColumn(40, 'Earnings', earnings, grossTotal, 'Gross', '#1aab50');
  const endRight = drawColumn(40 + colW + 16, 'Deductions', deductions, deductionsTotal, 'Total', '#d33');
  doc.y = Math.max(endLeft, endRight) + 6;

  return { grossTotal, deductionsTotal };
}

function drawNetBanner(doc, currency, net) {
  const pageW = doc.page.width - 80;
  const y = doc.y + 6;
  doc.save();
  doc.roundedRect(40, y, pageW, 44, 6).fill('#1aab50');
  doc.restore();
  doc.font('Helvetica-Bold').fontSize(12).fillColor('#ffffff').text('NET SALARY', 56, y + 14);
  doc
    .font('Helvetica-Bold')
    .fontSize(18)
    .fillColor('#ffffff')
    .text(fmt(currency, net), 40, y + 12, { width: pageW - 16, align: 'right' });
  doc.y = y + 50;
}

function drawSignature(doc, setting, payroll) {
  const pageW = doc.page.width - 80;
  const y = doc.y + 14;
  const signX = 40 + pageW - 200;

  // Left footer: dates
  doc.font('Helvetica').fontSize(8).fillColor('#666');
  doc.text(`Generated on: ${dayjs(payroll.generatedAt || new Date()).format('DD MMM YYYY')}`, 40, y);
  if (payroll.paidAt) {
    doc.text(`Paid on: ${dayjs(payroll.paidAt).format('DD MMM YYYY')}`, 40, y + 12);
  }
  doc.text(`Status: ${(payroll.status || 'GENERATED').toUpperCase()}`, 40, y + 24);

  // Right footer: signature
  const sigPath = resolveUpload(setting?.ceoSignatureUrl);
  if (sigPath) {
    try {
      doc.image(sigPath, signX, y - 24, { fit: [180, 40] });
    } catch (_) {
      /* ignore */
    }
  }
  doc.save();
  doc.moveTo(signX, y + 18).lineTo(signX + 180, y + 18).strokeColor('#000').lineWidth(0.6).stroke();
  doc.restore();
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#000').text(setting?.ceoName || 'CEO', signX, y + 22, { width: 180, align: 'center' });
  doc.font('Helvetica').fontSize(8).fillColor('#666').text(setting?.ceoTitle || 'Chief Executive Officer', signX, y + 34, { width: 180, align: 'center' });
  doc.text(setting?.companyName || 'The Live Agents', signX, y + 46, { width: 180, align: 'center' });

  doc.font('Helvetica-Oblique').fontSize(7).fillColor('#999').text(
    'This is a system-generated payslip. Any discrepancies must be reported to HR within 7 days.',
    40,
    doc.page.height - 50,
    { width: doc.page.width - 80, align: 'center' }
  );
}

const generatePayslipPDF = async (payroll, employee, setting) => {
  const dir = path.join(process.cwd(), process.env.UPLOAD_DIR || 'uploads', 'payslips');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const fileName = `payslip-${employee.employeeId || employee._id}-${payroll.year}-${String(payroll.month).padStart(2, '0')}.pdf`;
  const filePath = path.join(dir, fileName);

  const company = setting?.companyName || 'The Live Agents';
  const currency = setting?.currency || 'PKR';
  const brand = (setting?.theme && setting.theme.primary) || '#5b6ef5';
  const monthLabel = dayjs(`${payroll.year}-${payroll.month}-01`).format('MMMM YYYY');
  const meta = payroll._meta || {};
  const logoPath = resolveUpload(setting?.logoUrl);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 0, size: 'A4' });
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    // Header band + status stamp
    drawHeaderBand(doc, { brand, company, monthLabel, logoPath });
    drawStatusStamp(doc, payroll.status);

    // Move below header
    doc.y = 110;
    doc.x = 40;

    // Identity
    drawSection(doc, 'Employee Information', brand);
    drawIdentity(doc, employee);

    // Attendance summary
    drawSection(doc, 'Attendance Summary', brand);
    const workHours = ((payroll.workMinutes || 0) / 60).toFixed(1);
    drawStatTiles(
      doc,
      [
        { label: 'Present', value: String(payroll.presentDays ?? 0), color: '#1aab50' },
        { label: 'Absent', value: String(payroll.absentDays ?? 0), color: '#d33' },
        { label: 'Leaves', value: String(payroll.leaveDays ?? 0) },
        { label: 'Late', value: String(payroll.lateDays ?? 0), color: '#e69500' },
        { label: 'Work Hours', value: `${workHours}h` },
      ],
      brand
    );

    // Salary breakdown — two columns
    drawSection(doc, 'Salary Breakdown', brand);
    const earnings = [
      ['Basic Salary', payroll.basicSalary || 0],
      ['Ticket Incentive', meta.ticketIncentive || 0],
      ['Bonus', meta.bonus || 0],
      ['Additional Incentives', meta.manualIncentives || 0],
      ['Attendance Bonus', payroll.attendanceBonus || 0],
      ['Commission', payroll.commission || 0],
      ['Overtime', payroll.overtime || 0],
    ];
    const deductions = [
      ['Late Deduction', -(payroll.lateDeduction || 0)],
      ['Absent Deduction', -(payroll.absentDeduction || 0)],
      ['Tax', -(meta.tax || 0)],
      ['Other Deductions', -(meta.otherDeductionsInput || 0)],
    ];
    drawTwoColumnBreakdown(doc, currency, earnings, deductions, brand);

    // Net banner
    drawNetBanner(doc, currency, payroll.netSalary);

    // Signature + footer
    drawSignature(doc, setting, payroll);

    doc.end();
    stream.on('finish', () => resolve(`/uploads/payslips/${fileName}`));
    stream.on('error', reject);
  });
};

module.exports = { generatePayslipPDF };
