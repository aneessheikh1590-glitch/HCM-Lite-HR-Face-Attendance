import crypto from 'crypto';
import { db } from '../db.js';

/**
 * Face template storage + server-side matching.
 *
 * The browser (face-api / TensorFlow.js, pretrained FaceRecognitionNet) turns a camera frame into a
 * 128-number descriptor. The server NEVER trusts a "match" flag from the browser: it decrypts the
 * enrolled template of the AUTHENTICATED employee and computes the Euclidean distance itself.
 *
 * Limitation (documented in README): the descriptor is computed in the browser, so a hostile client
 * that can obtain a victim's descriptor could replay it. Server-side re-detection on an uploaded frame
 * would be the next hardening step.
 */
export const DESCRIPTOR_LENGTH = 128;
export const MODEL_NAME = 'faceapi-resnet128';
export const MIN_ENROLL_SAMPLES = 3;
export const MAX_ENROLL_SAMPLES = 8;

export function matchThreshold(): number {
  const t = Number(process.env.FACE_MATCH_THRESHOLD);
  return Number.isFinite(t) && t > 0.2 && t < 0.9 ? t : 0.5; // face-api default is 0.6; 0.5 is stricter
}

function key(): Buffer {
  const base = process.env.FACE_ENCRYPTION_KEY || db.getOrCreateSecret('face');
  return crypto.createHash('sha256').update(base).digest();
}

export function encryptSamples(samples: number[][]): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([c.update(JSON.stringify(samples), 'utf8'), c.final()]);
  return [iv.toString('base64'), c.getAuthTag().toString('base64'), body.toString('base64')].join('.');
}

export function decryptSamples(enc: string): number[][] {
  const [iv, tag, body] = enc.split('.').map((x) => Buffer.from(x, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', key(), iv);
  d.setAuthTag(tag);
  return JSON.parse(Buffer.concat([d.update(body), d.final()]).toString('utf8'));
}

export function isValidDescriptor(v: unknown): v is number[] {
  return Array.isArray(v) && v.length === DESCRIPTOR_LENGTH && v.every((x) => typeof x === 'number' && Number.isFinite(x) && Math.abs(x) < 5) && v.some((x) => x !== 0);
}

export function euclidean(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2;
  return Math.sqrt(s);
}

/** Enroll: validates samples belong to one person, then stores them encrypted. */
export function enrollFace(employee_id: string, samples: unknown): { ok: boolean; error?: string; samples?: number } {
  if (!Array.isArray(samples) || samples.length < MIN_ENROLL_SAMPLES || samples.length > MAX_ENROLL_SAMPLES) {
    return { ok: false, error: `Provide ${MIN_ENROLL_SAMPLES}-${MAX_ENROLL_SAMPLES} face samples.` };
  }
  if (!samples.every(isValidDescriptor)) return { ok: false, error: `Every sample must be a valid ${DESCRIPTOR_LENGTH}-number face descriptor.` };
  const s = samples as number[][];
  // all samples must be mutually consistent (same person), otherwise reject the enrollment
  let worst = 0;
  for (let i = 0; i < s.length; i++) for (let j = i + 1; j < s.length; j++) worst = Math.max(worst, euclidean(s[i], s[j]));
  if (worst > 0.6) return { ok: false, error: 'Samples do not look like the same person. Make sure only you are in front of the camera and retry.' };

  const data = db.getData();
  data.face_templates = data.face_templates.filter((t) => t.employee_id !== employee_id);
  data.face_templates.push({ employee_id, enc: encryptSamples(s), samples: s.length, model: MODEL_NAME, created_at: new Date().toISOString() });
  const emp = data.employees.find((e) => e.id === employee_id);
  if (emp) { emp.face_enrolled = true; emp.face_descriptor = null; emp.face_photo_url = null; emp.updated_at = new Date().toISOString(); }
  db.save();
  return { ok: true, samples: s.length };
}

export function deleteFace(employee_id: string): void {
  const data = db.getData();
  data.face_templates = data.face_templates.filter((t) => t.employee_id !== employee_id);
  const emp = data.employees.find((e) => e.id === employee_id);
  if (emp) { emp.face_enrolled = false; emp.face_descriptor = null; emp.updated_at = new Date().toISOString(); }
  db.save();
}

export function faceStatus(employee_id: string) {
  const t = db.getData().face_templates.find((x) => x.employee_id === employee_id);
  return { enrolled: !!t, samples: t?.samples ?? 0, enrolled_at: t?.created_at ?? null, model: t?.model ?? null, threshold: matchThreshold() };
}

/** Compares a fresh descriptor with the employee's enrolled template. */
export function verifyFace(employee_id: string, probe: unknown): { ok: boolean; error?: string; distance?: number } {
  if (!isValidDescriptor(probe)) return { ok: false, error: 'No valid face descriptor received from the camera.' };
  const t = db.getData().face_templates.find((x) => x.employee_id === employee_id);
  if (!t) return { ok: false, error: 'Your face is not enrolled yet. Complete face enrollment first.' };
  let samples: number[][];
  try { samples = decryptSamples(t.enc); } catch { return { ok: false, error: 'Stored face template cannot be read. Ask HR to reset your face enrollment.' }; }
  const distance = Math.min(...samples.map((s) => euclidean(s, probe)));
  const rounded = Math.round(distance * 1000) / 1000;
  if (distance > matchThreshold()) return { ok: false, distance: rounded, error: `Face does not match the enrolled employee (distance ${rounded} > ${matchThreshold()}).` };
  return { ok: true, distance: rounded };
}

/** Old builds stored fake 8-number "descriptors". They can never identify anyone, so invalidate them safely. */
export function migrateLegacyFaceData(): number {
  const data = db.getData();
  let n = 0;
  for (const e of data.employees) {
    const has = data.face_templates.some((t) => t.employee_id === e.id);
    if ((e.face_enrolled && !has) || e.face_descriptor) { e.face_enrolled = has; e.face_descriptor = null; e.face_photo_url = null; n++; }
  }
  if (n) db.save();
  return n;
}

// ---- single-use liveness/attempt challenges (bind a check-in to a fresh server-issued nonce) ----
const challenges = new Map<string, { employee_id: string; exp: number }>();
export function issueChallenge(employee_id: string): { nonce: string; expires_in: number } {
  const now = Date.now();
  for (const [k, v] of challenges) if (v.exp < now) challenges.delete(k);
  const nonce = crypto.randomBytes(16).toString('hex');
  challenges.set(nonce, { employee_id, exp: now + 120_000 });
  return { nonce, expires_in: 120 };
}
export function consumeChallenge(nonce: unknown, employee_id: string): boolean {
  if (typeof nonce !== 'string') return false;
  const c = challenges.get(nonce);
  challenges.delete(nonce);
  return !!c && c.employee_id === employee_id && c.exp >= Date.now();
}
