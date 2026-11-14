import { jsPDF } from 'jspdf';
import type { Payslip, Employee, CompanySettings } from '../types.js';

export function downloadPayslipPDF(
  payslip: Payslip & {
    employee_name?: string;
    employee_code?: string;
    department_name?: string;
    designation_title?: string;
  },
  companyName: string = 'Company'
) {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const primaryColor = [15, 23, 42]; // Slate 900
  const accentColor = [79, 70, 229]; // Indigo 600
  const textColor = [51, 65, 85]; // Slate 700
  const lightBg = [248, 250, 252]; // Slate 50

  // Header Banner
  doc.setFillColor(accentColor[0], accentColor[1], accentColor[2]);
  doc.rect(0, 0, 210, 32, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(20);
  doc.setFont('helvetica', 'bold');
  doc.text(companyName.toUpperCase(), 14, 18);

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text('OFFICIAL SALARY PAYSLIP — CONFIDENTIAL', 14, 26);

  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text(`MONTH: ${payslip.month}`, 150, 20);

  // Employee Information Box
  doc.setFillColor(lightBg[0], lightBg[1], lightBg[2]);
  doc.roundedRect(14, 40, 182, 36, 3, 3, 'F');
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(14, 40, 182, 36, 3, 3, 'S');

  doc.setTextColor(textColor[0], textColor[1], textColor[2]);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');

  doc.text('Employee Name:', 20, 48);
  doc.setFont('helvetica', 'normal');
  doc.text(payslip.employee_name || 'N/A', 55, 48);

  doc.setFont('helvetica', 'bold');
  doc.text('Employee Code:', 20, 56);
  doc.setFont('helvetica', 'normal');
  doc.text(payslip.employee_code || payslip.employee_id, 55, 56);

  doc.setFont('helvetica', 'bold');
  doc.text('Department:', 20, 64);
  doc.setFont('helvetica', 'normal');
  doc.text(payslip.department_name || 'General', 55, 64);

  doc.setFont('helvetica', 'bold');
  doc.text('Designation:', 110, 48);
  doc.setFont('helvetica', 'normal');
  doc.text(payslip.designation_title || 'Staff', 140, 48);

  doc.setFont('helvetica', 'bold');
  doc.text('Working Days:', 110, 56);
  doc.setFont('helvetica', 'normal');
  doc.text(`${payslip.working_days} Days`, 140, 56);

  doc.setFont('helvetica', 'bold');
  doc.text('Attended Days:', 110, 64);
  doc.setFont('helvetica', 'normal');
  doc.text(`${payslip.attended_days} Days (Half-days: ${payslip.half_days})`, 140, 64);

  // Earnings & Deductions Tables
  const startY = 86;

  // Earnings Header
  doc.setFillColor(241, 245, 249);
  doc.rect(14, startY, 90, 8, 'F');
  doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text('EARNINGS', 18, startY + 6);
  doc.text('AMOUNT (PKR)', 70, startY + 6);

  // Deductions Header
  doc.setFillColor(241, 245, 249);
  doc.rect(106, startY, 90, 8, 'F');
  doc.text('DEDUCTIONS & TAX', 110, startY + 6);
  doc.text('AMOUNT (PKR)', 162, startY + 6);

  // Earnings Rows
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(textColor[0], textColor[1], textColor[2]);

  let eY = startY + 16;
  doc.text('Basic Salary', 18, eY);
  doc.text(payslip.basic_salary.toLocaleString(), 75, eY);

  eY += 8;
  doc.text('House Rent Allowance (HRA 40%)', 18, eY);
  doc.text(payslip.hra.toLocaleString(), 75, eY);

  eY += 8;
  doc.text('Medical Allowance (10%)', 18, eY);
  doc.text(payslip.medical_allowance.toLocaleString(), 75, eY);

  // Deductions Rows
  let dY = startY + 16;
  doc.text(`Absent (${payslip.absent_days}d) & Unpaid (${payslip.unpaid_leave_days}d)`, 110, dY);
  doc.text(payslip.absent_deduction.toLocaleString(), 168, dY);

  dY += 8;
  doc.text(`Late Penalties (${payslip.late_count} lates)`, 110, dY);
  doc.text(`${payslip.late_penalty_days} day(s)`, 168, dY);

  dY += 8;
  doc.text('Income Tax (Per Slab Rules)', 110, dY);
  doc.text(payslip.income_tax.toLocaleString(), 168, dY);

  // Totals Line
  const totalY = 120;
  doc.setDrawColor(203, 213, 225);
  doc.line(14, totalY, 196, totalY);

  doc.setFont('helvetica', 'bold');
  doc.text('Total Gross Earnings:', 18, totalY + 8);
  doc.text(`PKR ${payslip.gross_salary.toLocaleString()}`, 65, totalY + 8);

  const totalDeductions = payslip.absent_deduction + payslip.income_tax;
  doc.text('Total Deductions:', 110, totalY + 8);
  doc.text(`PKR ${totalDeductions.toLocaleString()}`, 160, totalY + 8);

  // Net Pay Callout
  doc.setFillColor(accentColor[0], accentColor[1], accentColor[2]);
  doc.roundedRect(14, 140, 182, 22, 3, 3, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text('NET SALARY PAYABLE:', 24, 154);

  doc.setFontSize(16);
  doc.text(`PKR ${payslip.net_salary.toLocaleString()}`, 130, 154);

  // Footer & Compliance Notice
  doc.setTextColor(148, 163, 184);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.text(
    'This is a system-generated document authorized by HCM Lite. No physical signature is required.',
    14,
    180
  );
  doc.text(
    `Annual Gross: PKR ${payslip.annual_taxable_gross.toLocaleString()} | Generated on ${new Date().toLocaleDateString()}`,
    14,
    186
  );

  doc.save(`Payslip_${payslip.month}_${payslip.employee_code || 'EMP'}.pdf`);
}
