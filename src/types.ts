export type UserRole = 'admin' | 'hr' | 'employee';

export interface User {
  id: string;
  email: string;
  password_hash: string;
  role: UserRole;
  status: 'active' | 'deactivated';
  must_change_password: boolean;
  employee_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface CompanySettings {
  is_configured: boolean;
  company_name: string;
  office_start: string; // e.g. "09:00"
  grace_minutes: number; // 15
  half_day_hours: number; // 5
  weekend_days: number[]; // [0, 6] (0=Sun, 6=Sat)
  office_lat: number; // e.g. 24.8607
  office_lng: number; // e.g. 67.0011
  office_radius_meters: number; // 150
  annual_leave_quota: number; // 14
  sick_leave_quota: number; // 8
  casual_leave_quota: number; // 10
  late_penalty_rule: boolean; // 3 lates = 0.5 day
  require_face_attendance: boolean; // true: attendance only via verified face + GPS (no plain web check-in)
}

export interface Department {
  id: string;
  name: string;
  code: string;
  created_at: string;
}

export interface Designation {
  id: string;
  title: string;
  department_id: string;
}

export interface PublicHoliday {
  id: string;
  name: string;
  date: string; // YYYY-MM-DD
}

export interface Employee {
  id: string;
  code: string; // unique e.g. EMP001
  first_name: string;
  last_name: string;
  email: string; // unique
  phone: string;
  address: string;
  department_id: string;
  designation_id: string;
  joining_date: string; // YYYY-MM-DD
  status: 'active' | 'probation' | 'resigned' | 'terminated';
  gender: 'male' | 'female' | 'other';
  basic_salary: number; // Gross = 1.5 * basic (HRA 40%, Medical 10%)
  face_enrolled: boolean;
  face_descriptor?: number[] | null;
  face_photo_url?: string | null;
  created_at: string;
  updated_at: string;
}

export type AttendanceStatus = 'present' | 'late' | 'half_day' | 'absent' | 'missing_checkout';

export interface Attendance {
  id: string;
  employee_id: string;
  date: string; // YYYY-MM-DD
  check_in: string; // ISO
  check_out: string | null; // ISO
  source: 'web' | 'camera';
  status: AttendanceStatus;
  total_hours: number;
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  distance_meters: number | null;
  face_distance?: number | null; // server-computed descriptor distance (no photo stored)
  liveness_passed?: boolean | null;
  created_at: string;
}

export interface AttendanceCorrection {
  id: string;
  employee_id: string;
  attendance_id: string | null;
  date: string;
  requested_check_in: string;
  requested_check_out: string;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  reviewed_by: string | null;
  review_comment: string | null;
  created_at: string;
}

export type LeaveType = 'annual' | 'sick' | 'casual' | 'unpaid';

export interface LeaveRequest {
  id: string;
  employee_id: string;
  leave_type: LeaveType;
  start_date: string; // YYYY-MM-DD
  end_date: string; // YYYY-MM-DD
  working_days: number;
  reason: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  reviewed_by: string | null;
  review_comment: string | null;
  created_at: string;
}

export interface LeaveBalance {
  annual: { total: number; used: number; remaining: number };
  sick: { total: number; used: number; remaining: number };
  casual: { total: number; used: number; remaining: number };
  unpaid: { used: number };
}

export interface PayrollRun {
  id: string;
  month: string; // YYYY-MM
  status: 'draft' | 'finalized';
  prepared_by: string;
  finalized_by: string | null;
  finalized_at: string | null;
  working_days_in_month: number;
  total_gross: number;
  total_deductions: number;
  total_tax: number;
  total_net: number;
  created_at: string;
}

export interface Payslip {
  id: string;
  payroll_run_id: string;
  employee_id: string;
  month: string; // YYYY-MM
  basic_salary: number;
  hra: number;
  medical_allowance: number;
  gross_salary: number;
  working_days: number;
  attended_days: number;
  absent_days: number;
  unpaid_leave_days: number;
  half_days: number;
  late_count: number;
  late_penalty_days: number;
  absent_deduction: number;
  annual_taxable_gross: number;
  income_tax: number;
  net_salary: number;
  created_at: string;
}

export interface Announcement {
  id: string;
  title: string;
  content: string;
  created_by: string;
  created_by_name: string;
  priority: 'normal' | 'urgent';
  created_at: string;
}

export interface Notification {
  id: string;
  user_id: string;
  title: string;
  message: string;
  read: boolean;
  link?: string;
  created_at: string;
}

export interface AuditLog {
  id: string;
  actor_id: string;
  actor_email: string;
  actor_role: UserRole;
  action: string;
  entity: string;
  entity_id: string;
  before_json: any;
  after_json: any;
  ip: string;
  created_at: string;
  seq?: number;
  prev_hash?: string;
  hash?: string;
}

export interface AILog {
  id: string;
  user_id: string;
  user_role: string;
  endpoint: string;
  prompt: string;
  tools_called: string[];
  response_summary: string;
  created_at: string;
}
