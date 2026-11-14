/**
 * End-to-end workflow tests over real HTTP against a real server process (fresh SQLite DB per suite).
 * Run: npm test   (needs `npm install` first; spawns `tsx server.ts` in production mode, AI key unset)
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type Srv = { base: string; proc: ChildProcess; dir: string };
async function startServer(port: number): Promise<Srv> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hcm-e2e-'));
  // Spawn node directly (not via npx) so proc.kill() really stops the server and ports are freed.
  const proc = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
    cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
    env: { ...process.env, NODE_ENV: 'production', PORT: String(port), DATA_DIR: dir, AI_API_KEY: '', GEMINI_API_KEY: '', JWT_SECRET: '', OFFICE_TZ: 'Asia/Karachi' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(base + '/api/system/status')).ok) return { base, proc, dir }; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  proc.kill();
  throw new Error('server did not start');
}

let S: Srv;
async function api(method: string, p: string, token?: string | null, body?: any, srv: Srv = S) {
  const res = await fetch(srv.base + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json: any = null;
  try { json = await res.json(); } catch { /* non-json */ }
  return { status: res.status, body: json };
}
const login = (email: string, password: string) => api('POST', '/api/auth/login', null, { email, password });

const ADMIN = { email: 'ceo@acme-test.io', password: 'S3cure-Admin-Pass1' };
const HR = { email: 'hr@acme-test.io' };
const ctx: any = {};

function firstWeekdayPair(year: number): [string, string] {
  const d = new Date(Date.UTC(year, 0, 1));
  while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCDate(d.getUTCDate() + 7);
  const mon = d.toISOString().slice(0, 10);
  d.setUTCDate(d.getUTCDate() + 1);
  return [mon, d.toISOString().slice(0, 10)];
}

before(async () => { S = await startServer(4310); });
after(() => { S?.proc.kill(); });

test('TEST 1: fresh DB -> first-run setup -> Admin created -> Admin login; setup is then locked', async () => {
  const st = await api('GET', '/api/system/status');
  assert.equal(st.body.is_configured, false);
  assert.equal(st.body.total_users, 0);
  const setup = {
    company_name: 'Acme Test Ltd', company_email: 'info@acme-test.io', office_address: '1 Test Road, Karachi',
    office_start: '09:00', grace_minutes: 15, weekend_days: [0, 6], office_lat: 24.8607, office_lng: 67.0011, office_radius_meters: 150,
    admin_name: 'Test Admin', admin_email: ADMIN.email, admin_password: ADMIN.password,
  };
  assert.equal((await api('POST', '/api/system/setup', null, { ...setup, admin_password: 'short' })).status, 400, 'weak password');
  assert.equal((await api('POST', '/api/system/setup', null, { ...setup, office_lat: 999 })).status, 400, 'bad latitude');
  // simultaneous requests: exactly one wins
  const [a, b] = await Promise.all([api('POST', '/api/system/setup', null, setup), api('POST', '/api/system/setup', null, setup)]);
  assert.ok([a.status, b.status].includes(201));
  assert.ok(!(a.status === 201 && b.status === 201), 'never two admins');
  assert.ok([a.status, b.status].every((x) => [201, 403, 409].includes(x)));
  assert.equal((await api('POST', '/api/system/setup', null, setup)).status, 403, 'setup locked');
  const l = await login(ADMIN.email, ADMIN.password);
  assert.equal(l.status, 200); assert.equal(l.body.user.role, 'admin');
  ctx.admin = l.body.token;
  assert.equal((await api('PUT', '/api/settings', ctx.admin, { require_face_attendance: false })).status, 200, 'legacy web check-in for the basic workflow tests');
  assert.equal((await login(ADMIN.email, 'wrong-password1')).status, 401, 'invalid password');
  const users = await api('GET', '/api/users', ctx.admin);
  assert.equal(users.body.length, 1);
});

test('TEST 2: Admin creates HR account -> HR login (forced password change) -> HR works afterwards', async () => {
  const dep = await api('POST', '/api/organization/departments', ctx.admin, { name: 'Engineering', code: 'ENG' });
  assert.equal(dep.status, 201); ctx.dept = dep.body.id;
  const des = await api('POST', '/api/organization/designations', ctx.admin, { title: 'Engineer', department_id: ctx.dept });
  assert.equal(des.status, 201); ctx.des = des.body.id;
  const r = await api('POST', '/api/users/hr', ctx.admin, { email: HR.email });
  assert.equal(r.status, 201); assert.ok(r.body.temporary_password.length >= 12);
  assert.equal((await api('POST', '/api/users/hr', ctx.admin, { email: HR.email })).status, 409, 'duplicate email');
  const l = await login(HR.email, r.body.temporary_password);
  assert.equal(l.status, 200); assert.equal(l.body.user.role, 'hr'); assert.equal(l.body.user.must_change_password, true);
  const blocked = await api('GET', '/api/employees', l.body.token);
  assert.equal(blocked.status, 403); assert.equal(blocked.body.code, 'PASSWORD_CHANGE_REQUIRED');
  assert.equal((await api('POST', '/api/auth/change-password', l.body.token, { new_password: 'HrNewPass-2026' })).status, 200);
  const l2 = await login(HR.email, 'HrNewPass-2026');
  assert.equal(l2.status, 200); assert.equal(l2.body.user.must_change_password, false);
  ctx.hr = l2.body.token;
  assert.equal((await api('GET', '/api/employees', ctx.hr)).status, 200);
});

test('TEST 3: HR registers employees -> login auto-created with unique code + temp password; validation', async () => {
  const mk = (n: string, email: string, salary = 100000) => api('POST', '/api/employees', ctx.hr, {
    code: n, first_name: n, last_name: 'Tester', email, department_id: ctx.dept, designation_id: ctx.des, basic_salary: salary, joining_date: '2025-01-01',
  });
  const a = await mk('EMPA', 'a@acme-test.io');
  const b = await mk('EMPB', 'b@acme-test.io', 200000);
  assert.equal(a.status, 201); assert.equal(b.status, 201);
  assert.ok(a.body.temporary_password && a.body.temporary_password !== b.body.temporary_password);
  ctx.empA = { id: a.body.employee.id, email: 'a@acme-test.io', temp: a.body.temporary_password };
  ctx.empB = { id: b.body.employee.id, email: 'b@acme-test.io', temp: b.body.temporary_password };
  assert.equal((await mk('EMPC', 'a@acme-test.io')).status, 409, 'duplicate email');
  assert.equal((await mk('EMPA', 'z@acme-test.io')).status, 409, 'duplicate code');
  assert.equal((await api('POST', '/api/employees', ctx.hr, { code: 'X' })).status, 400, 'missing fields');
  assert.equal((await mk('EMPD', 'not-an-email')).status, 422, 'invalid email');
  const users = await api('GET', '/api/users', ctx.admin);
  assert.equal(users.body.filter((u: any) => u.role === 'employee').length, 2, 'one login per employee, no orphans');
});

test('TEST 4: Employee first login -> mandatory password change -> logout -> login with new password', async () => {
  const l = await login(ctx.empA.email, ctx.empA.temp);
  assert.equal(l.body.user.must_change_password, true);
  const t = l.body.token;
  const blocked = await api('POST', '/api/attendance/check-in', t, {});
  assert.equal(blocked.status, 403); assert.equal(blocked.body.code, 'PASSWORD_CHANGE_REQUIRED');
  assert.equal((await api('POST', '/api/auth/change-password', t, { new_password: 'short1' })).status, 400, 'weak');
  assert.equal((await api('POST', '/api/auth/change-password', t, { new_password: ctx.empA.temp })).status, 400, 'same as temp');
  assert.equal((await api('POST', '/api/auth/change-password', t, { new_password: 'EmpA-NewPass-9' })).status, 200);
  assert.equal((await login(ctx.empA.email, ctx.empA.temp)).status, 401, 'old temp password dead');
  const l2 = await login(ctx.empA.email, 'EmpA-NewPass-9');
  assert.equal(l2.status, 200); assert.equal(l2.body.user.must_change_password, false);
  ctx.a = l2.body.token;
  const lb = await login(ctx.empB.email, ctx.empB.temp);
  assert.equal((await api('POST', '/api/auth/change-password', lb.body.token, { new_password: 'EmpB-NewPass-9' })).status, 200);
  ctx.b = (await login(ctx.empB.email, 'EmpB-NewPass-9')).body.token;
});

test('TEST 6 + 13: check-in -> check-out stored; duplicate check-in returns 409', async () => {
  const ci = await api('POST', '/api/attendance/check-in', ctx.a, {});
  assert.equal(ci.status, 201); assert.ok(['present', 'late'].includes(ci.body.status));
  assert.equal((await api('POST', '/api/attendance/check-in', ctx.a, {})).status, 409);
  const co = await api('POST', '/api/attendance/check-out', ctx.a, {});
  assert.equal(co.status, 200);
  const list = await api('GET', '/api/attendance', ctx.a);
  assert.equal(list.body.length, 1); assert.ok(list.body[0].check_out); assert.equal(list.body[0].employee_id, ctx.empA.id);
});

test('TEST 5: Employee A cannot access Employee B attendance, leave, salary, payslip, profile', async () => {
  await api('POST', '/api/attendance/check-in', ctx.b, {});
  const att = await api('GET', `/api/attendance?employee_id=${ctx.empB.id}`, ctx.a);
  assert.ok(att.body.every((r: any) => r.employee_id === ctx.empA.id), 'attendance scoped to self');
  assert.equal((await api('GET', `/api/employees/${ctx.empB.id}/360`, ctx.a)).status, 403);
  assert.equal((await api('GET', `/api/leaves/balance?employee_id=${ctx.empB.id}`, ctx.a)).status, 403);
  const list = await api('GET', '/api/employees', ctx.a);
  assert.equal(list.body.length, 1); assert.equal(list.body[0].id, ctx.empA.id);
  assert.equal((await api('PATCH', `/api/employees/${ctx.empB.id}`, ctx.a, { phone: '1' })).status, 403);
  assert.equal((await api('PATCH', `/api/employees/${ctx.empA.id}`, ctx.a, { basic_salary: 999999999 })).status, 200);
  const me = await api('GET', '/api/employees', ctx.a);
  assert.equal(me.body[0].basic_salary, 100000, 'employee cannot change own salary');
  assert.equal((await api('POST', '/api/attendance/check-in', ctx.a, { employee_id: ctx.empB.id })).status, 403);
  assert.equal((await api('POST', '/api/leaves', ctx.a, { employee_id: ctx.empB.id, leave_type: 'casual', start_date: '2026-01-05', end_date: '2026-01-05' })).status, 403);
  const slips = await api('GET', `/api/payroll/payslips?employee_id=${ctx.empB.id}`, ctx.a);
  assert.ok(slips.body.every((p: any) => p.employee_id === ctx.empA.id));
});

test('TEST 7: Employee applies leave -> HR approves -> balance updates, employee notified', async () => {
  const [mon, tue] = firstWeekdayPair(new Date().getFullYear());
  ctx.leaveDates = [mon, tue];
  const r = await api('POST', '/api/leaves', ctx.a, { leave_type: 'casual', start_date: mon, end_date: tue, reason: 'wedding' });
  assert.equal(r.status, 201); assert.equal(r.body.working_days, 2); assert.equal(r.body.status, 'pending');
  assert.equal((await api('PATCH', `/api/leaves/${r.body.id}/decision`, ctx.a, { status: 'approved' })).status, 403, 'employee cannot approve');
  const before = await api('GET', '/api/leaves/balance', ctx.a);
  assert.equal(before.body.casual.remaining, 10);
  const d = await api('PATCH', `/api/leaves/${r.body.id}/decision`, ctx.hr, { status: 'approved', review_comment: 'Enjoy' });
  assert.equal(d.status, 200);
  assert.equal((await api('PATCH', `/api/leaves/${r.body.id}/decision`, ctx.hr, { status: 'rejected' })).status, 409, 'already decided');
  const after = await api('GET', '/api/leaves/balance', ctx.a);
  assert.equal(after.body.casual.remaining, 8);
  const n = await api('GET', '/api/notifications', ctx.a);
  assert.ok(n.body.some((x: any) => /APPROVED/i.test(x.title)));
});

test('TEST 14: overlapping, over-balance, weekend-only and invalid leave -> 422', async () => {
  const [mon, tue] = ctx.leaveDates;
  assert.equal((await api('POST', '/api/leaves', ctx.a, { leave_type: 'casual', start_date: mon, end_date: tue, reason: 'x' })).status, 422, 'overlap');
  const y = new Date().getFullYear();
  assert.equal((await api('POST', '/api/leaves', ctx.a, { leave_type: 'casual', start_date: `${y}-03-02`, end_date: `${y}-03-27`, reason: 'x' })).status, 422, 'over balance');
  assert.equal((await api('POST', '/api/leaves', ctx.a, { leave_type: 'bogus', start_date: `${y}-03-02`, end_date: `${y}-03-03`, reason: 'x' })).status, 422, 'bad type');
});

test('TEST 8 + 15: HR payroll draft -> Admin finalizes -> finalized payroll cannot be modified', async () => {
  const month = new Date().toISOString().slice(0, 7);
  const draft = await api('POST', '/api/payroll/draft', ctx.hr, { month });
  assert.equal(draft.status, 201); assert.equal(draft.body.status, 'draft');
  assert.equal((await api('POST', '/api/payroll/finalize', ctx.hr, { month })).status, 403, 'HR cannot finalize');
  const slipsDraft = await api('GET', `/api/payroll/payslips?month=${month}`, ctx.hr);
  const a = slipsDraft.body.find((p: any) => p.employee_id === ctx.empA.id);
  assert.equal(a.gross_salary, 150000); assert.equal(a.hra, 40000); assert.equal(a.medical_allowance, 10000);
  const fin = await api('POST', '/api/payroll/finalize', ctx.admin, { month });
  assert.equal(fin.status, 200); assert.equal(fin.body.run.status, 'finalized');
  const snapshot = JSON.stringify((await api('GET', `/api/payroll/payslips?month=${month}`, ctx.admin)).body);
  assert.equal((await api('POST', '/api/payroll/draft', ctx.hr, { month })).status, 400, 'regenerate blocked');
  assert.equal((await api('POST', '/api/payroll/draft', ctx.admin, { month })).status, 400, 'admin regenerate blocked');
  assert.equal((await api('POST', '/api/payroll/finalize', ctx.admin, { month })).status, 400, 'double finalize blocked');
  assert.equal((await api('PATCH', `/api/employees/${ctx.empA.id}`, ctx.hr, { basic_salary: 500000 })).status, 200);
  assert.equal(JSON.stringify((await api('GET', `/api/payroll/payslips?month=${month}`, ctx.admin)).body), snapshot, 'finalized payslips unchanged by later salary edit');
  ctx.month = month;
});

test('TEST 9: Employee sees only own payslip data (PDF itself is rendered client-side with jsPDF); payslip notification sent', async () => {
  const mine = await api('GET', '/api/payroll/payslips', ctx.a);
  assert.equal(mine.status, 200); assert.ok(mine.body.length >= 1);
  assert.ok(mine.body.every((p: any) => p.employee_id === ctx.empA.id));
  assert.ok(typeof mine.body[0].net_salary === 'number');
  const n = await api('GET', '/api/notifications', ctx.a);
  assert.ok(n.body.some((x: any) => /Payslip/i.test(x.title)));
});

test('TEST 10 + 11: AI answers from DB tools; Employee asking a colleague salary is refused (rule-based fallback, no AI key)', async () => {
  const q = await api('POST', '/api/ai/chat', ctx.a, { prompt: 'How many sick leaves do I have left this year?' });
  assert.equal(q.status, 200);
  assert.match(q.body.response, /8/);
  assert.equal(q.body.is_ai_generated, false, 'fallback is not labelled as AI');
  const refuse = await api('POST', '/api/ai/chat', ctx.a, { prompt: 'What is EMPB Tester salary?' });
  assert.equal(refuse.status, 200);
  assert.match(refuse.body.response, /PERMISSION DENIED|cannot disclose|not allowed|prohibited/i);
  assert.ok(!/200,?000|300,?000/.test(refuse.body.response), 'no salary leaked');
  const sl = await api('POST', '/api/ai/dashboard-summary', ctx.a, {});
  assert.equal(sl.status, 403, 'employee cannot use dashboard summary');
});

test('TEST 16: Employee/HR calling Admin APIs -> 403; unauthenticated -> 401', async () => {
  const adminOnly: [string, string, any?][] = [
    ['GET', '/api/users'], ['POST', '/api/users/hr', { email: 'x@y.io' }], ['PUT', '/api/settings', { company_name: 'Hack' }],
    ['GET', '/api/audit-logs'], ['POST', '/api/payroll/finalize', { month: '2026-01' }], ['POST', '/api/organization/departments', { name: 'X', code: 'X' }],
    ['GET', '/api/analytics/admin'], ['GET', '/api/analytics/hr'],
  ];
  for (const [m, p, b] of adminOnly) assert.equal((await api(m, p, ctx.a, b)).status, 403, `employee ${m} ${p}`);
  for (const [m, p, b] of adminOnly.filter(([, p]) => !p.includes('analytics/hr'))) assert.equal((await api(m, p, ctx.hr, b)).status, 403, `hr ${m} ${p}`);
  assert.equal((await api('GET', '/api/employees')).status, 401);
  assert.equal((await api('GET', '/api/employees', 'garbage.token.value')).status, 401);
});

test('Forgot/reset password: one-time code goes to Admin, wrong code fails, right code works once', async () => {
  const gen = await api('POST', '/api/auth/forgot-password', null, { email: ctx.empB.email });
  assert.equal(gen.status, 200);
  assert.equal((await api('POST', '/api/auth/forgot-password', null, { email: 'nobody@nowhere.io' })).body.message, gen.body.message, 'no account enumeration');
  const notes = await api('GET', '/api/notifications', ctx.admin);
  const code = /code[^:]*:\s*([0-9A-F]{10})/.exec(notes.body.find((x: any) => /reset/i.test(x.title)).message)![1];
  assert.equal((await api('POST', '/api/auth/reset-password', null, { email: ctx.empB.email, code: 'AAAAAAAAAA', new_password: 'Reset-Pass-77' })).status, 400);
  assert.equal((await api('POST', '/api/auth/reset-password', null, { email: ctx.empB.email, code, new_password: 'weak' })).status, 400);
  assert.equal((await api('POST', '/api/auth/reset-password', null, { email: ctx.empB.email, code, new_password: 'Reset-Pass-77' })).status, 200);
  assert.equal((await api('POST', '/api/auth/reset-password', null, { email: ctx.empB.email, code, new_password: 'Reset-Pass-88' })).status, 400, 'single use');
  assert.equal((await login(ctx.empB.email, 'Reset-Pass-77')).status, 200);
});

test('CSV import dry-run reports row + field + reason for every invalid record', async () => {
  const rows = [
    { code: 'EMP100', first_name: 'Ok', last_name: 'Row', email: 'ok@acme-test.io', department_name: 'Engineering', basic_salary: 90000, joining_date: '2026-01-01' },
    { code: '', email: 'bad', department_name: 'Nowhere', basic_salary: 0, joining_date: 'not-a-date' },
    { code: 'EMPA', email: 'a@acme-test.io', department_name: 'Engineering', basic_salary: 5 },
  ];
  const r = await api('POST', '/api/employees/csv-import/dry-run', ctx.hr, { rows });
  assert.equal(r.status, 200); assert.equal(r.body.valid_count, 1);
  for (const e of r.body.errors) { assert.ok(Number.isInteger(e.row)); assert.ok(e.field); assert.ok(e.reason); }
  const fields = r.body.errors.filter((e: any) => e.row === 2).map((e: any) => e.field).sort();
  assert.deepEqual(fields, ['basic_salary', 'code', 'department', 'email', 'joining_date']);
  assert.equal((await api('POST', '/api/employees/csv-import/dry-run', ctx.a, { rows })).status, 403);
  assert.equal((await api('POST', '/api/employees/csv-import/dry-run', ctx.hr, {})).status, 400);
});

test('Audit log: Admin-only, records key actions, hash chain verifies, entries cannot be altered', async () => {
  assert.equal((await api('GET', '/api/audit-logs', ctx.hr)).status, 403);
  const logs = await api('GET', '/api/audit-logs', ctx.admin);
  const actions = logs.body.map((l: any) => l.action);
  for (const a of ['company.first_run_setup', 'user.create_hr', 'employee.register', 'leave.apply', 'payroll.finalized']) assert.ok(actions.includes(a), a);
  const l = logs.body[0];
  for (const k of ['actor_email', 'action', 'entity', 'created_at', 'hash']) assert.ok(l[k] !== undefined, k);
  assert.equal((await api('GET', '/api/audit-logs/verify', ctx.admin)).body.valid, true);
  for (const m of ['PATCH', 'PUT', 'DELETE']) assert.equal((await api(m, `/api/audit-logs/${l.id}`, ctx.admin, {})).status, 405);
});

test('Admin can deactivate a login; deactivated user cannot sign in', async () => {
  const users = await api('GET', '/api/users', ctx.admin);
  const target = users.body.find((u: any) => u.email === ctx.empB.email);
  assert.equal((await api('PATCH', `/api/users/${target.id}/status`, ctx.admin, { status: 'deactivated' })).status, 200);
  assert.equal((await login(ctx.empB.email, 'Reset-Pass-77')).status, 403);
});

test('TEST 12: fresh DB dashboards show zeros / empty lists, never fabricated data', async () => {
  const F = await startServer(4311);
  try {
    const setupRes = await api('POST', '/api/system/setup', null, {
      company_name: 'Empty Co', company_email: 'e@e.io', office_address: 'x', office_start: '09:00', grace_minutes: 15, weekend_days: [0, 6],
      office_lat: 1, office_lng: 1, office_radius_meters: 150, admin_name: 'A', admin_email: 'admin@empty.io', admin_password: 'Empty-Admin-1',
    }, F); // (method, path, token, body, server): the 2nd server F, not the default S
    assert.equal(setupRes.status, 201, 'setup on the fresh server');
    const t = (await api('POST', '/api/auth/login', null, { email: 'admin@empty.io', password: 'Empty-Admin-1' }, F)).body.token;
    assert.ok(t, 'admin token on the fresh server');
    for (const p of ['/api/employees', '/api/attendance', '/api/leaves', '/api/payroll/runs']) {
      const r = await api('GET', p, t, undefined, F);
      assert.deepEqual(r.body, [], p);
    }
    for (const p of ['/api/analytics/admin', '/api/analytics/hr']) {
      const r = await api('GET', p, t, undefined, F);
      assert.equal(r.status, 200);
      // The audit feed is REAL history (setup + logins carry seq numbers), not dashboard statistics: check it separately.
      const { auditFeed, ...stats } = r.body;
      if (auditFeed !== undefined) {
        assert.ok(auditFeed.every((a: any) => ['company.first_run_setup', 'auth.login'].includes(a.action)), `${p} audit feed has only real setup/login events`);
        assert.ok(auditFeed.length >= 1 && auditFeed[0].seq > (auditFeed[auditFeed.length - 1].seq ?? 0), 'newest first');
      }
      const nums: number[] = [];
      JSON.stringify(stats, (_k, v) => { if (typeof v === 'number') nums.push(v); return v; });
      assert.ok(nums.every((x) => x === 0), `${p} has non-zero numbers on an empty DB: ${nums.filter((x) => x !== 0)}`);
    }
    assert.equal((await api('GET', '/api/users', t, undefined, F)).body.length, 1, 'only the Admin created in setup');
  } finally { F.proc.kill(); }
});


function vec(seed: number, noise = 0, salt = 1): number[] {
  return Array.from({ length: 128 }, (_, i) => Math.sin(seed * 97.13 + i * 1.7) * 0.2 + noise * Math.sin(salt * 31.7 + i * 2.3));
}

test('FACE over HTTP (SYNTHETIC descriptors, no real camera): enroll, identity, liveness, GPS, geofence, replay, delete', async () => {
  assert.equal((await api('PUT', '/api/settings', ctx.admin, { require_face_attendance: true })).status, 200);
  const mk = await api('POST', '/api/employees', ctx.hr, { code: 'EMPF', first_name: 'Face', last_name: 'Tester', email: 'f@acme-test.io', department_id: ctx.dept, designation_id: ctx.des, basic_salary: 100000, joining_date: '2025-01-01' });
  assert.equal(mk.status, 201);
  const first = await login('f@acme-test.io', mk.body.temporary_password);
  assert.equal((await api('POST', '/api/auth/change-password', first.body.token, { new_password: 'Face-NewPass-9' })).status, 200);
  const t = (await login('f@acme-test.io', 'Face-NewPass-9')).body.token;
  const near = { lat: 24.8607, lng: 67.0011, accuracy: 20 };
  const samples = [vec(1, 0.01, 1), vec(1, 0.01, 2), vec(1, 0.01, 3)];
  const checkIn = async (over: any = {}) => {
    const ch = await api('POST', '/api/attendance/challenge', t);
    return api('POST', '/api/attendance/check-in', t, { source: 'camera', nonce: ch.body.nonce, face_count: 1, liveness_passed: true, face_descriptor: vec(1, 0.01, 9), ...near, ...over });
  };

  assert.equal((await checkIn()).status, 422, 'not enrolled');
  assert.equal((await api('POST', '/api/attendance/check-in', t, { source: 'web' })).status, 422, 'plain web check-in disabled');
  assert.equal((await api('POST', '/api/face/enroll', t, { descriptors: samples, liveness_passed: true })).status, 400, 'consent required');
  assert.equal((await api('POST', '/api/face/enroll', t, { consent: true, descriptors: samples, liveness_passed: false })).status, 422, 'liveness required');
  assert.equal((await api('POST', '/api/face/enroll', t, { consent: true, liveness_passed: true, descriptors: [vec(1), vec(2), vec(3)] })).status, 422, 'mixed people rejected');
  assert.equal((await api('POST', '/api/face/enroll', ctx.hr, { consent: true, liveness_passed: true, descriptors: samples })).status, 403, 'HR cannot enroll a face for someone else');
  assert.equal((await api('POST', '/api/face/enroll', t, { consent: true, liveness_passed: true, descriptors: samples })).status, 201);
  assert.equal((await api('GET', '/api/face/status', t)).body.enrolled, true);
  const dir = JSON.stringify((await api('GET', '/api/employees', ctx.hr)).body);
  assert.ok(!dir.includes('"face_descriptor":[') && !dir.includes('"enc"'), 'no biometric data in employee API');

  assert.equal((await checkIn({ face_descriptor: vec(2) })).status, 422, 'different person');
  assert.equal((await checkIn({ face_count: 2 })).status, 422, 'multiple faces');
  assert.equal((await checkIn({ face_count: 0 })).status, 422, 'no face');
  assert.equal((await checkIn({ liveness_passed: false })).status, 422, 'no liveness');
  assert.equal((await checkIn({ accuracy: 150 })).status, 422, 'GPS accuracy');
  assert.equal((await checkIn({ lat: 25.5, lng: 68 })).status, 422, 'outside geofence');
  assert.equal((await checkIn({ lat: undefined, lng: undefined, accuracy: undefined })).status, 422, 'no GPS never auto-approved');
  assert.equal((await api('POST', '/api/attendance/check-in', t, { source: 'camera', face_count: 1, liveness_passed: true, face_descriptor: vec(1, 0.01, 9), ...near })).status, 422, 'missing server challenge');
  const ch = await api('POST', '/api/attendance/challenge', t);
  const body = { source: 'camera', nonce: ch.body.nonce, face_count: 1, liveness_passed: true, ...near };
  assert.equal((await api('POST', '/api/attendance/check-in', t, { ...body, face_descriptor: vec(2) })).status, 422);
  assert.equal((await api('POST', '/api/attendance/check-in', t, { ...body, face_descriptor: vec(1, 0.01, 9) })).status, 422, 'nonce is single-use (replay)');
  assert.equal((await api('GET', '/api/attendance', t)).body.length, 0, 'failed attempts create no attendance');

  const ok = await checkIn();
  assert.equal(ok.status, 201); assert.equal(ok.body.source, 'camera');
  assert.equal((await checkIn()).status, 409, 'duplicate');
  const recs = (await api('GET', '/api/attendance', t)).body;
  assert.equal(recs.length, 1); assert.ok(!JSON.stringify(recs).includes('descriptor'));
  assert.equal((await api('POST', '/api/attendance/check-out', t, {})).status, 200);

  assert.equal((await api('DELETE', `/api/face/${mk.body.employee.id}`, ctx.hr)).status, 200);
  assert.equal((await api('GET', '/api/face/status', t)).body.enrolled, false);
  assert.equal((await api('PUT', '/api/settings', ctx.admin, { require_face_attendance: false })).status, 200);
});
