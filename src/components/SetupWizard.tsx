import React, { useState } from 'react';
import { Building2, Shield, AlertCircle, ChevronRight, ChevronLeft, LocateFixed } from 'lucide-react';
import { apiRequest, setAuthToken } from '../lib/api.js';

interface Props {
  onSetupComplete: (user: any) => void;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const inputCls =
  'w-full px-3.5 py-2.5 bg-slate-800/80 border border-slate-700 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm';

export const SetupWizard: React.FC<Props> = ({ onSetupComplete }) => {
  const [step, setStep] = useState<1 | 2>(1);
  const [companyName, setCompanyName] = useState('');
  const [companyEmail, setCompanyEmail] = useState('');
  const [officeAddress, setOfficeAddress] = useState('');
  const [officeStart, setOfficeStart] = useState('09:00');
  const [grace, setGrace] = useState('15');
  const [weekend, setWeekend] = useState<number[]>([0, 6]);
  const [officeLat, setOfficeLat] = useState('');
  const [officeLng, setOfficeLng] = useState('');
  const [officeRadius, setOfficeRadius] = useState('150');

  const [adminName, setAdminName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const useMyLocation = () => {
    setError(null);
    if (!navigator.geolocation) return setError('Geolocation is not supported by this browser.');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setOfficeLat(pos.coords.latitude.toFixed(6));
        setOfficeLng(pos.coords.longitude.toFixed(6));
      },
      () => setError('Could not read your location. Enter latitude and longitude manually.'),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const validateStep1 = (): string | null => {
    if (!companyName.trim()) return 'Company name is required.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(companyEmail)) return 'A valid company email is required.';
    if (!officeAddress.trim()) return 'Office address is required.';
    if (!/^\d{2}:\d{2}$/.test(officeStart)) return 'Office start time is required.';
    const g = Number(grace);
    if (!Number.isInteger(g) || g < 0 || g > 120) return 'Grace period must be 0-120 minutes.';
    const lat = Number(officeLat), lng = Number(officeLng), r = Number(officeRadius);
    if (officeLat === '' || !Number.isFinite(lat) || lat < -90 || lat > 90) return 'Office latitude must be between -90 and 90.';
    if (officeLng === '' || !Number.isFinite(lng) || lng < -180 || lng > 180) return 'Office longitude must be between -180 and 180.';
    if (!Number.isFinite(r) || r < 10 || r > 5000) return 'Geofence radius must be between 10 and 5000 metres.';
    return null;
  };

  const validateStep2 = (): string | null => {
    if (!adminName.trim()) return 'Admin full name is required.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) return 'A valid work email is required.';
    if (adminPassword.length < 8 || !/[A-Za-z]/.test(adminPassword) || !/\d/.test(adminPassword))
      return 'Password must be at least 8 characters and contain letters and numbers.';
    if (adminPassword !== confirmPassword) return 'Passwords do not match.';
    return null;
  };

  const next = (e: React.FormEvent) => {
    e.preventDefault();
    const err = validateStep1();
    if (err) return setError(err);
    setError(null);
    setStep(2);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const err = validateStep1() || validateStep2();
    if (err) return setError(err);
    setError(null);
    setLoading(true);
    try {
      const res = await apiRequest<{ token: string; user: any }>('/api/system/setup', {
        method: 'POST',
        body: JSON.stringify({
          company_name: companyName.trim(),
          company_email: companyEmail.trim(),
          office_address: officeAddress.trim(),
          office_start: officeStart,
          grace_minutes: Number(grace),
          weekend_days: weekend,
          office_lat: Number(officeLat),
          office_lng: Number(officeLng),
          office_radius_meters: Number(officeRadius),
          admin_name: adminName.trim(),
          admin_email: adminEmail.trim(),
          admin_password: adminPassword,
        }),
      });
      setAuthToken(res.token);
      onSetupComplete(res.user);
    } catch (e2: any) {
      setError(e2.message || 'Setup failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col justify-center items-center p-4">
      <div className="relative w-full max-w-xl bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-10 shadow-2xl space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-indigo-600/20 border border-indigo-500/30 text-indigo-400">
            {step === 1 ? <Building2 className="w-7 h-7" /> : <Shield className="w-7 h-7" />}
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white">HCM Lite — First-Run Setup</h1>
          <p className="text-sm text-slate-400">
            Step {step} of 2: {step === 1 ? 'Create your company' : 'Create the initial Admin account'}. This screen is
            available only once, until the first Admin exists.
          </p>
        </div>

        {error && (
          <div role="alert" className="p-3 bg-red-950/50 border border-red-500/40 rounded-xl text-red-300 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {step === 1 ? (
          <form onSubmit={next} className="space-y-4 text-xs">
            <label className="block space-y-1"><span className="font-semibold text-slate-300">Company name</span>
              <input className={inputCls} value={companyName} onChange={(e) => setCompanyName(e.target.value)} required /></label>
            <label className="block space-y-1"><span className="font-semibold text-slate-300">Company email</span>
              <input type="email" className={inputCls} value={companyEmail} onChange={(e) => setCompanyEmail(e.target.value)} required /></label>
            <label className="block space-y-1"><span className="font-semibold text-slate-300">Office address</span>
              <input className={inputCls} value={officeAddress} onChange={(e) => setOfficeAddress(e.target.value)} required /></label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block space-y-1"><span className="font-semibold text-slate-300">Office start time</span>
                <input type="time" className={inputCls} value={officeStart} onChange={(e) => setOfficeStart(e.target.value)} required /></label>
              <label className="block space-y-1"><span className="font-semibold text-slate-300">Grace period (minutes)</span>
                <input type="number" min={0} max={120} className={inputCls} value={grace} onChange={(e) => setGrace(e.target.value)} required /></label>
            </div>
            <fieldset className="space-y-1">
              <legend className="font-semibold text-slate-300">Weekend days</legend>
              <div className="flex flex-wrap gap-2">
                {DAYS.map((d, i) => (
                  <label key={d} className={`px-3 py-1.5 rounded-lg border cursor-pointer ${weekend.includes(i) ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-300'}`}>
                    <input type="checkbox" className="sr-only" checked={weekend.includes(i)}
                      onChange={() => setWeekend((w) => (w.includes(i) ? w.filter((x) => x !== i) : [...w, i].sort()))} />
                    {d}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="grid grid-cols-2 gap-3">
              <label className="block space-y-1"><span className="font-semibold text-slate-300">Office latitude</span>
                <input inputMode="decimal" className={inputCls} value={officeLat} onChange={(e) => setOfficeLat(e.target.value)} required /></label>
              <label className="block space-y-1"><span className="font-semibold text-slate-300">Office longitude</span>
                <input inputMode="decimal" className={inputCls} value={officeLng} onChange={(e) => setOfficeLng(e.target.value)} required /></label>
            </div>
            <div className="flex items-end gap-3">
              <label className="block space-y-1 flex-1"><span className="font-semibold text-slate-300">Geofence radius (metres)</span>
                <input type="number" min={10} max={5000} className={inputCls} value={officeRadius} onChange={(e) => setOfficeRadius(e.target.value)} required /></label>
              <button type="button" onClick={useMyLocation} className="px-3 py-2.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 rounded-xl flex items-center gap-1.5">
                <LocateFixed className="w-4 h-4" /> Use my location
              </button>
            </div>
            <button type="submit" className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-semibold flex items-center justify-center gap-1">
              Next: Admin account <ChevronRight className="w-4 h-4" />
            </button>
          </form>
        ) : (
          <form onSubmit={submit} className="space-y-4 text-xs">
            <label className="block space-y-1"><span className="font-semibold text-slate-300">Full name</span>
              <input className={inputCls} value={adminName} onChange={(e) => setAdminName(e.target.value)} autoComplete="name" required /></label>
            <label className="block space-y-1"><span className="font-semibold text-slate-300">Work email</span>
              <input type="email" className={inputCls} value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} autoComplete="username" required /></label>
            <label className="block space-y-1"><span className="font-semibold text-slate-300">Password (min 8, letters + numbers)</span>
              <input type="password" className={inputCls} value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)} autoComplete="new-password" required /></label>
            <label className="block space-y-1"><span className="font-semibold text-slate-300">Confirm password</span>
              <input type="password" className={inputCls} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" required /></label>
            <div className="flex gap-3">
              <button type="button" onClick={() => { setError(null); setStep(1); }} className="px-4 py-3 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 rounded-xl flex items-center gap-1">
                <ChevronLeft className="w-4 h-4" /> Back
              </button>
              <button type="submit" disabled={loading} className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-xl font-semibold">
                {loading ? 'Creating…' : 'Create company & Admin'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
