import crypto from 'crypto';
import express, { type Request, type Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import { db } from './src/server/db.js';
import {
  authenticate,
  requireRole,
  enforceDataScope,
  generateToken,
  type AuthRequest,
} from './src/server/services/auth.js';
import { createAuditLog, verifyAuditChain } from './src/server/services/audit.js';
import { processCheckIn, processCheckOut } from './src/server/services/attendance.js';
import { enrollFace, deleteFace, faceStatus, issueChallenge, consumeChallenge, migrateLegacyFaceData } from './src/server/services/face.js';
import { applyForLeave, getLeaveBalance } from './src/server/services/leave.js';
import { generatePayrollDraft, finalizePayroll } from './src/server/services/payroll.js';
import {
  getAdminDashboardMetrics,
  getHRDashboardMetrics,
  getEmployeeDashboardMetrics,
} from './src/server/services/analytics.js';
import {
  handleAIChat,
  parseSmartLeave,
  generateDashboardSummary,
} from './src/server/services/ai.js';
import type { Department, Designation, Employee, PublicHoliday, AttendanceCorrection } from './src/types.js';
import { officeToday } from './src/server/time.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const args = process.argv.slice(2);
const portArgIndex = args.indexOf('--port');
const cliPort = portArgIndex !== -1 && args[portArgIndex + 1] ? parseInt(args[portArgIndex + 1], 10) : null;
const PORT = cliPort || parseInt(process.env.PORT || '3000', 10);
const isProduction = process.env.NODE_ENV === 'production';

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.set('trust proxy', 1);

// Serialise every mutating request (handlers await bcrypt etc., so they could interleave) and roll back
// unsaved in-memory changes if a request fails with 5xx or the connection drops. AI routes are exempt
// because they hold the lock for up to 15 s and only append to ai_logs synchronously.
let mutexTail: Promise<void> = Promise.resolve();
app.use('/api', (req: Request, res: Response, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.path.startsWith('/ai/')) return next();
  const prev = mutexTail;
  let release!: () => void;
  mutexTail = new Promise<void>((r) => (release = r));
  prev.then(() => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      if (res.statusCode >= 500 || !res.writableFinished) db.reload();
      release();
    };
    res.on('finish', finish);
    res.on('close', finish);
    next();
  });
});

// Minimal in-memory rate limiter (per key) for auth endpoints.
const hits = new Map<string, number[]>();
function tooMany(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
  arr.push(now);
  hits.set(key, arr);
  return arr.length > max;
}
const DUMMY_HASH = bcrypt.hashSync('timing-equalizer', 12);
function generateTempPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(14);
  return Array.from(bytes, (b) => chars[b % chars.length]).join('') + '#7';
}
function passwordPolicyError(pw: unknown): string | null {
  if (typeof pw !== 'string' || pw.length < 8) return 'Password must be at least 8 characters long.';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'Password must contain letters and numbers.';
  return null;
}

// ----------------------------------------------------
// 01. SYSTEM STATUS & FIRST-RUN SETUP
// ----------------------------------------------------
app.get('/api/system/status', (req: Request, res: Response) => {
  const data = db.getData();
  const hasAdmin = data.users.some((u) => u.role === 'admin');
  const isConfigured = data.settings.is_configured && hasAdmin;

  res.json({
    is_configured: isConfigured,
    company_name: data.settings.company_name || null,
    total_users: data.users.length,
    total_employees: data.employees.length,
  });
});

let setupInProgress = false;
app.post('/api/system/setup', async (req: Request, res: Response) => {
  // Single-flight guard: safe against simultaneous first-run requests (Node is single-threaded,
  // the flag is set synchronously before any await).
  if (setupInProgress) return res.status(409).json({ error: 'Setup is already in progress.' });
  setupInProgress = true;
  try {
  const data = db.getData();
  if (data.users.some((u) => u.role === 'admin') || data.settings.is_configured) {
    return res.status(403).json({ error: 'System is already configured.' });
  }

  const { company_name, company_email, office_address, admin_name, admin_email, admin_password, office_start, grace_minutes, weekend_days, office_lat, office_lng, office_radius_meters } = req.body;

  if (!company_name || !admin_email || !admin_password) {
    return res.status(400).json({ error: 'Company name, admin email, and admin password are required.' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(admin_email))) {
    return res.status(400).json({ error: 'A valid admin email is required.' });
  }
  if (String(admin_password).length < 8) {
    return res.status(400).json({ error: 'Admin password must be at least 8 characters.' });
  }
  const lat = Number(office_lat), lng = Number(office_lng), radius = Number(office_radius_meters);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
    return res.status(400).json({ error: 'Valid office latitude and longitude are required.' });
  }
  if (!Number.isFinite(radius) || radius < 10 || radius > 5000) {
    return res.status(400).json({ error: 'Geofence radius must be between 10 and 5000 metres.' });
  }

  const passwordHash = await bcrypt.hash(String(admin_password), 12);

  data.settings.company_name = company_name;
  data.settings.is_configured = true;
  (data.settings as any).company_email = company_email || '';
  (data.settings as any).office_address = office_address || '';
  (data.settings as any).admin_name = admin_name || '';
  if (office_start && /^\d{2}:\d{2}$/.test(office_start)) data.settings.office_start = office_start;
  if (Number.isInteger(Number(grace_minutes)) && Number(grace_minutes) >= 0) data.settings.grace_minutes = Number(grace_minutes);
  if (Array.isArray(weekend_days) && weekend_days.every((d: any) => Number.isInteger(d) && d >= 0 && d <= 6)) data.settings.weekend_days = weekend_days;
  data.settings.office_lat = lat;
  data.settings.office_lng = lng;
  data.settings.office_radius_meters = radius;

  const adminUser = {
    id: `usr-${crypto.randomUUID()}`,
    email: admin_email.toLowerCase().trim(),
    password_hash: passwordHash,
    role: 'admin' as const,
    status: 'active' as const,
    must_change_password: false,
    employee_id: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  data.users.push(adminUser);

  createAuditLog({
    actor_id: adminUser.id,
    actor_email: adminUser.email,
    actor_role: 'admin',
    action: 'company.first_run_setup',
    entity: 'settings',
    entity_id: 'default',
    after_json: { company_name, admin_email },
    ip: req.ip,
  });

  db.save();

  const token = generateToken(adminUser);
  res.status(201).json({
    message: 'Setup successful! Welcome to HCM Lite.',
    user: {
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
      must_change_password: adminUser.must_change_password,
    },
    token,
  });
  } finally {
    setupInProgress = false;
  }
});


// ----------------------------------------------------
// 02. AUTHENTICATION & SESSIONS
// ----------------------------------------------------
app.post('/api/auth/login', async (req: Request, res: Response) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  if (tooMany(`login:${String(email).toLowerCase()}`, 8, 15 * 60 * 1000) || tooMany(`loginip:${req.ip}`, 60, 15 * 60 * 1000)) {
    return res.status(429).json({ error: 'Too many login attempts. Try again in 15 minutes.' });
  }
  const data = db.getData();
  const user = data.users.find((u) => u.email.toLowerCase() === String(email).toLowerCase().trim());

  if (!user) {
    await bcrypt.compare(String(password), DUMMY_HASH);
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  if (user.status === 'deactivated') {
    return res.status(403).json({ error: 'Account is deactivated. Contact Admin.' });
  }

  const isMatch = await bcrypt.compare(password, user.password_hash);
  if (!isMatch) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  const token = generateToken(user);
  let employeeProfile = null;
  if (user.employee_id) {
    employeeProfile = data.employees.find((e) => e.id === user.employee_id) || null;
  }

  createAuditLog({
    actor_id: user.id,
    actor_email: user.email,
    actor_role: user.role,
    action: 'auth.login',
    entity: 'user',
    entity_id: user.id,
    ip: req.ip,
  });

  res.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      must_change_password: user.must_change_password,
      employee_id: user.employee_id,
      profile: employeeProfile,
    },
  });
});

app.post('/api/auth/change-password', authenticate, async (req: AuthRequest, res: Response) => {
  const user = req.user!;
  const { current_password, new_password } = req.body;

  const policyErr = passwordPolicyError(new_password);
  if (policyErr) return res.status(400).json({ error: policyErr });
  if (await bcrypt.compare(new_password, user.password_hash)) {
    return res.status(400).json({ error: 'New password must be different from the current/temporary password.' });
  }

  if (!user.must_change_password) {
    const isMatch = await bcrypt.compare(current_password || '', user.password_hash);
    if (!isMatch) {
      return res.status(400).json({ error: 'Current password does not match.' });
    }
  }

  user.password_hash = await bcrypt.hash(new_password, 12);
  user.must_change_password = false;
  user.updated_at = new Date().toISOString();

  createAuditLog({
    actor_id: user.id,
    actor_email: user.email,
    actor_role: user.role,
    action: 'auth.change_password',
    entity: 'user',
    entity_id: user.id,
    ip: req.ip,
  });

  db.save();
  res.json({ message: 'Password changed successfully.' });
});

app.post('/api/auth/forgot-password', async (req: Request, res: Response) => {
  const email = String(req.body?.email || '').toLowerCase().trim();
  const generic = { message: 'If that account exists, an Admin has been notified and will share a one-time reset code with you.' };
  if (!email || tooMany(`forgot:${req.ip}`, 5, 60 * 60 * 1000) || tooMany(`forgot:${email}`, 3, 60 * 60 * 1000)) return res.json(generic);
  const data = db.getData();
  const user = data.users.find((u) => u.email.toLowerCase() === email && u.status === 'active');
  if (user) {
    const code = crypto.randomBytes(5).toString('hex').toUpperCase(); // 10 hex chars, single use, 30 min
    data.password_resets = data.password_resets.filter((r) => r.user_id !== user.id);
    data.password_resets.push({
      user_id: user.id,
      token_hash: crypto.createHash('sha256').update(code).digest('hex'),
      expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      used: false,
      created_at: new Date().toISOString(),
    });
    // No email provider is bundled: deliver the one-time code to Admins in-app (they relay it out-of-band).
    for (const admin of data.users.filter((u) => u.role === 'admin' && u.status === 'active' && u.id !== user.id)) {
      data.notifications.push({ id: `ntf-${crypto.randomUUID()}`, user_id: admin.id, title: 'Password reset requested', message: `${user.email} requested a password reset. One-time code (valid 30 min): ${code}`, read: false, created_at: new Date().toISOString() } as any);
    }
    if (process.env.RESET_CODE_TO_CONSOLE === 'true') console.log(`[password-reset] ${user.email}: ${code}`);
    createAuditLog({ actor_id: user.id, actor_email: user.email, actor_role: user.role, action: 'auth.password_reset_requested', entity: 'user', entity_id: user.id, ip: req.ip });
    db.save();
  }
  res.json(generic);
});

app.post('/api/auth/reset-password', async (req: Request, res: Response) => {
  const email = String(req.body?.email || '').toLowerCase().trim();
  const code = String(req.body?.code || '').trim().toUpperCase();
  const newPassword = req.body?.new_password;
  if (tooMany(`reset:${req.ip}`, 10, 15 * 60 * 1000) || tooMany(`reset:${email}`, 5, 15 * 60 * 1000)) return res.status(429).json({ error: 'Too many attempts. Try again later.' });
  const policyErr = passwordPolicyError(newPassword);
  if (policyErr) return res.status(400).json({ error: policyErr });
  const data = db.getData();
  const user = data.users.find((u) => u.email.toLowerCase() === email && u.status === 'active');
  const hash = crypto.createHash('sha256').update(code).digest('hex');
  const rec = user && data.password_resets.find((r) => r.user_id === user.id && !r.used);
  if (!user || !rec || rec.token_hash !== hash || new Date(rec.expires_at).getTime() < Date.now()) {
    return res.status(400).json({ error: 'Invalid or expired reset code.' });
  }
  user.password_hash = await bcrypt.hash(newPassword, 12);
  user.must_change_password = false;
  user.updated_at = new Date().toISOString();
  rec.used = true;
  createAuditLog({ actor_id: user.id, actor_email: user.email, actor_role: user.role, action: 'auth.password_reset_completed', entity: 'user', entity_id: user.id, ip: req.ip });
  db.save();
  res.json({ message: 'Password reset. You can now sign in.' });
});

app.get('/api/auth/me', authenticate, (req: AuthRequest, res: Response) => {
  const user = req.user!;
  const data = db.getData();
  const employeeProfile = user.employee_id ? data.employees.find((e) => e.id === user.employee_id) : null;
  res.json({
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      must_change_password: user.must_change_password,
      employee_id: user.employee_id,
      profile: employeeProfile,
    },
    settings: {
      company_name: data.settings.company_name,
      office_start: data.settings.office_start,
      office_lat: data.settings.office_lat,
      office_lng: data.settings.office_lng,
      office_radius_meters: data.settings.office_radius_meters,
    },
  });
});

// ----------------------------------------------------
// 03. COMPANY SETTINGS (Admin Manage, HR View)
// ----------------------------------------------------
app.get('/api/settings', authenticate, (req: AuthRequest, res: Response) => {
  const data = db.getData();
  res.json(data.settings);
});

app.put('/api/settings', authenticate, requireRole(['admin']), (req: AuthRequest, res: Response) => {
  const data = db.getData();
  const oldSettings = { ...data.settings };
  const updates = req.body;

  Object.assign(data.settings, updates);

  createAuditLog({
    actor_id: req.user!.id,
    actor_email: req.user!.email,
    actor_role: req.user!.role,
    action: 'settings.update',
    entity: 'settings',
    entity_id: 'default',
    before_json: oldSettings,
    after_json: data.settings,
    ip: req.ip,
  });

  db.save();
  res.json({ message: 'Company settings updated successfully.', settings: data.settings });
});

// ----------------------------------------------------
// 04. DEPARTMENTS, DESIGNATIONS, HOLIDAYS (Admin Manage, HR View)
// ----------------------------------------------------
app.get('/api/organization/departments', authenticate, (req: AuthRequest, res: Response) => {
  res.json(db.getData().departments);
});

app.post('/api/organization/departments', authenticate, requireRole(['admin']), (req: AuthRequest, res: Response) => {
  const { name, code } = req.body;
  if (!name || !code) return res.status(400).json({ error: 'Name and code are required.' });

  const data = db.getData();
  const newDept: Department = {
    id: `dept-${crypto.randomUUID()}`,
    name,
    code: code.toUpperCase(),
    created_at: new Date().toISOString(),
  };

  data.departments.push(newDept);
  createAuditLog({
    actor_id: req.user!.id,
    actor_email: req.user!.email,
    actor_role: req.user!.role,
    action: 'department.create',
    entity: 'department',
    entity_id: newDept.id,
    after_json: newDept,
    ip: req.ip,
  });

  db.save();
  res.status(201).json(newDept);
});

app.get('/api/organization/designations', authenticate, (req: AuthRequest, res: Response) => {
  res.json(db.getData().designations);
});

app.post('/api/organization/designations', authenticate, requireRole(['admin']), (req: AuthRequest, res: Response) => {
  const { title, department_id } = req.body;
  if (!title || !department_id) return res.status(400).json({ error: 'Title and department_id required.' });

  const data = db.getData();
  const newDes: Designation = {
    id: `des-${crypto.randomUUID()}`,
    title,
    department_id,
  };
  data.designations.push(newDes);
  db.save();
  res.status(201).json(newDes);
});

app.get('/api/organization/holidays', authenticate, (req: AuthRequest, res: Response) => {
  res.json(db.getData().holidays);
});

app.post('/api/organization/holidays', authenticate, requireRole(['admin']), (req: AuthRequest, res: Response) => {
  const { name, date } = req.body;
  if (!name || !date) return res.status(400).json({ error: 'Holiday name and date are required.' });

  const data = db.getData();
  const holiday: PublicHoliday = {
    id: `hol-${crypto.randomUUID()}`,
    name,
    date,
  };
  data.holidays.push(holiday);
  db.save();
  res.status(201).json(holiday);
});

// ----------------------------------------------------
// 05. USER MANAGEMENT (Admin Manage)
// ----------------------------------------------------
app.get('/api/users', authenticate, requireRole(['admin']), (req: AuthRequest, res: Response) => {
  const users = db.getData().users.map(({ password_hash, ...u }) => u);
  res.json(users);
});

app.post('/api/users/hr', authenticate, requireRole(['admin']), async (req: AuthRequest, res: Response) => {
  const { email } = req.body;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email))) return res.status(400).json({ error: 'A valid email is required.' });
  // If the Admin typed a password it must satisfy the policy (never silently replaced by a random one).
  if (req.body.password) {
    const pwErr = passwordPolicyError(req.body.password);
    if (pwErr) return res.status(400).json({ error: pwErr });
  }
  const password: string = req.body.password ? String(req.body.password) : generateTempPassword();

  const data = db.getData();
  if (data.users.some((u) => u.email.toLowerCase() === email.toLowerCase().trim())) {
    return res.status(409).json({ error: 'User with this email already exists.' });
  }

  const hash = await bcrypt.hash(password, 12);

  const hrUser = {
    id: `usr-${crypto.randomUUID()}`,
    email: email.toLowerCase().trim(),
    password_hash: hash,
    role: 'hr' as const,
    status: 'active' as const,
    must_change_password: true, // change on first login
    employee_id: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  data.users.push(hrUser);
  createAuditLog({
    actor_id: req.user!.id,
    actor_email: req.user!.email,
    actor_role: req.user!.role,
    action: 'user.create_hr',
    entity: 'user',
    entity_id: hrUser.id,
    after_json: { email, role: 'hr' },
    ip: req.ip,
  });

  db.save();
  res.status(201).json({ message: 'HR user created. Share the temporary password securely; it must be changed on first sign-in.', user: { id: hrUser.id, email: hrUser.email }, temporary_password: password });
});

app.patch('/api/users/:id/status', authenticate, requireRole(['admin']), (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { status } = req.body; // 'active' | 'deactivated'

  const data = db.getData();
  const target = data.users.find((u) => u.id === id);
  if (!target) return res.status(404).json({ error: 'User not found.' });

  if (target.id === req.user!.id) {
    return res.status(400).json({ error: 'Cannot deactivate your own admin account.' });
  }

  const prevStatus = target.status;
  target.status = status;
  target.updated_at = new Date().toISOString();

  createAuditLog({
    actor_id: req.user!.id,
    actor_email: req.user!.email,
    actor_role: req.user!.role,
    action: 'user.status_change',
    entity: 'user',
    entity_id: target.id,
    before_json: { status: prevStatus },
    after_json: { status: target.status },
    ip: req.ip,
  });

  db.save();
  res.json({ message: `User status updated to ${status}.` });
});

app.post('/api/users/:id/reset-password', authenticate, requireRole(['admin']), async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { temporary_password } = req.body;
  if (!temporary_password) return res.status(400).json({ error: 'Temporary password required.' });
  { const pwErr = passwordPolicyError(temporary_password); if (pwErr) return res.status(400).json({ error: pwErr }); }

  const data = db.getData();
  const target = data.users.find((u) => u.id === id);
  if (!target) return res.status(404).json({ error: 'User not found.' });

  const salt = await bcrypt.genSalt(10);
  target.password_hash = await bcrypt.hash(temporary_password, salt);
  target.must_change_password = true;
  target.updated_at = new Date().toISOString();

  createAuditLog({
    actor_id: req.user!.id,
    actor_email: req.user!.email,
    actor_role: req.user!.role,
    action: 'user.reset_password',
    entity: 'user',
    entity_id: target.id,
    ip: req.ip,
  });

  db.save();
  res.json({ message: 'User password reset. User will be required to change password on next sign in.' });
});

// ----------------------------------------------------
// 06 & 07. EMPLOYEES & 360 PROFILE (HR Manage, Admin View, Employee Own)
// ----------------------------------------------------
app.get('/api/employees', authenticate, (req: AuthRequest, res: Response) => {
  const user = req.user!;
  const data = db.getData();

  if (user.role === 'employee') {
    // Employee only reads their own profile
    const emp = data.employees.find((e) => e.id === user.employee_id);
    return res.json(emp ? [emp] : []);
  }

  // Admin / HR gets full directory with search/filters
  const { search, department_id, status } = req.query;
  let results = [...data.employees];

  if (search) {
    const q = (search as string).toLowerCase();
    results = results.filter(
      (e) =>
        e.first_name.toLowerCase().includes(q) ||
        e.last_name.toLowerCase().includes(q) ||
        e.code.toLowerCase().includes(q) ||
        e.email.toLowerCase().includes(q)
    );
  }

  if (department_id) {
    results = results.filter((e) => e.department_id === department_id);
  }

  if (status) {
    results = results.filter((e) => e.status === status);
  }

  res.json(results);
});

app.post('/api/employees', authenticate, requireRole(['hr', 'admin']), async (req: AuthRequest, res: Response) => {
  const data = db.getData();
  const {
    code,
    first_name,
    last_name,
    email,
    phone,
    address,
    department_id,
    designation_id,
    joining_date,
    gender,
    basic_salary,
    temporary_password,
  } = req.body;

  if (!code || !first_name || !last_name || !email || !basic_salary || !department_id) {
    return res.status(400).json({ error: 'Required employee fields missing.' });
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email))) return res.status(422).json({ error: 'A valid email is required.' });
  if (!(Number(basic_salary) > 0)) return res.status(422).json({ error: 'Basic salary must be greater than 0.' });
  if (!data.departments.some((d) => d.id === department_id)) return res.status(422).json({ error: 'Unknown department.' });
  if (temporary_password) {
    const pwErr = passwordPolicyError(temporary_password);
    if (pwErr) return res.status(400).json({ error: pwErr });
  }

  // Unique email and code check
  if (data.employees.some((e) => e.code.toLowerCase() === code.toLowerCase().trim())) {
    return res.status(409).json({ error: `Employee code '${code}' already exists.` });
  }
  if (data.employees.some((e) => e.email.toLowerCase() === email.toLowerCase().trim())) {
    return res.status(409).json({ error: `Employee email '${email}' already exists.` });
  }

  const empId = `emp-${crypto.randomUUID()}`;
  const newEmp: Employee = {
    id: empId,
    code: code.trim().toUpperCase(),
    first_name: first_name.trim(),
    last_name: last_name.trim(),
    email: email.trim().toLowerCase(),
    phone: phone || '',
    address: address || '',
    department_id,
    designation_id: designation_id || '',
    joining_date: joining_date || officeToday(),
    status: 'active',
    gender: gender || 'male',
    basic_salary: Number(basic_salary),
    face_enrolled: false,
    face_descriptor: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  data.employees.push(newEmp);

  // Auto-create Employee login account with temporary password
  const tempPass = temporary_password ? String(temporary_password) : generateTempPassword();
  const passwordHash = await bcrypt.hash(tempPass, 12);

  const newUser = {
    id: `usr-${empId}`,
    email: newEmp.email,
    password_hash: passwordHash,
    role: 'employee' as const,
    status: 'active' as const,
    must_change_password: true,
    employee_id: empId,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  data.users.push(newUser);

  createAuditLog({
    actor_id: req.user!.id,
    actor_email: req.user!.email,
    actor_role: req.user!.role,
    action: 'employee.register',
    entity: 'employee',
    entity_id: empId,
    after_json: { code: newEmp.code, email: newEmp.email, basic_salary: newEmp.basic_salary },
    ip: req.ip,
  });

  db.save();
  res.status(201).json({ employee: newEmp, temporary_password: tempPass });
});

// Employee 360 profile
app.get('/api/employees/:id/360', authenticate, (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  if (!enforceDataScope(req, id)) {
    return res.status(403).json({ error: 'Permission denied: cannot access other employees 360 profile.' });
  }

  const data = db.getData();
  const emp = data.employees.find((e) => e.id === id);
  if (!emp) return res.status(404).json({ error: 'Employee not found.' });

  const dept = data.departments.find((d) => d.id === emp.department_id);
  const des = data.designations.find((d) => d.id === emp.designation_id);
  const attendances = data.attendance.filter((a) => a.employee_id === id).slice(-30);
  const leaves = data.leave_requests.filter((l) => l.employee_id === id);
  const balance = getLeaveBalance(id);
  const payslips = data.payslips.filter((p) => p.employee_id === id).slice(-12);

  // Attrition risk score calculation (Bonus feature: based on lates, leaves, tenure)
  const latesCount = attendances.filter((a) => a.status === 'late').length;
  const tenureMonths = Math.max(1, Math.round((Date.now() - new Date(emp.joining_date).getTime()) / (1000 * 60 * 60 * 24 * 30)));
  const attritionRiskScore = Math.min(95, Math.max(5, latesCount * 8 + (emp.status === 'probation' ? 15 : 0)));

  res.json({
    employee: emp,
    department: dept,
    designation: des,
    gross_salary: emp.basic_salary * 1.5,
    hra: emp.basic_salary * 0.4,
    medical_allowance: emp.basic_salary * 0.1,
    attendance_recent: attendances,
    leave_requests: leaves,
    leave_balance: balance,
    payslips,
    attrition_risk_score: attritionRiskScore,
  });
});

// Update employee (HR edit details, or Employee edit own phone/address)
app.patch('/api/employees/:id', authenticate, (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const user = req.user!;
  const data = db.getData();
  const emp = data.employees.find((e) => e.id === id);
  if (!emp) return res.status(404).json({ error: 'Employee not found.' });

  const prev = { ...emp };

  if (user.role === 'employee') {
    if (user.employee_id !== id) {
      return res.status(403).json({ error: 'Forbidden: You can only edit your own contact info.' });
    }
    // Employee can ONLY edit phone and address
    if (req.body.phone !== undefined) emp.phone = req.body.phone;
    if (req.body.address !== undefined) emp.address = req.body.address;
  } else if (user.role === 'hr' || user.role === 'admin') {
    const { phone, address, department_id, designation_id, status, basic_salary, first_name, last_name } = req.body;
    if (status !== undefined && !['active', 'probation', 'resigned', 'terminated'].includes(status)) {
      return res.status(422).json({ error: 'Invalid employee status.' });
    }
    if (basic_salary !== undefined && (!Number.isFinite(Number(basic_salary)) || Number(basic_salary) <= 0)) {
      return res.status(422).json({ error: 'Basic salary must be a number greater than 0.' });
    }
    if (department_id !== undefined && !data.departments.some((d) => d.id === department_id)) {
      return res.status(422).json({ error: 'Unknown department.' });
    }
    if (phone !== undefined) emp.phone = phone;
    if (address !== undefined) emp.address = address;
    if (department_id !== undefined) emp.department_id = department_id;
    if (designation_id !== undefined) emp.designation_id = designation_id;
    if (status !== undefined) {
      emp.status = status;
      // Keep the login in sync: leavers cannot sign in; reactivated employees can.
      const login = data.users.find((u) => u.employee_id === emp.id);
      if (login) login.status = status === 'resigned' || status === 'terminated' ? 'deactivated' : 'active';
    }
    if (basic_salary !== undefined) emp.basic_salary = Number(basic_salary);
    if (first_name !== undefined) emp.first_name = first_name;
    if (last_name !== undefined) emp.last_name = last_name;
  }

  emp.updated_at = new Date().toISOString();

  createAuditLog({
    actor_id: user.id,
    actor_email: user.email,
    actor_role: user.role,
    action: 'employee.update',
    entity: 'employee',
    entity_id: emp.id,
    before_json: prev,
    after_json: emp,
    ip: req.ip,
  });

  db.save();
  res.json(emp);
});

// ----------------------------------------------------
// FACE RECOGNITION (enrollment, status, delete, per-attempt challenge)
// Descriptors are computed in the browser with a pretrained model; the SERVER stores them encrypted
// and does all matching against the AUTHENTICATED employee only.
// ----------------------------------------------------
app.get('/api/face/status', authenticate, (req: AuthRequest, res: Response) => {
  if (!req.user!.employee_id) return res.status(400).json({ error: 'No employee profile linked to this user.' });
  res.json(faceStatus(req.user!.employee_id));
});

app.post('/api/face/enroll', authenticate, (req: AuthRequest, res: Response) => {
  const empId = req.user!.employee_id; // identity comes from the token, never from the request body
  if (!empId) return res.status(403).json({ error: 'Only an employee can enroll their own face.' });
  if (req.body?.consent !== true) return res.status(400).json({ error: 'Explicit biometric consent is required.' });
  if (req.body?.liveness_passed !== true) return res.status(422).json({ error: 'Liveness check (blink) must be completed during enrollment.' });
  const r = enrollFace(empId, req.body?.descriptors);
  if (!r.ok) return res.status(422).json({ error: r.error });
  createAuditLog({ actor_id: req.user!.id, actor_email: req.user!.email, actor_role: req.user!.role, action: 'employee.face_enroll', entity: 'employee', entity_id: empId, after_json: { samples: r.samples, consent: true }, ip: req.ip });
  res.status(201).json({ message: 'Face enrolled.', ...faceStatus(empId) });
});

app.delete('/api/face/:employeeId', authenticate, (req: AuthRequest, res: Response) => {
  const { employeeId } = req.params;
  if (!enforceDataScope(req, employeeId)) return res.status(403).json({ error: 'Permission denied.' });
  deleteFace(employeeId);
  createAuditLog({ actor_id: req.user!.id, actor_email: req.user!.email, actor_role: req.user!.role, action: 'employee.face_delete', entity: 'employee', entity_id: employeeId, ip: req.ip });
  res.json({ message: 'Face template deleted. The employee must enroll again.' });
});

app.post('/api/attendance/challenge', authenticate, (req: AuthRequest, res: Response) => {
  if (!req.user!.employee_id) return res.status(400).json({ error: 'No employee profile linked to user.' });
  res.json(issueChallenge(req.user!.employee_id));
});

// ----------------------------------------------------
// 08. CSV IMPORT DRY-RUN & EXPORT (HR Manage)
// ----------------------------------------------------
app.post('/api/employees/csv-import/dry-run', authenticate, requireRole(['hr', 'admin']), (req: AuthRequest, res: Response) => {
  const { rows } = req.body; // Array of employee objects parsed from CSV
  if (!Array.isArray(rows)) return res.status(400).json({ error: 'Rows array required.' });

  const data = db.getData();
  const errors: Array<{ row: number; field: string; reason: string }> = [];
  const validRows: any[] = [];

  const seenCodes = new Set(data.employees.map((e) => e.code.toUpperCase()));
  const seenEmails = new Set(data.employees.map((e) => e.email.toLowerCase()));

  rows.forEach((row, idx) => {
    const rowNum = idx + 1;
    let hasError = false;

    // Checks required fields, unique code/email, valid email, known dept, ISO date, salary > 0
    if (!row.code) {
      errors.push({ row: rowNum, field: 'code', reason: 'Employee code is required.' });
      hasError = true;
    } else if (seenCodes.has(row.code.toUpperCase())) {
      errors.push({ row: rowNum, field: 'code', reason: `Employee code '${row.code}' already exists.` });
      hasError = true;
    }

    if (!row.email) {
      errors.push({ row: rowNum, field: 'email', reason: 'Email is required.' });
      hasError = true;
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)) {
      errors.push({ row: rowNum, field: 'email', reason: 'Invalid email address format.' });
      hasError = true;
    } else if (seenEmails.has(row.email.toLowerCase())) {
      errors.push({ row: rowNum, field: 'email', reason: `Email '${row.email}' already exists.` });
      hasError = true;
    }

    if (!row.department_name && !row.department_id) {
      errors.push({ row: rowNum, field: 'department', reason: 'Department is required.' });
      hasError = true;
    } else {
      const deptExists = data.departments.some(
        (d) =>
          d.id === row.department_id ||
          d.name.toLowerCase() === (row.department_name || '').toLowerCase() ||
          d.code.toLowerCase() === (row.department_name || '').toLowerCase()
      );
      if (!deptExists) {
        errors.push({ row: rowNum, field: 'department', reason: `Unknown department '${row.department_name || row.department_id}'.` });
        hasError = true;
      }
    }

    if (!row.basic_salary || isNaN(Number(row.basic_salary)) || Number(row.basic_salary) <= 0) {
      errors.push({ row: rowNum, field: 'basic_salary', reason: 'Basic salary must be a positive number > 0.' });
      hasError = true;
    }

    if (row.joining_date && isNaN(Date.parse(row.joining_date))) {
      errors.push({ row: rowNum, field: 'joining_date', reason: 'Joining date must be a valid ISO date (YYYY-MM-DD).' });
      hasError = true;
    }

    if (!hasError) {
      seenCodes.add(row.code.toUpperCase());
      seenEmails.add(row.email.toLowerCase());
      validRows.push(row);
    }
  });

  res.json({
    total_rows: rows.length,
    valid_count: validRows.length,
    error_count: errors.length,
    errors,
  });
});

app.post('/api/employees/csv-import/commit', authenticate, requireRole(['hr', 'admin']), async (req: AuthRequest, res: Response) => {
  const { rows } = req.body;
  if (!Array.isArray(rows) || rows.length === 0) return res.status(400).json({ error: 'No rows to commit.' });

  const data = db.getData();
  const created: Employee[] = [];

  for (const row of rows) {
    let deptId = row.department_id;
    if (!deptId && row.department_name) {
      const match = data.departments.find(
        (d) =>
          d.name.toLowerCase() === row.department_name.toLowerCase() ||
          d.code.toLowerCase() === row.department_name.toLowerCase()
      );
      deptId = match ? match.id : data.departments[0]?.id || 'dept-eng';
    }

    const empId = `emp-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const newEmp: Employee = {
      id: empId,
      code: row.code.toUpperCase().trim(),
      first_name: row.first_name || 'Employee',
      last_name: row.last_name || '',
      email: row.email.toLowerCase().trim(),
      phone: row.phone || '',
      address: row.address || '',
      department_id: deptId,
      designation_id: row.designation_id || '',
      joining_date: row.joining_date || officeToday(),
      status: 'active',
      gender: row.gender || 'male',
      basic_salary: Number(row.basic_salary),
      face_enrolled: false,
      face_descriptor: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    data.employees.push(newEmp);

    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash('Welcome@123', salt);
    data.users.push({
      id: `usr-${empId}`,
      email: newEmp.email,
      password_hash: hash,
      role: 'employee',
      status: 'active',
      must_change_password: true,
      employee_id: empId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    created.push(newEmp);
  }

  createAuditLog({
    actor_id: req.user!.id,
    actor_email: req.user!.email,
    actor_role: req.user!.role,
    action: 'employees.csv_import',
    entity: 'employee',
    entity_id: 'batch',
    after_json: { imported_count: created.length },
    ip: req.ip,
  });

  db.save();
  res.status(201).json({ message: `Successfully imported ${created.length} employees.`, count: created.length });
});

// ----------------------------------------------------
// 09 & 10. ATTENDANCE (Web & Face Camera Attendance)
// ----------------------------------------------------
app.post('/api/attendance/check-in', authenticate, (req: AuthRequest, res: Response) => {
  const user = req.user!;
  const source = req.body.source === 'camera' ? 'camera' : 'web';
  // Camera attendance is ALWAYS for the authenticated employee; a client-supplied employee_id is ignored.
  const targetEmployeeId = source === 'camera' ? user.employee_id : (req.body.employee_id || user.employee_id);

  if (!targetEmployeeId) {
    return res.status(400).json({ error: 'No employee profile linked to user.' });
  }

  if (user.role === 'employee' && user.employee_id !== targetEmployeeId) {
    return res.status(403).json({ error: 'Cannot check in for another employee.' });
  }

  if (source === 'camera' && process.env.FACE_REQUIRE_NONCE !== 'false' && !consumeChallenge(req.body.nonce, targetEmployeeId)) {
    return res.status(422).json({ error: 'Attendance session expired or invalid. Reopen the camera and try again.' });
  }

  const result = processCheckIn({
    employee_id: targetEmployeeId,
    source,
    lat: req.body.lat !== undefined ? Number(req.body.lat) : undefined,
    lng: req.body.lng !== undefined ? Number(req.body.lng) : undefined,
    accuracy: req.body.accuracy !== undefined ? Number(req.body.accuracy) : undefined,
    face_count: req.body.face_count !== undefined ? Number(req.body.face_count) : undefined,
    face_descriptor: req.body.face_descriptor,
    liveness_passed: req.body.liveness_passed === true,
  });

  if (!result.success) {
    return res.status(result.status_code || 400).json({ error: result.error });
  }

  createAuditLog({
    actor_id: user.id,
    actor_email: user.email,
    actor_role: user.role,
    action: 'attendance.check_in',
    entity: 'attendance',
    entity_id: result.attendance!.id,
    after_json: { status: result.attendance!.status, source: result.attendance!.source },
    ip: req.ip,
  });

  res.status(201).json(result.attendance);
});

app.post('/api/attendance/check-out', authenticate, (req: AuthRequest, res: Response) => {
  const user = req.user!;
  const targetEmployeeId = req.body.employee_id || user.employee_id;

  if (!targetEmployeeId) {
    return res.status(400).json({ error: 'No employee profile linked.' });
  }

  if (user.role === 'employee' && user.employee_id !== targetEmployeeId) {
    return res.status(403).json({ error: 'Cannot check out for another employee.' });
  }

  const result = processCheckOut({ employee_id: targetEmployeeId });
  if (!result.success) {
    return res.status(result.status_code || 400).json({ error: result.error });
  }

  createAuditLog({
    actor_id: user.id,
    actor_email: user.email,
    actor_role: user.role,
    action: 'attendance.check_out',
    entity: 'attendance',
    entity_id: result.attendance!.id,
    after_json: { total_hours: result.attendance!.total_hours, status: result.attendance!.status },
    ip: req.ip,
  });

  res.json(result.attendance);
});

app.get('/api/attendance', authenticate, (req: AuthRequest, res: Response) => {
  const user = req.user!;
  const data = db.getData();
  const { date, employee_id } = req.query;

  let records = [...data.attendance];

  if (user.role === 'employee') {
    records = records.filter((a) => a.employee_id === user.employee_id);
  } else {
    if (employee_id) records = records.filter((a) => a.employee_id === employee_id);
  }

  if (date) {
    records = records.filter((a) => a.date === date);
  }

  // Enrich with employee names for daily attendance board
  const enriched = records.map((a) => {
    const emp = data.employees.find((e) => e.id === a.employee_id);
    const dept = data.departments.find((d) => d.id === emp?.department_id);
    return {
      ...a,
      employee_name: emp ? `${emp.first_name} ${emp.last_name}` : 'Unknown',
      employee_code: emp?.code || '',
      department_name: dept?.name || '',
    };
  });

  res.json(enriched);
});

// ----------------------------------------------------
// 11. ATTENDANCE CORRECTIONS (Employee Request, HR Approve)
// ----------------------------------------------------
app.get('/api/attendance/corrections', authenticate, (req: AuthRequest, res: Response) => {
  const user = req.user!;
  const data = db.getData();
  let list = [...data.attendance_corrections];

  if (user.role === 'employee') {
    list = list.filter((c) => c.employee_id === user.employee_id);
  }

  const enriched = list.map((c) => {
    const emp = data.employees.find((e) => e.id === c.employee_id);
    return {
      ...c,
      employee_name: emp ? `${emp.first_name} ${emp.last_name}` : 'Unknown',
      employee_code: emp?.code || '',
    };
  });

  res.json(enriched);
});

app.post('/api/attendance/corrections', authenticate, (req: AuthRequest, res: Response) => {
  const user = req.user!;
  if (!user.employee_id) return res.status(400).json({ error: 'User has no employee profile.' });

  const { date, requested_check_in, requested_check_out, reason } = req.body;
  if (!date || !requested_check_in || !reason) {
    return res.status(400).json({ error: 'Date, requested check-in, and reason are required.' });
  }

  const data = db.getData();
  const existingAtt = data.attendance.find((a) => a.employee_id === user.employee_id && a.date === date);

  const correction: AttendanceCorrection = {
    id: `cor-${crypto.randomUUID()}`,
    employee_id: user.employee_id,
    attendance_id: existingAtt ? existingAtt.id : null,
    date,
    requested_check_in,
    requested_check_out: requested_check_out || '',
    reason,
    status: 'pending',
    reviewed_by: null,
    review_comment: null,
    created_at: new Date().toISOString(),
  };

  data.attendance_corrections.push(correction);
  db.save();
  res.status(201).json(correction);
});

app.patch('/api/attendance/corrections/:id', authenticate, requireRole(['hr', 'admin']), (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { status, review_comment } = req.body; // 'approved' | 'rejected'

  const data = db.getData();
  const correction = data.attendance_corrections.find((c) => c.id === id);
  if (!correction) return res.status(404).json({ error: 'Correction request not found.' });

  correction.status = status;
  correction.reviewed_by = req.user!.id;
  correction.review_comment = review_comment || '';

  // If approved, update or insert actual attendance record
  if (status === 'approved') {
    let att = data.attendance.find((a) => a.employee_id === correction.employee_id && a.date === correction.date);
    if (!att) {
      att = {
        id: `att-cor-${crypto.randomUUID()}`,
        employee_id: correction.employee_id,
        date: correction.date,
        check_in: correction.requested_check_in,
        check_out: correction.requested_check_out || null,
        source: 'web',
        status: 'present',
        total_hours: 8,
        lat: null,
        lng: null,
        accuracy: null,
        distance_meters: null,
        created_at: new Date().toISOString(),
      };
      data.attendance.push(att);
    } else {
      att.check_in = correction.requested_check_in;
      if (correction.requested_check_out) att.check_out = correction.requested_check_out;
      att.status = 'present';
    }
  }

  createAuditLog({
    actor_id: req.user!.id,
    actor_email: req.user!.email,
    actor_role: req.user!.role,
    action: `attendance.correction_${status}`,
    entity: 'attendance_correction',
    entity_id: correction.id,
    after_json: { status, review_comment },
    ip: req.ip,
  });

  db.save();
  res.json(correction);
});

// ----------------------------------------------------
// 12 & 13. LEAVE REQUESTS & APPROVALS (HR Approve, Employee Apply)
// ----------------------------------------------------
app.get('/api/leaves/balance', authenticate, (req: AuthRequest, res: Response) => {
  const user = req.user!;
  const targetEmpId = (req.query.employee_id as string) || user.employee_id;
  if (!targetEmpId) return res.status(400).json({ error: 'No employee ID provided.' });

  if (user.role === 'employee' && user.employee_id !== targetEmpId) {
    return res.status(403).json({ error: 'Cannot view other employees leave balance.' });
  }

  const balance = getLeaveBalance(targetEmpId);
  res.json(balance);
});

app.get('/api/leaves', authenticate, (req: AuthRequest, res: Response) => {
  const user = req.user!;
  const data = db.getData();
  let list = [...data.leave_requests];

  if (user.role === 'employee') {
    list = list.filter((l) => l.employee_id === user.employee_id);
  }

  const enriched = list.map((l) => {
    const emp = data.employees.find((e) => e.id === l.employee_id);
    const dept = data.departments.find((d) => d.id === emp?.department_id);
    return {
      ...l,
      employee_name: emp ? `${emp.first_name} ${emp.last_name}` : 'Unknown',
      employee_code: emp?.code || '',
      department_name: dept?.name || '',
    };
  });

  res.json(enriched);
});

app.post('/api/leaves', authenticate, (req: AuthRequest, res: Response) => {
  const user = req.user!;
  const targetEmpId = req.body.employee_id || user.employee_id;
  if (!targetEmpId) return res.status(400).json({ error: 'No employee ID provided.' });

  if (user.role === 'employee' && user.employee_id !== targetEmpId) {
    return res.status(403).json({ error: 'Cannot apply leave on behalf of other employees.' });
  }

  const { leave_type, start_date, end_date, reason } = req.body;
  const result = applyForLeave({
    employee_id: targetEmpId,
    leave_type,
    start_date,
    end_date,
    reason: reason || 'Personal Leave',
  });

  if (!result.success) {
    return res.status(result.status_code || 422).json({ error: result.error });
  }

  createAuditLog({
    actor_id: user.id,
    actor_email: user.email,
    actor_role: user.role,
    action: 'leave.apply',
    entity: 'leave_request',
    entity_id: result.leave!.id,
    after_json: result.leave,
    ip: req.ip,
  });

  res.status(201).json(result.leave);
});

app.patch('/api/leaves/:id/cancel', authenticate, (req: AuthRequest, res: Response) => {
  const user = req.user!;
  const { id } = req.params;
  const data = db.getData();

  const leave = data.leave_requests.find((l) => l.id === id);
  if (!leave) return res.status(404).json({ error: 'Leave request not found.' });

  if (user.role === 'employee' && leave.employee_id !== user.employee_id) {
    return res.status(403).json({ error: 'Cannot cancel another employee’s leave.' });
  }

  leave.status = 'cancelled';
  db.save();
  res.json({ message: 'Leave request cancelled.', leave });
});

app.patch('/api/leaves/:id/decision', authenticate, requireRole(['hr', 'admin']), (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { status, review_comment } = req.body; // 'approved' | 'rejected'

  if (status !== 'approved' && status !== 'rejected') {
    return res.status(400).json({ error: 'Invalid decision status.' });
  }

  const data = db.getData();
  const leave = data.leave_requests.find((l) => l.id === id);
  if (!leave) return res.status(404).json({ error: 'Leave request not found.' });
  if (leave.status !== 'pending') return res.status(409).json({ error: `Leave request is already ${leave.status}.` });

  leave.status = status;
  leave.reviewed_by = req.user!.id;
  leave.review_comment = review_comment || '';

  // Notify employee
  const targetUser = data.users.find((u) => u.employee_id === leave.employee_id);
  if (targetUser) {
    data.notifications.unshift({
      id: `notif-${crypto.randomUUID()}`,
      user_id: targetUser.id,
      title: `Leave Request ${status.toUpperCase()}`,
      message: `Your ${leave.leave_type} leave from ${leave.start_date} to ${leave.end_date} has been ${status}. ${review_comment ? `Note: ${review_comment}` : ''}`,
      read: false,
      link: '/employee/leaves',
      created_at: new Date().toISOString(),
    });
  }

  createAuditLog({
    actor_id: req.user!.id,
    actor_email: req.user!.email,
    actor_role: req.user!.role,
    action: `leave.${status}`,
    entity: 'leave_request',
    entity_id: leave.id,
    after_json: { status, review_comment },
    ip: req.ip,
  });

  db.save();
  res.json(leave);
});

// ----------------------------------------------------
// 14, 15, 16, 17. PAYROLL LITE & PAYSLIPS
// ----------------------------------------------------
app.get('/api/payroll/runs', authenticate, requireRole(['admin', 'hr']), (req: AuthRequest, res: Response) => {
  res.json(db.getData().payroll_runs);
});

app.post('/api/payroll/draft', authenticate, requireRole(['hr', 'admin']), (req: AuthRequest, res: Response) => {
  const { month } = req.body; // e.g. "2026-10"
  if (!month) return res.status(400).json({ error: 'Month (YYYY-MM) is required.' });

  try {
    const run = generatePayrollDraft(month, req.user!.id);
    createAuditLog({
      actor_id: req.user!.id,
      actor_email: req.user!.email,
      actor_role: req.user!.role,
      action: 'payroll.draft_generated',
      entity: 'payroll_run',
      entity_id: run.id,
      after_json: { month: run.month, total_gross: run.total_gross },
      ip: req.ip,
    });
    res.status(201).json(run);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/payroll/finalize', authenticate, requireRole(['admin']), (req: AuthRequest, res: Response) => {
  const { month } = req.body;
  if (!month) return res.status(400).json({ error: 'Month (YYYY-MM) is required.' });

  try {
    const run = finalizePayroll(month, req.user!.id);
    createAuditLog({
      actor_id: req.user!.id,
      actor_email: req.user!.email,
      actor_role: req.user!.role,
      action: 'payroll.finalized',
      entity: 'payroll_run',
      entity_id: run.id,
      after_json: { month: run.month, total_net: run.total_net },
      ip: req.ip,
    });
    res.json({ message: `Payroll for ${month} finalized and locked.`, run });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/payroll/payslips', authenticate, (req: AuthRequest, res: Response) => {
  const user = req.user!;
  const data = db.getData();
  const { month, employee_id } = req.query;

  let slips = [...data.payslips];

  if (user.role === 'employee') {
    slips = slips.filter((p) => p.employee_id === user.employee_id);
  } else {
    if (employee_id) slips = slips.filter((p) => p.employee_id === employee_id);
  }

  if (month) {
    slips = slips.filter((p) => p.month === month);
  }

  const enriched = slips.map((p) => {
    const emp = data.employees.find((e) => e.id === p.employee_id);
    const dept = data.departments.find((d) => d.id === emp?.department_id);
    const des = data.designations.find((d) => d.id === emp?.designation_id);
    return {
      ...p,
      employee_name: emp ? `${emp.first_name} ${emp.last_name}` : 'Unknown',
      employee_code: emp?.code || '',
      department_name: dept?.name || '',
      designation_title: des?.title || '',
    };
  });

  res.json(enriched);
});

// ----------------------------------------------------
// 18. DASHBOARDS & ANALYTICS
// ----------------------------------------------------
app.get('/api/analytics/admin', authenticate, requireRole(['admin']), (req: AuthRequest, res: Response) => {
  const metrics = getAdminDashboardMetrics();
  res.json(metrics);
});

app.get('/api/analytics/hr', authenticate, requireRole(['hr', 'admin']), (req: AuthRequest, res: Response) => {
  const metrics = getHRDashboardMetrics();
  res.json(metrics);
});

app.get('/api/analytics/employee', authenticate, (req: AuthRequest, res: Response) => {
  const user = req.user!;
  if (!user.employee_id) return res.status(400).json({ error: 'No employee profile linked.' });
  const metrics = getEmployeeDashboardMetrics(user.employee_id);
  res.json(metrics);
});

// ----------------------------------------------------
// 19, 20, 21, 22. AI ASSISTANT (Chat with Tools, Summaries, Smart Leave)
// ----------------------------------------------------
app.post('/api/ai/chat', authenticate, async (req: AuthRequest, res: Response) => {
  const { prompt } = req.body;
  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ error: 'Prompt is required.' });
  }

  try {
    const response = await handleAIChat(req.user!, prompt);
    res.json({ response, is_ai_generated: !response.startsWith('[Rule-based') });
  } catch (err: any) {
    res.status(500).json({ error: 'AI Assistant temporarily unavailable.', fallback: true });
  }
});

app.post('/api/ai/dashboard-summary', authenticate, requireRole(['admin', 'hr']), async (req: AuthRequest, res: Response) => {
  const { kpis } = req.body;
  try {
    const bullets = await generateDashboardSummary(req.user!, kpis || {});
    res.json({ bullets, is_ai_generated: true });
  } catch (err) {
    res.status(500).json({ error: 'Could not generate summary.' });
  }
});

app.post('/api/ai/smart-leave', authenticate, async (req: AuthRequest, res: Response) => {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: 'Leave description prompt required.' });

  try {
    const result = await parseSmartLeave(req.user!, prompt);
    res.json({ parsed: result, is_ai_generated: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to parse leave statement.' });
  }
});

// ----------------------------------------------------
// 23. ANNOUNCEMENTS (Admin/HR Post, All Read)
// ----------------------------------------------------
app.get('/api/announcements', authenticate, (req: AuthRequest, res: Response) => {
  res.json(db.getData().announcements);
});

app.post('/api/announcements', authenticate, requireRole(['admin', 'hr']), (req: AuthRequest, res: Response) => {
  const { title, content, priority } = req.body;
  if (!title || !content) return res.status(400).json({ error: 'Title and content required.' });

  const data = db.getData();
  const ann = {
    id: `ann-${crypto.randomUUID()}`,
    title,
    content,
    created_by: req.user!.id,
    created_by_name: req.user!.role === 'admin' ? 'Admin' : 'HR Team',
    priority: priority === 'urgent' ? ('urgent' as const) : ('normal' as const),
    created_at: new Date().toISOString(),
  };

  data.announcements.unshift(ann);
  createAuditLog({
    actor_id: req.user!.id,
    actor_email: req.user!.email,
    actor_role: req.user!.role,
    action: 'announcement.post',
    entity: 'announcement',
    entity_id: ann.id,
    after_json: { title, priority: ann.priority },
    ip: req.ip,
  });

  db.save();
  res.status(201).json(ann);
});

// ----------------------------------------------------
// 24. IN-APP NOTIFICATIONS (Own: Admin, HR, Employee)
// ----------------------------------------------------
app.get('/api/notifications', authenticate, (req: AuthRequest, res: Response) => {
  const data = db.getData();
  const userNotifs = data.notifications.filter((n) => n.user_id === req.user!.id);
  res.json(userNotifs);
});

app.patch('/api/notifications/:id/read', authenticate, (req: AuthRequest, res: Response) => {
  const data = db.getData();
  const notif = data.notifications.find((n) => n.id === req.params.id && n.user_id === req.user!.id);
  if (notif) {
    notif.read = true;
    db.save();
  }
  res.json({ success: true });
});

// ----------------------------------------------------
// 25. AUDIT LOG (Admin Only View)
// ----------------------------------------------------
app.get('/api/audit-logs', authenticate, requireRole(['admin']), (req: AuthRequest, res: Response) => {
  res.json([...db.getData().audit_logs].reverse());
});
app.get('/api/audit-logs/verify', authenticate, requireRole(['admin']), (req: AuthRequest, res: Response) => {
  res.json(verifyAuditChain());
});
// Audit log is append-only: explicitly reject any attempt to alter it.
app.all('/api/audit-logs/:id', authenticate, (req: AuthRequest, res: Response) => {
  res.status(405).json({ error: 'Audit log entries are immutable.' });
});

// ----------------------------------------------------
// SERVER START & VITE MIDDLEWARES
// ----------------------------------------------------
async function startServer() {
  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const fs = await import('fs');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);

    // Fallback for SPA routing in development
    app.use('*', async (req: Request, res: Response, next) => {
      if (req.originalUrl.startsWith('/api')) {
        return next();
      }
      try {
        const templatePath = path.resolve(__dirname, 'index.html');
        let template = fs.readFileSync(templatePath, 'utf-8');
        template = await vite.transformIndexHtml(req.originalUrl, template);
        res.status(200).set({ 'Content-Type': 'text/html' }).end(template);
      } catch (e) {
        next(e);
      }
    });
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (req: Request, res: Response) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  const migrated = migrateLegacyFaceData();
  if (migrated) console.log(`[face] invalidated ${migrated} legacy fake face enrollment(s); those employees must enroll again.`);
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`HCM Lite server running on port ${PORT} [production=${isProduction}]`);
  });
}

startServer();
