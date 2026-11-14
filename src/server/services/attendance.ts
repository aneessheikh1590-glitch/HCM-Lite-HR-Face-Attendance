import { db } from '../db.js';
import type { Attendance, AttendanceCorrection, AttendanceStatus, Employee } from '../../types.js';
import { officeNow } from '../time.js';
import { verifyFace } from './face.js';

// Haversine formula to compute great-circle distance between two points in meters
export function calculateHaversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371e3; // Earth radius in meters
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return Math.round(R * c); // Distance in meters
}

// Cosine similarity for facial descriptor vectors
export function computeCosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function processCheckIn(params: {
  employee_id: string;
  source: 'web' | 'camera';
  lat?: number;
  lng?: number;
  accuracy?: number;
  face_detected?: boolean;
  face_count?: number;
  face_descriptor?: number[];
  liveness_passed?: boolean;
  client_timestamp?: string;
}): { success: boolean; attendance?: Attendance; error?: string; status_code?: number } {
  const data = db.getData();
  const settings = data.settings;
  const employee = data.employees.find((e) => e.id === params.employee_id);

  if (!employee) {
    return { success: false, error: 'Employee not found', status_code: 404 };
  }

  // Server stamps current date and time
  const now = new Date();
  const dateStr = officeNow(now).date;
  const isoTime = now.toISOString();

  // Rule: One record per employee per day (second check-in = 409)
  const existing = data.attendance.find(
    (a) => a.employee_id === params.employee_id && a.date === dateStr
  );
  if (existing) {
    return {
      success: false,
      error: `Already checked in today at ${new Date(existing.check_in).toLocaleTimeString()}. Multiple check-ins on the same day are rejected (409 Conflict).`,
      status_code: 409,
    };
  }

  let distanceMeters: number | null = null;
  let faceDistance: number | null = null;
  const requireFace = settings.require_face_attendance !== false;

  if (params.source !== 'camera' && requireFace) {
    return { success: false, error: 'Plain web check-in is disabled. Use Face Attendance (camera + GPS) or request an HR correction.', status_code: 422 };
  }

  if (params.source === 'camera') {
    // 1. Exactly one face
    if (params.face_count !== 1) {
      return {
        success: false,
        error:
          (params.face_count ?? 0) === 0
            ? 'Check-in rejected: No face detected in frame. Please position yourself in front of the camera.'
            : `Check-in rejected: Multiple faces detected (${params.face_count}). Exactly one face must be present.`,
        status_code: 422,
      };
    }
    // 2. Liveness (blink challenge completed in the browser)
    if (params.liveness_passed !== true) {
      return { success: false, error: 'Check-in rejected: liveness check (blink) was not completed.', status_code: 422 };
    }
    // 3. Identity: the SERVER compares the fresh descriptor with this employee's enrolled template
    const fv = verifyFace(employee.id, params.face_descriptor);
    if (!fv.ok) {
      return { success: false, error: `Check-in rejected: ${fv.error} If lighting changed, submit an attendance correction request.`, status_code: 422 };
    }
    faceDistance = fv.distance ?? null;
  }

  // Geolocation (mandatory for camera attendance; optional only for legacy web check-in when face attendance is switched off)
  const locationRequired = params.source === 'camera';
  const hasLoc = Number.isFinite(params.lat) && Number.isFinite(params.lng);
  if (locationRequired && !hasLoc) {
    return { success: false, error: 'Check-in rejected: GPS location is required. Allow location access and try again.', status_code: 422 };
  }
  if (hasLoc) {
    if (locationRequired && !Number.isFinite(params.accuracy)) {
      return { success: false, error: 'Check-in rejected: GPS accuracy was not reported by the device.', status_code: 422 };
    }
    if (params.accuracy !== undefined && params.accuracy > 100) {
      return {
        success: false,
        error: `Check-in rejected: GPS accuracy is too low (${Math.round(params.accuracy)} m > 100 m limit). Please move to open sky or wait for high precision GPS.`,
        status_code: 422,
      };
    }
    if (!settings.office_lat && !settings.office_lng) {
      return { success: false, error: 'Office location is not configured. Ask Admin to set the office latitude/longitude in Company Settings.', status_code: 422 };
    }
    distanceMeters = calculateHaversineDistance(params.lat!, params.lng!, settings.office_lat, settings.office_lng);
    if (distanceMeters > settings.office_radius_meters) {
      return {
        success: false,
        error: `Check-in rejected: You are ${distanceMeters} m from the office. Must be within ${settings.office_radius_meters} m radius geofence.`,
        status_code: 422,
      };
    }
  }

  // Determine on-time or late status based on office_start + grace_minutes
  // e.g. "09:00" + 15 min = 09:15
  const [startH, startM] = (settings.office_start || '09:00').split(':').map(Number);
  const cutoffMinutes = startH * 60 + startM + (settings.grace_minutes ?? 15);
  const isLate = officeNow(now).minutes > cutoffMinutes;
  const initialStatus: AttendanceStatus = isLate ? 'late' : 'present';

  const newRecord: Attendance = {
    id: `att-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    employee_id: params.employee_id,
    date: dateStr,
    check_in: isoTime,
    check_out: null,
    source: params.source,
    status: initialStatus,
    total_hours: 0,
    lat: params.lat ?? null,
    lng: params.lng ?? null,
    accuracy: params.accuracy ?? null,
    distance_meters: distanceMeters,
    face_distance: faceDistance,
    liveness_passed: params.source === 'camera' ? true : null,
    created_at: isoTime,
  };

  data.attendance.push(newRecord);
  db.save();

  return { success: true, attendance: newRecord, status_code: 201 };
}

export function processCheckOut(params: {
  employee_id: string;
}): { success: boolean; attendance?: Attendance; error?: string; status_code?: number } {
  const data = db.getData();
  const settings = data.settings;
  const now = new Date();
  const dateStr = officeNow(now).date;

  const record = data.attendance.find(
    (a) => a.employee_id === params.employee_id && a.date === dateStr
  );

  if (!record) {
    return {
      success: false,
      error: 'Cannot check out without an active check-in today.',
      status_code: 404,
    };
  }

  if (record.check_out) {
    return {
      success: false,
      error: `Already checked out today at ${new Date(record.check_out).toLocaleTimeString()}.`,
      status_code: 409,
    };
  }

  const checkInTime = new Date(record.check_in).getTime();
  const checkOutTime = now.getTime();
  const diffHours = Math.max(0, (checkOutTime - checkInTime) / (1000 * 60 * 60));
  const roundedHours = Math.round(diffHours * 100) / 100;

  record.check_out = now.toISOString();
  record.total_hours = roundedHours;

  // Section 3 rule: half_day under 5 h
  if (roundedHours < settings.half_day_hours) {
    record.status = 'half_day';
  }

  db.save();
  return { success: true, attendance: record, status_code: 200 };
}
