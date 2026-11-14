import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { DatabaseSync } from 'node:sqlite';
import type {
  User,
  CompanySettings,
  Department,
  Designation,
  PublicHoliday,
  Employee,
  Attendance,
  AttendanceCorrection,
  LeaveRequest,
  PayrollRun,
  Payslip,
  Announcement,
  Notification,
  AuditLog,
  AILog
} from '../types.js';

export interface DatabaseSchema {
  settings: CompanySettings;
  users: User[];
  departments: Department[];
  designations: Designation[];
  holidays: PublicHoliday[];
  employees: Employee[];
  attendance: Attendance[];
  attendance_corrections: AttendanceCorrection[];
  leave_requests: LeaveRequest[];
  payroll_runs: PayrollRun[];
  payslips: Payslip[];
  announcements: Announcement[];
  notifications: Notification[];
  audit_logs: AuditLog[];
  ai_logs: AILog[];
  face_templates: { employee_id: string; enc: string; samples: number; model: string; created_at: string }[];
  password_resets: { user_id: string; token_hash: string; expires_at: string; used: boolean; created_at: string }[];
  secrets: Record<string, string>;
}

const DEFAULT_SETTINGS: CompanySettings = {
  is_configured: false,
  company_name: '',
  office_start: '09:00',
  grace_minutes: 15,
  half_day_hours: 5,
  weekend_days: [0, 6], // Sunday = 0, Saturday = 6
  office_lat: 0,
  office_lng: 0,
  office_radius_meters: 150,
  annual_leave_quota: 14,
  sick_leave_quota: 8,
  casual_leave_quota: 10,
  require_face_attendance: true,
  late_penalty_rule: false, // optional bonus rule (3 lates = 0.5 day); off by default so payroll matches the brief exactly
};

const DB_DIR = path.resolve(process.env.DATA_DIR || path.join(process.cwd(), 'data'));
const DB_FILE = process.env.DB_FILE || path.join(DB_DIR, 'hcm.sqlite');

/**
 * Persistent store backed by SQLite (node:sqlite, WAL journaling).
 * Each collection is one row in table `collections`; save() writes only collections that
 * changed, inside a single IMMEDIATE transaction, so a crash can never leave a half-written
 * state. The in-process request mutex (see server.ts) serialises mutating requests.
 */
class DatabaseStore {
  private data: DatabaseSchema;
  private sql: DatabaseSync;
  private lastSaved = new Map<string, string>();

  constructor() {
    fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
    this.sql = new DatabaseSync(DB_FILE);
    this.sql.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000;');
    this.sql.exec('CREATE TABLE IF NOT EXISTS collections (name TEXT PRIMARY KEY, body TEXT NOT NULL, updated_at TEXT NOT NULL)');
    this.data = this.load();
  }

  private getEmptySchema(): DatabaseSchema {
    return {
      settings: { ...DEFAULT_SETTINGS },
      users: [], departments: [], designations: [], holidays: [], employees: [],
      attendance: [], attendance_corrections: [], leave_requests: [], payroll_runs: [],
      payslips: [], announcements: [], notifications: [], audit_logs: [], ai_logs: [],
      password_resets: [], face_templates: [], secrets: {},
    } as DatabaseSchema;
  }

  private load(): DatabaseSchema {
    const data: any = this.getEmptySchema();
    this.lastSaved.clear();
    const rows = this.sql.prepare('SELECT name, body FROM collections').all() as { name: string; body: string }[];
    for (const r of rows) {
      data[r.name] = JSON.parse(r.body);
      this.lastSaved.set(r.name, r.body);
    }
    data.settings = { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
    return data;
  }

  /** Discard unsaved in-memory changes (used to roll back a failed request). */
  public reload() {
    this.data = this.load();
    return this.data;
  }

  public save() {
    const upsert = this.sql.prepare(
      'INSERT INTO collections (name, body, updated_at) VALUES (?, ?, ?) ON CONFLICT(name) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at'
    );
    const changed: [string, string][] = [];
    for (const [name, value] of Object.entries(this.data)) {
      const body = JSON.stringify(value);
      if (this.lastSaved.get(name) !== body) changed.push([name, body]);
    }
    if (changed.length === 0) return;
    this.sql.exec('BEGIN IMMEDIATE');
    try {
      const now = new Date().toISOString();
      for (const [name, body] of changed) upsert.run(name, body, now);
      this.sql.exec('COMMIT');
      for (const [name, body] of changed) this.lastSaved.set(name, body);
    } catch (err) {
      this.sql.exec('ROLLBACK');
      throw err;
    }
  }

  /** Stable server secret (JWT signing key) generated once and stored in the database if JWT_SECRET is unset. */
  public getOrCreateSecret(name: string): string {
    const d: any = this.data;
    d.secrets = d.secrets || {};
    if (!d.secrets[name]) {
      d.secrets[name] = crypto.randomBytes(48).toString('hex');
      this.save();
    }
    return d.secrets[name];
  }

  public getData(): DatabaseSchema {
    return this.data;
  }
}

export const db = new DatabaseStore();
