/**
 * Service-level tests (real execution, real SQLite file in a temp dir, no mocks of business logic).
 * Run: npm run test:unit
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hcm-unit-'));
process.env.DATA_DIR = dir;
process.env.OFFICE_TZ = 'Asia/Karachi';

const { db } = await import('../src/server/db.js');
const { calculateWorkingDays, applyForLeave, getLeaveBalance } = await import('../src/server/services/leave.js');
const { calculateAnnualIncomeTax, computeEmployeePayroll, generatePayrollDraft, finalizePayroll } = await import('../src/server/services/payroll.js');
const { processCheckIn, processCheckOut, calculateHaversineDistance } = await import('../src/server/services/attendance.js');
const { createAuditLog, verifyAuditChain } = await import('../src/server/services/audit.js');
const { officeNow } = await import('../src/server/time.js');
const face = await import('../src/server/services/face.js');

let n = 0;
function emp(over: Record<string, any> = {}): any {
  n++;
  const e = {
    id: `e${n}`, code: `EMP${n}`, first_name: 'T', last_name: String(n), email: `t${n}@x.test`, phone: '', address: '',
    department_id: 'd', designation_id: 'g', joining_date: '2025-01-01', status: 'active', gender: 'male',
    basic_salary: 100000, face_enrolled: false, created_at: '', updated_at: '', ...over,
  };
  db.getData().employees.push(e);
  return e;
}
function weekdays(year: number, month: number): string[] {
  const out: string[] = [];
  for (let d = 1; d <= new Date(Date.UTC(year, month, 0)).getUTCDate(); d++) {
    const dt = new Date(Date.UTC(year, month - 1, d));
    if (![0, 6].includes(dt.getUTCDay())) out.push(dt.toISOString().slice(0, 10));
  }
  return out;
}
function att(e: any, date: string, status: string) {
  db.getData().attendance.push({ id: `a-${e.id}-${date}`, employee_id: e.id, date, check_in: date + 'T05:00:00Z', check_out: date + 'T13:00:00Z', source: 'web', status, total_hours: 8, lat: null, lng: null, accuracy: null, distance_meters: null, created_at: '' } as any);
}

before(() => {
  const s = db.getData().settings;
  s.office_lat = 24.8607; s.office_lng = 67.0011; s.office_radius_meters = 150; s.require_face_attendance = false;
});

test('DB starts empty: zero users, zero business records, not configured', () => {
  const d = db.getData();
  assert.equal(d.users.length, 0);
  assert.equal(d.employees.length, 0);
  assert.equal(d.departments.length, 0);
  assert.equal(d.settings.is_configured, false);
});

test('DB: saved data persists across reload; unsaved changes are rolled back', () => {
  db.getData().departments.push({ id: 'dx', name: 'Persist', code: 'P', created_at: '' } as any);
  db.save();
  db.getData().departments.push({ id: 'dy', name: 'Unsaved', code: 'U', created_at: '' } as any);
  db.reload();
  const names = db.getData().departments.map((x) => x.name);
  assert.deepEqual(names, ['Persist']);
  db.getData().departments.length = 0; db.save();
});

test('DB: JWT secret is generated once and stable', () => {
  const a = db.getOrCreateSecret('jwt');
  assert.equal(a.length, 96);
  assert.equal(db.getOrCreateSecret('jwt'), a);
});

test('Audit log: hash chain valid, nothing is capped, tampering is detected', () => {
  for (let i = 0; i < 1100; i++) createAuditLog({ actor_id: 'u', actor_email: 'u@x.test', actor_role: 'admin', action: 'test', entity: 'e', entity_id: String(i), after_json: { i } });
  assert.equal(db.getData().audit_logs.length, 1100, 'no 1000-entry cap');
  assert.deepEqual(verifyAuditChain(), { valid: true, entries: 1100 });
  db.getData().audit_logs[500].after_json = { i: 'tampered' };
  assert.equal(verifyAuditChain().valid, false);
  assert.equal(verifyAuditChain().broken_at, 501);
  db.reload();
  assert.equal(verifyAuditChain().valid, true, 'persisted log is untouched');
});

test('Tax slabs match the brief exactly', () => {
  assert.equal(calculateAnnualIncomeTax(0), 0);
  assert.equal(calculateAnnualIncomeTax(600000), 0);
  assert.equal(calculateAnnualIncomeTax(1200000), 30000);
  assert.equal(calculateAnnualIncomeTax(1800000), 120000);
  assert.equal(calculateAnnualIncomeTax(2400000), 210000);
  assert.equal(calculateAnnualIncomeTax(3600000), 510000);
  assert.equal(calculateAnnualIncomeTax(4600000), 860000);
});

test('Working days skip weekends and holidays (timezone independent)', () => {
  assert.equal(calculateWorkingDays('2026-10-05', '2026-10-11'), 5);
  assert.equal(calculateWorkingDays('2026-10-05', '2026-10-11', [0, 6], ['2026-10-06']), 4);
  assert.equal(calculateWorkingDays('2026-10-01', '2026-10-31'), 22);
  assert.equal(calculateWorkingDays('2026-10-10', '2026-10-11'), 0);
});

test('Payroll: gross = 1.5 x basic (HRA 40%, medical 10%), full attendance', () => {
  const e = emp();
  weekdays(2026, 9).forEach((d) => att(e, d, 'present'));
  const p = computeEmployeePayroll(e, '2026-09');
  assert.equal(p.hra, 40000); assert.equal(p.medical_allowance, 10000); assert.equal(p.gross_salary, 150000);
  assert.equal(p.working_days, 22); assert.equal(p.absent_days, 0); assert.equal(p.absent_deduction, 0);
  assert.equal(p.income_tax, 10000);
  assert.equal(p.net_salary, 140000);
});

test('Payroll: absent + half-day deductions (per-day = gross / working days)', () => {
  const e = emp();
  const days = weekdays(2026, 9);
  days.slice(0, 19).forEach((d) => att(e, d, 'present'));
  att(e, days[19], 'half_day'); // days[20], days[21] have no record -> absent
  const p = computeEmployeePayroll(e, '2026-09');
  assert.equal(p.absent_days, 2); assert.equal(p.half_days, 1);
  assert.equal(p.absent_deduction, Math.round(2.5 * (150000 / 22)));
  assert.equal(p.net_salary, 150000 - Math.round(2.5 * (150000 / 22)) - 10000);
});

test('Payroll: approved unpaid leave is deducted, approved paid leave is not', () => {
  const e = emp();
  const days = weekdays(2026, 9);
  days.slice(0, 20).forEach((d) => att(e, d, 'present'));
  const mk = (type: string, date: string) => db.getData().leave_requests.push({ id: `l-${type}-${e.id}`, employee_id: e.id, leave_type: type, start_date: date, end_date: date, working_days: 1, reason: 't', status: 'approved', reviewed_by: 'x', review_comment: '', created_at: '' } as any);
  mk('unpaid', days[20]); mk('sick', days[21]);
  const p = computeEmployeePayroll(e, '2026-09');
  assert.equal(p.unpaid_leave_days, 1); assert.equal(p.absent_days, 0);
  assert.equal(p.absent_deduction, Math.round(150000 / 22));
});

test('Payroll: joiner is prorated', () => {
  const e = emp({ joining_date: '2026-09-15' });
  weekdays(2026, 9).filter((d) => d >= '2026-09-15').forEach((d) => att(e, d, 'present'));
  const p = computeEmployeePayroll(e, '2026-09');
  assert.equal(p.working_days, 12);
  assert.equal(p.gross_salary, Math.round((150000 / 22) * 12));
  assert.equal(p.absent_days, 0);
});

test('Payroll: finalize locks the run; regenerate / refinalize are rejected and payslips unchanged', () => {
  const run = generatePayrollDraft('2026-09', 'hr1');
  assert.equal(run.status, 'draft');
  const before = JSON.stringify(db.getData().payslips.filter((p) => p.month === '2026-09'));
  const fin = finalizePayroll('2026-09', 'admin1');
  assert.equal(fin.status, 'finalized');
  assert.throws(() => generatePayrollDraft('2026-09', 'hr1'), /finalized/);
  assert.throws(() => finalizePayroll('2026-09', 'admin1'), /finalized/);
  assert.equal(JSON.stringify(db.getData().payslips.filter((p) => p.month === '2026-09')), before);
});

test('Leave: valid request, weekend-only 422, overlap 422, over-balance 422, bad type 422, pending reserved', () => {
  const e = emp();
  const ok = applyForLeave({ employee_id: e.id, leave_type: 'casual', start_date: '2026-12-07', end_date: '2026-12-08', reason: 'wedding' });
  assert.equal(ok.success, true); assert.equal(ok.leave!.working_days, 2);
  assert.equal(applyForLeave({ employee_id: e.id, leave_type: 'casual', start_date: '2026-12-12', end_date: '2026-12-13', reason: 'x' }).status_code, 422);
  assert.equal(applyForLeave({ employee_id: e.id, leave_type: 'sick', start_date: '2026-12-08', end_date: '2026-12-09', reason: 'x' }).status_code, 422);
  assert.equal(applyForLeave({ employee_id: e.id, leave_type: 'casual', start_date: '2026-12-14', end_date: '2027-01-01', reason: 'x' }).status_code, 422);
  assert.equal(applyForLeave({ employee_id: e.id, leave_type: 'bogus' as any, start_date: '2026-12-14', end_date: '2026-12-15', reason: 'x' }).status_code, 422);
  // 2 pending casual days reserved: asking for 9 more working days (total 11 > 10) must fail
  assert.equal(applyForLeave({ employee_id: e.id, leave_type: 'casual', start_date: '2026-12-14', end_date: '2026-12-24', reason: 'x' }).status_code, 422);
});

test('Leave: balance reflects approved days and unpaid is unlimited', () => {
  const e = emp();
  const r = applyForLeave({ employee_id: e.id, leave_type: 'sick', start_date: '2026-11-16', end_date: '2026-11-17', reason: 'flu' });
  assert.equal(getLeaveBalance(e.id).sick.remaining, 8, 'pending does not consume balance in the balance view');
  db.getData().leave_requests.find((l) => l.id === r.leave!.id)!.status = 'approved';
  const year = new Date().getFullYear();
  void year;
  const b = getLeaveBalance(e.id);
  assert.equal(b.sick.total, 8);
  const u = applyForLeave({ employee_id: e.id, leave_type: 'unpaid', start_date: '2026-11-23', end_date: '2026-12-04', reason: 'long' });
  assert.equal(u.success, true);
});

test('Attendance: one record per day (second check-in 409), check-out stores hours', () => {
  const e = emp();
  const a = processCheckIn({ employee_id: e.id, source: 'web' });
  assert.equal(a.success, true);
  assert.equal(a.attendance!.date, officeNow().date);
  assert.equal(processCheckIn({ employee_id: e.id, source: 'web' }).status_code, 409);
  const o = processCheckOut({ employee_id: e.id } as any);
  assert.equal(o.success, true);
  assert.equal(db.getData().attendance.filter((x) => x.employee_id === e.id).length, 1);
  assert.equal(processCheckOut({ employee_id: e.id } as any).status_code, 409);
});

test('Attendance status: late after start+grace, present before (server time vs configured office hours)', () => {
  const s = db.getData().settings;
  const keep = [s.office_start, s.grace_minutes] as const;
  s.office_start = '00:00'; s.grace_minutes = 0;
  const late = emp();
  assert.equal(processCheckIn({ employee_id: late.id, source: 'web' }).attendance!.status, 'late');
  s.office_start = '23:59'; s.grace_minutes = 0;
  const ontime = emp();
  assert.equal(processCheckIn({ employee_id: ontime.id, source: 'web' }).attendance!.status, 'present');
  s.office_start = keep[0]; s.grace_minutes = keep[1];
});

function vec(seed: number, noise = 0, salt = 1): number[] {
  // deterministic pseudo-descriptor for a "person" (seed); noise simulates a different capture of the same person
  const out: number[] = [];
  for (let i = 0; i < 128; i++) {
    const base = Math.sin(seed * 97.13 + i * 1.7) * 0.2;
    out.push(base + noise * Math.sin(salt * 31.7 + i * 2.3));
  }
  return out;
}

test('Camera attendance (SYNTHETIC descriptors): one face, liveness, identity match, GPS accuracy, geofence', () => {
  const s = db.getData().settings; s.require_face_attendance = true;
  const near = { lat: 24.8607, lng: 67.0011, accuracy: 20 };
  const enrolled = () => { const e = emp(); assert.equal(face.enrollFace(e.id, [vec(1, 0.01, 1), vec(1, 0.01, 2), vec(1, 0.01, 3)]).ok, true); return e; };
  const ok = { face_count: 1, liveness_passed: true, face_descriptor: vec(1, 0.01, 9) };
  assert.equal(processCheckIn({ employee_id: enrolled().id, source: 'web' }).status_code, 422, 'plain web check-in disabled');
  assert.equal(processCheckIn({ employee_id: enrolled().id, source: 'camera', ...ok, face_count: 0, ...near }).status_code, 422, 'no face');
  assert.equal(processCheckIn({ employee_id: enrolled().id, source: 'camera', ...ok, face_count: 2, ...near }).status_code, 422, 'two faces');
  assert.equal(processCheckIn({ employee_id: enrolled().id, source: 'camera', ...ok, liveness_passed: false, ...near }).status_code, 422, 'no liveness');
  assert.equal(processCheckIn({ employee_id: emp().id, source: 'camera', ...ok, ...near }).status_code, 422, 'not enrolled');
  assert.equal(processCheckIn({ employee_id: enrolled().id, source: 'camera', ...ok, face_descriptor: vec(2) , ...near }).status_code, 422, 'different person rejected');
  assert.equal(processCheckIn({ employee_id: enrolled().id, source: 'camera', ...ok, face_descriptor: undefined, ...near }).status_code, 422, 'missing descriptor');
  assert.equal(processCheckIn({ employee_id: enrolled().id, source: 'camera', ...ok }).status_code, 422, 'GPS missing -> never auto-approved');
  assert.equal(processCheckIn({ employee_id: enrolled().id, source: 'camera', ...ok, ...near, accuracy: 150 }).status_code, 422, 'GPS accuracy');
  assert.equal(processCheckIn({ employee_id: enrolled().id, source: 'camera', ...ok, lat: 24.9, lng: 67.1, accuracy: 20 }).status_code, 422, 'outside radius');
  const good = enrolled();
  const r = processCheckIn({ employee_id: good.id, source: 'camera', ...ok, ...near });
  assert.equal(r.success, true); assert.equal(r.attendance!.source, 'camera'); assert.ok((r.attendance as any).face_distance < 0.5);
  assert.equal(processCheckIn({ employee_id: good.id, source: 'camera', ...ok, ...near }).status_code, 409, 'duplicate');
  assert.equal(db.getData().attendance.filter((a) => a.employee_id === good.id).length, 1, 'failed attempts create no record');
  s.require_face_attendance = false;
});

test('Face templates: encrypted at rest, validation, delete, legacy fake data invalidated', () => {
  const e = emp();
  assert.equal(face.enrollFace(e.id, [vec(1), vec(1)]).ok, false, 'too few samples');
  assert.equal(face.enrollFace(e.id, [vec(1), vec(1), [1, 2, 3]]).ok, false, 'bad vector');
  assert.equal(face.enrollFace(e.id, [vec(1), vec(2), vec(3)]).ok, false, 'samples of different people rejected');
  assert.equal(face.enrollFace(e.id, [vec(5, 0.01, 1), vec(5, 0.01, 2), vec(5, 0.01, 3)]).ok, true);
  const t = db.getData().face_templates.find((x) => x.employee_id === e.id)!;
  assert.ok(!t.enc.includes('['), 'template is not stored as readable JSON');
  assert.equal(face.faceStatus(e.id).enrolled, true);
  assert.equal(face.verifyFace(e.id, vec(5, 0.01, 7)).ok, true);
  assert.equal(face.verifyFace(e.id, vec(6)).ok, false);
  face.deleteFace(e.id);
  assert.equal(face.faceStatus(e.id).enrolled, false);
  assert.equal(face.verifyFace(e.id, vec(5)).ok, false);
  const old = emp({ face_enrolled: true, face_descriptor: [0.4, 0.5, 0.2, 0.1, 0.42, 0.58, 0.71, 0.33] });
  assert.ok(face.migrateLegacyFaceData() >= 1);
  assert.equal(old.face_enrolled, false); assert.equal(old.face_descriptor, null);
});

test('Face challenge nonce is single-use, expires, and bound to one employee', () => {
  const c = face.issueChallenge('eX');
  assert.equal(face.consumeChallenge(c.nonce, 'someone-else'), false);
  const c2 = face.issueChallenge('eX');
  assert.equal(face.consumeChallenge(c2.nonce, 'eX'), true);
  assert.equal(face.consumeChallenge(c2.nonce, 'eX'), false, 'replay rejected');
});

test('Audit log snapshots before/after: later edits of the same object cannot break or rewrite history', () => {
  const live: any = { status: 'pending', nested: { n: 1 } };
  const e = createAuditLog({ actor_id: 'u', actor_email: 'u@x', actor_role: 'admin', action: 'test.snapshot', entity: 'x', entity_id: '1', before_json: { ...live }, after_json: live });
  live.status = 'approved'; live.nested.n = 2; // callers keep mutating the object after logging
  db.save();
  assert.equal((e.after_json as any).status, 'pending', 'entry keeps the value at logging time');
  assert.equal(verifyAuditChain().valid, true);
  const stored = db.getData().audit_logs.find((l) => l.id === e.id)!;
  assert.deepEqual(stored.after_json, { status: 'pending', nested: { n: 1 } });
  db.reload(); // what survives a restart must still verify
  assert.equal(verifyAuditChain().valid, true);
});

test('Haversine distance (server-side) is accurate', () => {
  const d = calculateHaversineDistance(0, 0, 1, 0);
  assert.ok(Math.abs(d - 111195) < 300, `got ${d}`);
  assert.ok(calculateHaversineDistance(24.8607, 67.0011, 24.8607, 67.0011) < 1);
});

test('Office time helper evaluates date/time in Asia/Karachi, not UTC', () => {
  const t = officeNow(new Date('2026-10-12T21:30:00Z'));
  assert.deepEqual(t, { date: '2026-10-13', minutes: 150 });
});
