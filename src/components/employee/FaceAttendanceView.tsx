import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Camera, MapPin, CheckCircle2, AlertTriangle, RefreshCw, ShieldCheck, Eye, UserCheck, Trash2, ScanFace } from 'lucide-react';
import { apiRequest } from '../../lib/api.js';
import { loadFaceModels, analyzeFrame, BlinkDetector, frameQualityIssue, type FaceFrame } from '../../lib/face-engine.js';
import type { Attendance, CompanySettings, Employee } from '../../types.js';

interface Props {
  employee: Employee;
  settings?: CompanySettings;
  onAttendanceSuccess: (att: Attendance) => void;
  onRequestCorrection: () => void;
}

interface FaceStatus { enrolled: boolean; samples: number; enrolled_at: string | null; threshold: number }
type Gps = { lat: number; lng: number; accuracy: number };

const ENROLL_STEPS = [
  { key: 'front', text: 'Look straight at the camera', ok: (y: number) => y > 0.4 && y < 0.6 },
  { key: 'sideA', text: 'Turn your head slightly to ONE side', ok: (y: number) => y <= 0.38 || y >= 0.62 },
  { key: 'sideB', text: 'Now turn slightly to the OTHER side', ok: (y: number) => y <= 0.38 || y >= 0.62 },
  { key: 'front2', text: 'Look straight again and blink once', ok: (y: number) => y > 0.4 && y < 0.6 },
];

function haversine(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371e3, r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

export const FaceAttendanceView: React.FC<Props> = ({ employee, settings, onAttendanceSuccess, onRequestCorrection }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const scratchRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const blink = useRef(new BlinkDetector());
  const latest = useRef<FaceFrame | null>(null);
  const nonce = useRef<string | null>(null);
  const startedAt = useRef(0);
  const enrollRef = useRef<{ step: number; good: number; samples: number[][]; yawSign: number; mode: boolean }>({ step: 0, good: 0, samples: [], yawSign: 0, mode: false });

  const [status, setStatus] = useState<FaceStatus | null>(null);
  const [mode, setMode] = useState<'loading' | 'enroll' | 'attend'>('loading');
  const [consent, setConsent] = useState(false);
  const [enrolling, setEnrolling] = useState(false);
  const [enrollStep, setEnrollStep] = useState(0);
  const [hint, setHint] = useState<string>('');
  const [modelsReady, setModelsReady] = useState(false);
  const [modelError, setModelError] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [streamActive, setStreamActive] = useState(false);
  const [frame, setFrame] = useState<FaceFrame | null>(null);
  const [live, setLive] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const [gps, setGps] = useState<Gps | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      const s = await apiRequest<FaceStatus>('/api/face/status');
      setStatus(s);
      setMode(s.enrolled ? 'attend' : 'enroll');
    } catch (e: any) { setFeedback({ type: 'error', message: e.message || 'Could not load face status.' }); setMode('enroll'); }
  }, []);
  useEffect(() => { loadStatus(); }, [loadStatus]);

  const stopCamera = useCallback(() => {
    const v = videoRef.current;
    (v?.srcObject as MediaStream | null)?.getTracks().forEach((t) => t.stop());
    if (v) v.srcObject = null;
    setStreamActive(false);
  }, []);

  const startCamera = useCallback(async () => {
    setCameraError(null);
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera needs a secure (HTTPS) connection and a supported browser.');
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); setStreamActive(true); }
    } catch (e: any) { setCameraError(e?.message || 'Camera access denied or unavailable.'); }
  }, []);

  const requestLocation = useCallback(() => {
    setGpsError(null);
    if (!navigator.geolocation) { setGps(null); setGpsError('Geolocation is not supported by this browser.'); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => setGps({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Math.round(p.coords.accuracy) }),
      (err) => { setGps(null); setGpsError(`Location unavailable: ${err.message}. Allow location access and tap Refresh GPS, or request an HR correction.`); },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  }, []);

  const newChallenge = useCallback(async () => {
    try { nonce.current = (await apiRequest<{ nonce: string }>('/api/attendance/challenge', { method: 'POST', body: '{}' })).nonce; } catch { nonce.current = null; }
  }, []);

  // models + camera (+ GPS and challenge for attendance) once a mode is known
  useEffect(() => {
    if (mode === 'loading') return;
    let cancelled = false;
    loadFaceModels().then(() => !cancelled && setModelsReady(true)).catch((e) => !cancelled && setModelError(`Face models failed to load (${e?.message || e}). Check that /models is served.`));
    startCamera();
    if (mode === 'attend') { requestLocation(); newChallenge(); }
    startedAt.current = Date.now();
    return () => { cancelled = true; stopCamera(); };
  }, [mode, startCamera, stopCamera, requestLocation, newChallenge]);

  const resetLiveness = () => { blink.current.reset(); setLive(false); setTimedOut(false); startedAt.current = Date.now(); newChallenge(); };

  const submitEnrollment = useCallback(async (samples: number[][]) => {
    setEnrolling(false);
    enrollRef.current.mode = false;
    try {
      await apiRequest('/api/face/enroll', { method: 'POST', body: JSON.stringify({ consent: true, liveness_passed: blink.current.passed, descriptors: samples }) });
      setFeedback({ type: 'success', message: 'Face enrolled. You can now check in with your face.' });
      stopCamera();
      await loadStatus();
    } catch (e: any) { setFeedback({ type: 'error', message: e.message || 'Enrollment failed.' }); setEnrollStep(0); enrollRef.current = { ...enrollRef.current, step: 0, good: 0, samples: [], yawSign: 0 }; }
  }, [loadStatus, stopCamera]);

  // detection loop (sequential, never overlapping)
  useEffect(() => {
    if (!streamActive || !modelsReady) return;
    let stop = false;
    const tick = async () => {
      if (stop || !videoRef.current || !scratchRef.current) return;
      try {
        const f = await analyzeFrame(videoRef.current, scratchRef.current);
        latest.current = f;
        setFrame(f);
        if (f.faceCount === 1 && f.ear !== null) { blink.current.update(f.ear); if (blink.current.passed) setLive(true); }
        const ov = overlayRef.current;
        if (ov) {
          const c = ov.getContext('2d'); ov.width = f.videoWidth || 640; ov.height = videoRef.current.videoHeight || 480;
          c?.clearRect(0, 0, ov.width, ov.height);
          if (c && f.box) { c.strokeStyle = '#10b981'; c.lineWidth = 3; c.strokeRect(f.box.x, f.box.y, f.box.width, f.box.height); }
        }
        if (mode === 'attend' && !blink.current.passed && Date.now() - startedAt.current > 25000) setTimedOut(true);

        const E = enrollRef.current;
        if (E.mode) {
          const issue = frameQualityIssue(f);
          const st = ENROLL_STEPS[E.step];
          if (issue) { setHint(issue); E.good = 0; }
          else if (!st.ok(f.yaw ?? 0.5)) { setHint(st.text); E.good = 0; }
          else if (E.step === 2 && Math.sign((f.yaw ?? 0.5) - 0.5) === E.yawSign) { setHint('Turn to the OTHER side.'); E.good = 0; }
          else {
            setHint(st.text); E.good++;
            if (E.good >= 3 && f.descriptor) {
              if (E.step === 1) E.yawSign = Math.sign((f.yaw ?? 0.5) - 0.5);
              E.samples.push(f.descriptor); E.good = 0; E.step++; setEnrollStep(E.step);
              if (E.step >= ENROLL_STEPS.length) { E.mode = false; setHint('Checking blink liveness…'); }
            }
          }
          if (E.step >= ENROLL_STEPS.length && blink.current.passed) submitEnrollment(E.samples);
        }
      } catch (e) { console.warn('frame error', e); }
      if (!stop) setTimeout(tick, 120);
    };
    tick();
    return () => { stop = true; };
  }, [streamActive, modelsReady, mode, submitEnrollment]);

  const beginEnrollment = () => {
    blink.current.reset(); setLive(false);
    enrollRef.current = { step: 0, good: 0, samples: [], yawSign: 0, mode: true };
    setEnrollStep(0); setEnrolling(true); setFeedback(null);
  };
  // after the 4th sample, keep waiting for a blink then submit (handled in the loop); allow submission when blink arrives later
  useEffect(() => {
    const E = enrollRef.current;
    if (enrolling && E.step >= ENROLL_STEPS.length && live) submitEnrollment(E.samples);
  }, [live, enrolling, submitEnrollment]);

  const handleCheckIn = async () => {
    setFeedback(null); setSubmitting(true);
    try {
      if (!videoRef.current || !scratchRef.current) throw new Error('Camera is not ready.');
      const f = await analyzeFrame(videoRef.current, scratchRef.current); // fresh descriptor at click time
      if (f.faceCount !== 1) throw new Error(f.faceCount === 0 ? 'No face detected. Face the camera.' : 'Multiple faces detected. Only you may be in frame.');
      const payload: any = { source: 'camera', face_count: f.faceCount, face_descriptor: f.descriptor, liveness_passed: blink.current.passed, nonce: nonce.current };
      if (gps) Object.assign(payload, gps);
      const res = await apiRequest<Attendance>('/api/attendance/check-in', { method: 'POST', body: JSON.stringify(payload) });
      setFeedback({ type: 'success', message: `Check-in recorded as ${res.status.toUpperCase()} at ${new Date(res.check_in).toLocaleTimeString()}.` });
      onAttendanceSuccess(res);
    } catch (e: any) {
      setFeedback({ type: 'error', message: e.message || 'Check-in failed.' });
      resetLiveness(); // every attempt needs a fresh blink + fresh server challenge
    } finally { setSubmitting(false); }
  };

  const handleCheckOut = async () => {
    setFeedback(null); setSubmitting(true);
    try {
      const res = await apiRequest<Attendance>('/api/attendance/check-out', { method: 'POST', body: JSON.stringify({ employee_id: employee.id }) });
      setFeedback({ type: 'success', message: `Check-out recorded. Total ${res.total_hours} h (${res.status.toUpperCase()}).` });
      onAttendanceSuccess(res);
    } catch (e: any) { setFeedback({ type: 'error', message: e.message || 'Check-out failed.' }); } finally { setSubmitting(false); }
  };

  const deleteMyFace = async () => {
    if (!confirm('Delete your stored face template? You will need to enroll again.')) return;
    try { await apiRequest(`/api/face/${employee.id}`, { method: 'DELETE' }); stopCamera(); await loadStatus(); setFeedback({ type: 'success', message: 'Face template deleted.' }); }
    catch (e: any) { setFeedback({ type: 'error', message: e.message }); }
  };

  const radius = settings?.office_radius_meters || 150;
  const distance = gps && settings ? haversine(gps.lat, gps.lng, settings.office_lat, settings.office_lng) : null;
  const oneFace = frame?.faceCount === 1;
  const gpsOk = !!gps && gps.accuracy <= 100;
  const canCheckIn = mode === 'attend' && streamActive && modelsReady && oneFace && live && gpsOk && !submitting;

  const row = (label: string, ok: boolean, okText: string, pendText: string) => (
    <div className="flex items-center justify-between"><span>{label}</span><span className={ok ? 'text-emerald-400 font-semibold' : 'text-amber-400'}>{ok ? okText : pendText}</span></div>
  );

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-3xl p-4 sm:p-8 space-y-6 shadow-xl">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2"><Camera className="w-5 h-5 text-indigo-400" /> Face Recognition & Geofenced Attendance</h2>
          <p className="text-xs text-slate-400">Real face matching (verified on the server) + blink liveness + GPS office geofence.</p>
        </div>
        <span className="text-xs px-2.5 py-1 rounded-full bg-slate-800 text-slate-300 font-mono self-start">{employee.first_name} {employee.last_name} ({employee.code})</span>
      </div>

      {feedback && (
        <div className={`p-4 rounded-2xl text-xs flex items-center justify-between gap-3 ${feedback.type === 'success' ? 'bg-emerald-950/60 border border-emerald-500/40 text-emerald-200' : 'bg-red-950/60 border border-red-500/40 text-red-200'}`}>
          <div className="flex items-center gap-2">{feedback.type === 'success' ? <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" /> : <AlertTriangle className="w-5 h-5 text-red-400 shrink-0" />}<span>{feedback.message}</span></div>
          {feedback.type === 'error' && mode === 'attend' && <button onClick={onRequestCorrection} className="text-indigo-400 hover:text-indigo-300 underline font-semibold shrink-0">Request HR Correction &rarr;</button>}
        </div>
      )}

      {modelError && <div className="p-3 rounded-xl bg-red-950/60 border border-red-500/40 text-red-200 text-xs">{modelError}</div>}

      {mode === 'enroll' && !enrolling && (
        <div className="p-4 bg-slate-800/60 rounded-2xl border border-slate-700/60 space-y-3 text-xs text-slate-300">
          <div className="font-semibold text-white flex items-center gap-2"><ScanFace className="w-4 h-4 text-indigo-400" /> Face enrollment required</div>
          <p>Your face is converted into a numeric template (128 numbers) and stored encrypted on the server. No photo or video is stored. HR or Admin can delete it at any time.</p>
          <label className="flex items-start gap-2 cursor-pointer"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5" />
            <span>I consent to the collection and storage of my face template for attendance verification.</span></label>
          <button disabled={!consent || !streamActive || !modelsReady} onClick={beginEnrollment} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white rounded-xl font-semibold">
            {!modelsReady ? 'Loading face models…' : !streamActive ? 'Waiting for camera…' : 'Start enrollment'}
          </button>
        </div>
      )}
      {enrolling && (
        <div className="p-4 bg-indigo-950/40 rounded-2xl border border-indigo-500/30 text-xs text-indigo-100 space-y-1">
          <div className="font-semibold">Step {Math.min(enrollStep + 1, ENROLL_STEPS.length)} of {ENROLL_STEPS.length}</div>
          <div>{enrollStep >= ENROLL_STEPS.length ? 'Please blink naturally to finish.' : hint || ENROLL_STEPS[enrollStep].text}</div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
        <div className="md:col-span-7 flex flex-col items-center">
          <div className="relative w-full aspect-[4/3] max-w-md bg-black rounded-2xl overflow-hidden border-2 border-slate-700 flex items-center justify-center">
            {cameraError ? (
              <div className="p-6 text-center space-y-2"><AlertTriangle className="w-10 h-10 text-amber-400 mx-auto" /><p className="text-xs text-slate-300">{cameraError}</p>
                <button onClick={startCamera} className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-xs">Retry Camera</button></div>
            ) : (
              <>
                <video ref={videoRef} playsInline muted className="w-full h-full object-cover -scale-x-100" />
                <canvas ref={scratchRef} className="hidden" />
                <canvas ref={overlayRef} className="absolute inset-0 w-full h-full pointer-events-none -scale-x-100" />
                <div className="absolute top-3 left-3 flex items-center gap-1.5 px-2.5 py-1 bg-black/60 rounded-lg text-[10px] font-medium text-slate-300">
                  <span className={`w-2 h-2 rounded-full ${oneFace ? 'bg-emerald-400 animate-pulse' : 'bg-red-400'}`} />
                  {!modelsReady ? 'Loading face models…' : oneFace ? '1 face detected' : (frame?.faceCount ?? 0) > 1 ? 'Multiple faces' : 'No face'}
                </div>
                {mode === 'attend' && (
                  <div className="absolute top-3 right-3 flex items-center gap-1.5 px-2.5 py-1 bg-black/60 rounded-lg text-[10px] font-medium">
                    <Eye className="w-3 h-3 text-indigo-400" />{live ? <span className="text-emerald-400">Blink verified</span> : <span className="text-amber-300 animate-pulse">Blink once</span>}
                  </div>
                )}
              </>
            )}
          </div>
          <div className="text-[11px] text-slate-400 text-center mt-2 flex items-center gap-1"><ShieldCheck className="w-3.5 h-3.5 text-emerald-400" /><span>Only a numeric template is kept; video never leaves your device.</span></div>
        </div>

        <div className="md:col-span-5 space-y-4">
          <div className="p-4 bg-slate-800/60 rounded-2xl border border-slate-700/60 space-y-3 text-xs">
            <div className="flex items-center justify-between"><span className="font-semibold text-white flex items-center gap-1.5"><MapPin className="w-4 h-4 text-emerald-400" /> GPS & Geofence</span>
              <button onClick={requestLocation} className="text-[10px] text-indigo-400 hover:text-indigo-300 flex items-center gap-1"><RefreshCw className="w-3 h-3" /> Refresh GPS</button></div>
            {gps ? (
              <div className="space-y-1.5 text-slate-300">
                <div className="flex justify-between"><span>GPS accuracy</span><span className={`font-mono ${gpsOk ? 'text-emerald-400' : 'text-amber-400'}`}>&plusmn;{gps.accuracy} m {gpsOk ? '(valid)' : '(>100 m limit)'}</span></div>
                <div className="flex justify-between"><span>Distance to office</span>
                  <span className={`font-mono font-bold ${distance !== null && distance <= radius ? 'text-emerald-400' : 'text-red-400'}`}>{distance ?? '?'} m / {radius} m</span></div>
                <p className="text-[10px] text-slate-500">Display only: the server makes the final geofence decision.</p>
              </div>
            ) : <p className="text-slate-400">{gpsError || (mode === 'attend' ? 'Locating you…' : 'GPS is needed for attendance, not for enrollment.')}</p>}
          </div>

          {mode === 'attend' && (
            <div className="p-4 bg-slate-800/60 rounded-2xl border border-slate-700/60 space-y-2 text-xs text-slate-400">
              <span className="font-semibold text-slate-300 block">Attendance checks</span>
              {row('Single face', oneFace, 'Passed', 'Pending')}
              {row('Liveness (blink)', live, 'Verified', timedOut ? 'Timed out' : 'Please blink')}
              {row('GPS accuracy', gpsOk, 'Valid', 'Waiting')}
              <div className="flex items-center justify-between"><span>Office hours</span><span className="text-slate-300">{settings?.office_start || '09:00'} (+{settings?.grace_minutes ?? 15} min)</span></div>
              <p className="text-[10px] text-slate-500 pt-1">Identity match is decided by the server when you press Check In.</p>
              {timedOut && <button onClick={resetLiveness} className="text-indigo-400 underline">Retry liveness</button>}
            </div>
          )}

          {mode === 'attend' && (
            <div className="grid grid-cols-2 gap-3">
              <button disabled={!canCheckIn} onClick={handleCheckIn} className="py-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white rounded-xl text-sm font-semibold flex items-center justify-center gap-2"><UserCheck className="w-4 h-4" />{submitting ? 'Verifying…' : 'Check In'}</button>
              <button disabled={submitting} onClick={handleCheckOut} className="py-3 bg-slate-700 hover:bg-slate-600 disabled:opacity-40 text-white rounded-xl text-sm font-semibold">Check Out</button>
            </div>
          )}
          {mode === 'attend' && status && (
            <div className="flex items-center justify-between text-[11px] text-slate-500">
              <span>Enrolled ({status.samples} samples){status.enrolled_at ? ` · ${new Date(status.enrolled_at).toLocaleDateString()}` : ''}</span>
              <button onClick={deleteMyFace} className="flex items-center gap-1 text-red-400 hover:text-red-300"><Trash2 className="w-3 h-3" /> Delete / re-enroll</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
