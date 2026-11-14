import { db } from '../db.js';
import type { LeaveBalance, LeaveRequest, LeaveType } from '../../types.js';

// Calculate working days between two ISO dates, excluding weekends and public holidays
export function calculateWorkingDays(
  startDateStr: string,
  endDateStr: string,
  weekendDays: number[] = [0, 6],
  holidayDates: string[] = []
): number {
  const start = new Date(startDateStr);
  const end = new Date(endDateStr);

  if (start > end) return 0;

  let count = 0;
  const current = new Date(start);

  while (current <= end) {
    const dayOfWeek = current.getUTCDay(); // 0 = Sun, 6 = Sat (UTC: timezone independent)
    const isoDate = current.toISOString().split('T')[0];

    const isWeekend = weekendDays.includes(dayOfWeek);
    const isHoliday = holidayDates.includes(isoDate);

    if (!isWeekend && !isHoliday) {
      count++;
    }

    current.setUTCDate(current.getUTCDate() + 1);
  }

  return count;
}

export function getLeaveBalance(employeeId: string): LeaveBalance {
  const data = db.getData();
  const settings = data.settings;

  // Filter approved leave requests for this employee in the current calendar year
  const currentYear = new Date().getFullYear();
  const approvedLeaves = data.leave_requests.filter(
    (l) =>
      l.employee_id === employeeId &&
      l.status === 'approved' &&
      new Date(l.start_date).getFullYear() === currentYear
  );

  let annualUsed = 0;
  let sickUsed = 0;
  let casualUsed = 0;
  let unpaidUsed = 0;

  for (const l of approvedLeaves) {
    if (l.leave_type === 'annual') annualUsed += l.working_days;
    else if (l.leave_type === 'sick') sickUsed += l.working_days;
    else if (l.leave_type === 'casual') casualUsed += l.working_days;
    else if (l.leave_type === 'unpaid') unpaidUsed += l.working_days;
  }

  const annualTotal = settings.annual_leave_quota || 14;
  const sickTotal = settings.sick_leave_quota || 8;
  const casualTotal = settings.casual_leave_quota || 10;

  return {
    annual: {
      total: annualTotal,
      used: annualUsed,
      remaining: Math.max(0, annualTotal - annualUsed),
    },
    sick: {
      total: sickTotal,
      used: sickUsed,
      remaining: Math.max(0, sickTotal - sickUsed),
    },
    casual: {
      total: casualTotal,
      used: casualUsed,
      remaining: Math.max(0, casualTotal - casualUsed),
    },
    unpaid: {
      used: unpaidUsed,
    },
  };
}

export function applyForLeave(params: {
  employee_id: string;
  leave_type: LeaveType;
  start_date: string;
  end_date: string;
  reason: string;
}): { success: boolean; leave?: LeaveRequest; error?: string; status_code?: number } {
  const data = db.getData();
  const settings = data.settings;

  const employee = data.employees.find((e) => e.id === params.employee_id);
  if (!employee) {
    return { success: false, error: 'Employee not found', status_code: 404 };
  }

  if (!['annual', 'sick', 'casual', 'unpaid'].includes(params.leave_type)) {
    return { success: false, error: 'Invalid leave type. Use annual, sick, casual or unpaid.', status_code: 422 };
  }
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (!iso.test(String(params.start_date)) || !iso.test(String(params.end_date)) || isNaN(Date.parse(params.start_date)) || isNaN(Date.parse(params.end_date))) {
    return { success: false, error: 'start_date and end_date must be valid ISO dates (YYYY-MM-DD).', status_code: 422 };
  }

  if (new Date(params.start_date) > new Date(params.end_date)) {
    return { success: false, error: 'Start date cannot be after end date', status_code: 422 };
  }

  // 1. Calculate working days skipping weekends and public holidays
  const holidayDates = data.holidays.map((h) => h.date);
  const workingDays = calculateWorkingDays(
    params.start_date,
    params.end_date,
    settings.weekend_days || [0, 6],
    holidayDates
  );

  if (workingDays <= 0) {
    return {
      success: false,
      error: 'Selected leave period falls entirely on weekends or company holidays (0 working days).',
      status_code: 422,
    };
  }

  // 2. Overlap check (Section 3 rule: Overlap = 422)
  const existingActiveLeaves = data.leave_requests.filter(
    (l) =>
      l.employee_id === params.employee_id &&
      (l.status === 'approved' || l.status === 'pending')
  );

  const reqStart = new Date(params.start_date).getTime();
  const reqEnd = new Date(params.end_date).getTime();

  for (const el of existingActiveLeaves) {
    const elStart = new Date(el.start_date).getTime();
    const elEnd = new Date(el.end_date).getTime();

    // Check date interval overlap
    if (reqStart <= elEnd && reqEnd >= elStart) {
      return {
        success: false,
        error: `Leave request overlaps with existing ${el.status} leave (${el.start_date} to ${el.end_date}). Overlapping leaves are rejected (422 Unprocessable Entity).`,
        status_code: 422,
      };
    }
  }

  // 3. Balance check (Section 3 rule: Over-balance = 422)
  const balances = getLeaveBalance(params.employee_id);
  if (params.leave_type !== 'unpaid') {
    // Pending requests of the same type are reserved so several pending requests cannot exceed the quota.
    const reserved = data.leave_requests
      .filter((l) => l.employee_id === params.employee_id && l.status === 'pending' && l.leave_type === params.leave_type)
      .reduce((sum, l) => sum + l.working_days, 0);
    const remaining = balances[params.leave_type].remaining - reserved;
    if (workingDays > remaining) {
      return {
        success: false,
        error: `Insufficient leave balance: requested ${workingDays} days, but only ${remaining} ${params.leave_type} leave days remaining. Exceeding quota is rejected (422).`,
        status_code: 422,
      };
    }
  }

  const newLeave: LeaveRequest = {
    id: `leave-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    employee_id: params.employee_id,
    leave_type: params.leave_type,
    start_date: params.start_date,
    end_date: params.end_date,
    working_days: workingDays,
    reason: params.reason,
    status: 'pending',
    reviewed_by: null,
    review_comment: null,
    created_at: new Date().toISOString(),
  };

  data.leave_requests.push(newLeave);
  db.save();

  return { success: true, leave: newLeave, status_code: 201 };
}
