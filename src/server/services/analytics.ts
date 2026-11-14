import { db } from '../db.js';
import { getLeaveBalance } from './leave.js';
import { officeToday } from '../time.js';

export function getAdminDashboardMetrics() {
  const data = db.getData();
  const employees = data.employees;
  const departments = data.departments;

  // Headcount: active + probation
  const activeEmployees = employees.filter((e) => e.status === 'active' || e.status === 'probation');
  const headcount = activeEmployees.length;

  // Attrition YTD: exits in period / average headcount * 100
  const exits = employees.filter((e) => e.status === 'resigned' || e.status === 'terminated').length;
  const avgHeadcount = Math.max(1, (headcount + exits) / 2);
  const attritionYTD = Math.round((exits / avgHeadcount) * 1000) / 10;

  // Payroll cost: sum of gross from latest payroll run or estimated current active gross
  let latestPayrollCost = 0;
  let avgSalary = 0;

  const latestRun = data.payroll_runs[data.payroll_runs.length - 1];
  if (latestRun) {
    latestPayrollCost = latestRun.total_gross;
  } else {
    latestPayrollCost = activeEmployees.reduce((sum, e) => sum + e.basic_salary * 1.5, 0);
  }

  avgSalary = headcount > 0 ? Math.round(latestPayrollCost / headcount) : 0;

  // Headcount by department
  const headcountByDept = departments.map((dept) => {
    const count = activeEmployees.filter((e) => e.department_id === dept.id).length;
    return { department: dept.name, count };
  });

  // Payroll cost by department
  const payrollByDept = departments.map((dept) => {
    const deptEmps = activeEmployees.filter((e) => e.department_id === dept.id);
    const cost = deptEmps.reduce((sum, e) => sum + e.basic_salary * 1.5, 0);
    return { department: dept.name, cost };
  });

  // Gender distribution
  const genderStats = {
    male: activeEmployees.filter((e) => e.gender === 'male').length,
    female: activeEmployees.filter((e) => e.gender === 'female').length,
    other: activeEmployees.filter((e) => e.gender === 'other').length,
  };

  // Recent audit feed (latest 10)
  const auditFeed = data.audit_logs.slice(-10).reverse();

  return {
    headcount,
    attritionYTD,
    latestPayrollCost,
    avgSalary,
    headcountByDept,
    payrollByDept,
    genderStats,
    auditFeed,
  };
}

export function getHRDashboardMetrics() {
  const data = db.getData();
  const employees = data.employees;
  const departments = data.departments;
  const todayStr = officeToday();

  const activeEmployees = employees.filter((e) => e.status === 'active' || e.status === 'probation');
  const headcount = activeEmployees.length;

  // Today's attendance
  const todayAttendance = data.attendance.filter((a) => a.date === todayStr);
  const presentToday = todayAttendance.filter((a) => a.status === 'present' || a.status === 'late').length;
  const lateToday = todayAttendance.filter((a) => a.status === 'late').length;

  // On leave today
  const onLeaveToday = data.leave_requests.filter(
    (l) => l.status === 'approved' && l.start_date <= todayStr && l.end_date >= todayStr
  ).length;

  // Pending approvals
  const pendingLeaves = data.leave_requests.filter((l) => l.status === 'pending').length;
  const pendingCorrections = data.attendance_corrections.filter((c) => c.status === 'pending').length;
  const pendingApprovals = pendingLeaves + pendingCorrections;

  // Top late-comers (past 30 days)
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const thirtyDaysIso = thirtyDaysAgo.toISOString().split('T')[0];

  const lateRecords = data.attendance.filter((a) => a.date >= thirtyDaysIso && a.status === 'late');
  const lateCountMap = new Map<string, number>();

  for (const rec of lateRecords) {
    lateCountMap.set(rec.employee_id, (lateCountMap.get(rec.employee_id) || 0) + 1);
  }

  const topLateComers = Array.from(lateCountMap.entries())
    .map(([empId, count]) => {
      const emp = employees.find((e) => e.id === empId);
      const dept = departments.find((d) => d.id === emp?.department_id);
      return {
        employee_id: empId,
        name: emp ? `${emp.first_name} ${emp.last_name}` : 'Unknown',
        code: emp?.code || '',
        department: dept?.name || '',
        late_count: count,
      };
    })
    .sort((a, b) => b.late_count - a.late_count)
    .slice(0, 5);

  // Leave utilization by type
  const currentYear = new Date().getFullYear();
  const yearLeaves = data.leave_requests.filter(
    (l) => l.status === 'approved' && new Date(l.start_date).getFullYear() === currentYear
  );

  const leaveByType = {
    annual: yearLeaves.filter((l) => l.leave_type === 'annual').reduce((acc, l) => acc + l.working_days, 0),
    sick: yearLeaves.filter((l) => l.leave_type === 'sick').reduce((acc, l) => acc + l.working_days, 0),
    casual: yearLeaves.filter((l) => l.leave_type === 'casual').reduce((acc, l) => acc + l.working_days, 0),
    unpaid: yearLeaves.filter((l) => l.leave_type === 'unpaid').reduce((acc, l) => acc + l.working_days, 0),
  };

  // Attendance rate formula: (present + late + missing_checkout + 0.5 * half_day) / (working-day records - on_leave)
  const totalAttended = presentToday + lateToday;
  const attendanceRate =
    headcount > 0 ? Math.min(100, Math.round(((totalAttended) / Math.max(1, headcount - onLeaveToday)) * 100)) : 0;

  return {
    headcount,
    presentToday,
    onLeaveToday,
    lateToday,
    pendingApprovals,
    attendanceRate,
    topLateComers,
    leaveByType,
  };
}

export function getEmployeeDashboardMetrics(employeeId: string) {
  const data = db.getData();
  const todayStr = officeToday();

  // Today's attendance status
  const todayAttendance = data.attendance.find((a) => a.employee_id === employeeId && a.date === todayStr);

  // Hours this week
  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1); // Monday
  const monday = new Date(now.setDate(diff));
  const mondayStr = monday.toISOString().split('T')[0];

  const weekAttendance = data.attendance.filter(
    (a) => a.employee_id === employeeId && a.date >= mondayStr && a.date <= todayStr
  );
  const hoursThisWeek = weekAttendance.reduce((acc, a) => acc + (a.total_hours || 0), 0);

  // Late count this month
  const currentMonthStr = todayStr.substring(0, 7);
  const lateCountThisMonth = data.attendance.filter(
    (a) => a.employee_id === employeeId && a.date.startsWith(currentMonthStr) && a.status === 'late'
  ).length;

  // Leave balances
  const leaveBalance = getLeaveBalance(employeeId);

  // Latest payslip
  const latestPayslip = data.payslips
    .filter((p) => p.employee_id === employeeId)
    .sort((a, b) => b.month.localeCompare(a.month))[0] || null;

  return {
    todayAttendance,
    hoursThisWeek: Math.round(hoursThisWeek * 10) / 10,
    lateCountThisMonth,
    leaveBalance,
    latestPayslip,
  };
}
