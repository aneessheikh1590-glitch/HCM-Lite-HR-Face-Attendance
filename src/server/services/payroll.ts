import { db } from '../db.js';
import type { PayrollRun, Payslip, Employee } from '../../types.js';
import { calculateWorkingDays } from './leave.js';

export function calculateAnnualIncomeTax(annualGross: number): number {
  if (annualGross <= 600000) {
    return 0;
  } else if (annualGross <= 1200000) {
    return (annualGross - 600000) * 0.05;
  } else if (annualGross <= 2400000) {
    return 30000 + (annualGross - 1200000) * 0.15;
  } else if (annualGross <= 3600000) {
    return 210000 + (annualGross - 2400000) * 0.25;
  } else {
    return 510000 + (annualGross - 3600000) * 0.35;
  }
}

export function computeEmployeePayroll(
  employee: Employee,
  monthStr: string // YYYY-MM
): Payslip {
  const data = db.getData();
  const settings = data.settings;

  const [yearStr, monthNumStr] = monthStr.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthNumStr, 10) - 1; // 0-indexed for JS Date

  // Month date range
  const startDate = new Date(Date.UTC(year, month, 1));
  const endDate = new Date(Date.UTC(year, month + 1, 0)); // last day of month

  const startIso = startDate.toISOString().split('T')[0];
  const endIso = endDate.toISOString().split('T')[0];

  const holidayDates = data.holidays.map((h) => h.date);
  const totalWorkingDaysInMonth = calculateWorkingDays(
    startIso,
    endIso,
    settings.weekend_days || [0, 6],
    holidayDates
  ) || 22;

  // Basic, HRA, Medical, Gross (Gross = 1.5 * basic)
  const basicSalary = employee.basic_salary;
  const hra = Math.round(basicSalary * 0.4);
  const medicalAllowance = Math.round(basicSalary * 0.1);
  const fullMonthlyGross = basicSalary + hra + medicalAllowance;

  // Prorating joiners/leavers
  let effectiveWorkingDays = totalWorkingDaysInMonth;
  const joiningDate = new Date(employee.joining_date);

  if (joiningDate > startDate && joiningDate <= endDate) {
    const joinIso = joiningDate.toISOString().split('T')[0];
    effectiveWorkingDays = calculateWorkingDays(
      joinIso,
      endIso,
      settings.weekend_days || [0, 6],
      holidayDates
    );
  } else if (joiningDate > endDate) {
    effectiveWorkingDays = 0;
  }

  const perDayGross = effectiveWorkingDays > 0 ? fullMonthlyGross / totalWorkingDaysInMonth : 0;

  // Fetch employee attendance for this month
  const attendances = data.attendance.filter((a) => {
    return a.employee_id === employee.id && a.date >= startIso && a.date <= endIso;
  });

  let presentCount = 0;
  let lateCount = 0;
  let halfDayCount = 0;

  for (const att of attendances) {
    if (att.status === 'present') presentCount++;
    else if (att.status === 'late') {
      presentCount++;
      lateCount++;
    } else if (att.status === 'half_day') {
      halfDayCount++;
    }
  }

  // Approved leaves in this month
  const approvedLeaves = data.leave_requests.filter(
    (l) =>
      l.employee_id === employee.id &&
      l.status === 'approved' &&
      l.start_date <= endIso &&
      l.end_date >= startIso
  );

  let approvedPaidLeaveDays = 0;
  let unpaidLeaveDays = 0;

  for (const l of approvedLeaves) {
    // Intersect leave range with month range
    const effectiveStart = l.start_date < startIso ? startIso : l.start_date;
    const effectiveEnd = l.end_date > endIso ? endIso : l.end_date;
    const daysInMonth = calculateWorkingDays(
      effectiveStart,
      effectiveEnd,
      settings.weekend_days || [0, 6],
      holidayDates
    );

    if (l.leave_type === 'unpaid') {
      unpaidLeaveDays += daysInMonth;
    } else {
      approvedPaidLeaveDays += daysInMonth;
    }
  }

  // Total attended working units
  const attendedDays = presentCount + halfDayCount * 0.5;

  // Absent days: expected working days - attended days - approved paid leaves - unpaid leaves
  const accountedDays = presentCount + halfDayCount + approvedPaidLeaveDays + unpaidLeaveDays;
  const absentDays = Math.max(0, effectiveWorkingDays - accountedDays);

  // Bonus rule: 3 lates = 0.5 day deduction
  let latePenaltyDays = 0;
  if (settings.late_penalty_rule) {
    latePenaltyDays = Math.floor(lateCount / 3) * 0.5;
  }

  // Deduct absent + unpaid + 0.5 * half days + late penalty
  const deductionUnits = absentDays + unpaidLeaveDays + halfDayCount * 0.5 + latePenaltyDays;
  const absentDeduction = Math.round(deductionUnits * perDayGross);

  // Adjusted gross after prorating
  const proratedGross = Math.round(
    effectiveWorkingDays === totalWorkingDaysInMonth
      ? fullMonthlyGross
      : (fullMonthlyGross / totalWorkingDaysInMonth) * effectiveWorkingDays
  );

  // Tax slab calculation on annual gross (gross * 12)
  const annualTaxableGross = fullMonthlyGross * 12;
  const annualTax = calculateAnnualIncomeTax(annualTaxableGross);
  const monthlyIncomeTax = Math.round(annualTax / 12);

  const netSalary = Math.max(0, proratedGross - absentDeduction - monthlyIncomeTax);

  return {
    id: `ps-${monthStr}-${employee.id}`,
    payroll_run_id: '',
    employee_id: employee.id,
    month: monthStr,
    basic_salary: basicSalary,
    hra,
    medical_allowance: medicalAllowance,
    gross_salary: proratedGross,
    working_days: effectiveWorkingDays,
    attended_days: attendedDays,
    absent_days: absentDays,
    unpaid_leave_days: unpaidLeaveDays,
    half_days: halfDayCount,
    late_count: lateCount,
    late_penalty_days: latePenaltyDays,
    absent_deduction: absentDeduction,
    annual_taxable_gross: annualTaxableGross,
    income_tax: monthlyIncomeTax,
    net_salary: netSalary,
    created_at: new Date().toISOString(),
  };
}

export function generatePayrollDraft(monthStr: string, preparedByUserId: string): PayrollRun {
  const data = db.getData();
  const settings = data.settings;

  // Check if finalized run already exists
  const existingRun = data.payroll_runs.find((r) => r.month === monthStr);
  if (existingRun && existingRun.status === 'finalized') {
    throw new Error(`Payroll for ${monthStr} has already been finalized and locked.`);
  }

  // Remove existing draft for this month if re-generating
  if (existingRun && existingRun.status === 'draft') {
    data.payroll_runs = data.payroll_runs.filter((r) => r.month !== monthStr);
    data.payslips = data.payslips.filter((p) => p.month !== monthStr);
  }

  const [yearStr, monthNumStr] = monthStr.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthNumStr, 10) - 1;
  const startDate = new Date(Date.UTC(year, month, 1));
  const endDate = new Date(Date.UTC(year, month + 1, 0));

  const holidayDates = data.holidays.map((h) => h.date);
  const workingDays = calculateWorkingDays(
    startDate.toISOString().split('T')[0],
    endDate.toISOString().split('T')[0],
    settings.weekend_days || [0, 6],
    holidayDates
  ) || 22;

  const runId = `pr-${monthStr}-${Date.now()}`;
  const payslips: Payslip[] = [];
  let totalGross = 0;
  let totalDeductions = 0;
  let totalTax = 0;
  let totalNet = 0;

  // Process all active employees
  const activeEmployees = data.employees.filter(
    (e) => e.status === 'active' || e.status === 'probation'
  );

  for (const emp of activeEmployees) {
    const slip = computeEmployeePayroll(emp, monthStr);
    slip.payroll_run_id = runId;
    payslips.push(slip);

    totalGross += slip.gross_salary;
    totalDeductions += slip.absent_deduction;
    totalTax += slip.income_tax;
    totalNet += slip.net_salary;
  }

  const newRun: PayrollRun = {
    id: runId,
    month: monthStr,
    status: 'draft',
    prepared_by: preparedByUserId,
    finalized_by: null,
    finalized_at: null,
    working_days_in_month: workingDays,
    total_gross: totalGross,
    total_deductions: totalDeductions,
    total_tax: totalTax,
    total_net: totalNet,
    created_at: new Date().toISOString(),
  };

  data.payroll_runs.push(newRun);
  data.payslips.push(...payslips);
  db.save();

  return newRun;
}

export function finalizePayroll(monthStr: string, finalizedByAdminId: string): PayrollRun {
  const data = db.getData();
  const run = data.payroll_runs.find((r) => r.month === monthStr);

  if (!run) {
    throw new Error(`Payroll run for ${monthStr} not found.`);
  }

  if (run.status === 'finalized') {
    throw new Error(`Payroll run for ${monthStr} is already finalized and locked.`);
  }

  run.status = 'finalized';
  run.finalized_by = finalizedByAdminId;
  run.finalized_at = new Date().toISOString();

  // Create notifications for all employees about published payslips
  const slips = data.payslips.filter((p) => p.payroll_run_id === run.id);
  for (const slip of slips) {
    const user = data.users.find((u) => u.employee_id === slip.employee_id);
    if (user) {
      data.notifications.unshift({
        id: `notif-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        user_id: user.id,
        title: `Payslip Available (${slip.month})`,
        message: `Your payslip for ${slip.month} has been published. Net pay: PKR ${slip.net_salary.toLocaleString()}.`,
        read: false,
        link: '/employee/payslips',
        created_at: new Date().toISOString(),
      });
    }
  }

  db.save();
  return run;
}
