import crypto from 'crypto';
import { db } from '../db.js';
import type { UserRole, AuditLog } from '../../types.js';

/**
 * Audit log is append-only: this module exposes no update/delete function and the API has no
 * mutating audit route. Each entry carries a SHA-256 hash chained to the previous entry, so any
 * edit or deletion is detectable via verifyAuditChain().
 */
function entryHash(l: Omit<AuditLog, 'hash'>): string {
  const body = JSON.stringify([l.seq, l.prev_hash, l.id, l.actor_id, l.actor_email, l.actor_role, l.action, l.entity, l.entity_id, l.before_json, l.after_json, l.ip, l.created_at]);
  return crypto.createHash('sha256').update(body).digest('hex');
}

export function createAuditLog(params: {
  actor_id: string; actor_email: string; actor_role: UserRole; action: string; entity: string;
  entity_id: string; before_json?: any; after_json?: any; ip?: string;
}): AuditLog {
  const logs = db.getData().audit_logs;
  const last = logs[logs.length - 1];
  // Snapshot before/after NOW. Callers often pass live objects (settings, employee, leave...); keeping a
  // reference would let later edits silently rewrite history and break the hash chain.
  const snap = (v: any) => (v === undefined || v === null ? null : JSON.parse(JSON.stringify(v)));
  const base: Omit<AuditLog, 'hash'> = {
    id: `audit-${crypto.randomUUID()}`,
    seq: (last?.seq ?? 0) + 1,
    prev_hash: last?.hash ?? 'GENESIS',
    actor_id: params.actor_id,
    actor_email: params.actor_email,
    actor_role: params.actor_role,
    action: params.action,
    entity: params.entity,
    entity_id: params.entity_id,
    before_json: snap(params.before_json),
    after_json: snap(params.after_json),
    ip: params.ip || 'unknown',
    created_at: new Date().toISOString(),
  };
  const log: AuditLog = { ...base, hash: entryHash(base) };
  logs.push(log);
  db.save();
  return log;
}

export function verifyAuditChain(): { valid: boolean; entries: number; broken_at?: number } {
  const logs = db.getData().audit_logs;
  let prev = 'GENESIS';
  for (let i = 0; i < logs.length; i++) {
    const { hash, ...rest } = logs[i];
    if (rest.prev_hash !== prev || entryHash(rest) !== hash || rest.seq !== i + 1) return { valid: false, entries: logs.length, broken_at: i + 1 };
    prev = hash!;
  }
  return { valid: true, entries: logs.length };
}
