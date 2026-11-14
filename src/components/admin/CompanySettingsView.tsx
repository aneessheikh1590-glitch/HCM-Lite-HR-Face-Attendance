import React, { useState, useEffect } from 'react';
import { Settings, Building2, Clock, MapPin, Calendar, Megaphone, Plus, CheckCircle2, AlertCircle } from 'lucide-react';
import { apiRequest } from '../../lib/api.js';
import type { CompanySettings, Department, Designation, PublicHoliday, Announcement } from '../../types.js';

interface Props {
  userRole: 'admin' | 'hr';
}

export const CompanySettingsView: React.FC<Props> = ({ userRole }) => {
  const [settings, setSettings] = useState<CompanySettings | null>(null);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [designations, setDesignations] = useState<Designation[]>([]);
  const [holidays, setHolidays] = useState<PublicHoliday[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);

  // Settings Form State
  const [companyName, setCompanyName] = useState('');
  const [officeStart, setOfficeStart] = useState('09:00');
  const [graceMinutes, setGraceMinutes] = useState(15);
  const [halfDayHours, setHalfDayHours] = useState(5);
  const [officeLat, setOfficeLat] = useState('24.8607');
  const [officeLng, setOfficeLng] = useState('67.0011');
  const [radiusMeters, setRadiusMeters] = useState(150);
  const [latePenaltyRule, setLatePenaltyRule] = useState(true);

  // New Department Modal
  const [newDeptName, setNewDeptName] = useState('');
  const [newDeptCode, setNewDeptCode] = useState('');

  // New Holiday Form
  const [newHolidayName, setNewHolidayName] = useState('');
  const [newHolidayDate, setNewHolidayDate] = useState('');

  // Announcement Form
  const [annTitle, setAnnTitle] = useState('');
  const [annContent, setAnnContent] = useState('');
  const [annPriority, setAnnPriority] = useState<'normal' | 'urgent'>('normal');

  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const fetchData = async () => {
    try {
      const [s, depts, desList, hols, anns] = await Promise.all([
        apiRequest<CompanySettings>('/api/settings'),
        apiRequest<Department[]>('/api/organization/departments'),
        apiRequest<Designation[]>('/api/organization/designations'),
        apiRequest<PublicHoliday[]>('/api/organization/holidays'),
        apiRequest<Announcement[]>('/api/announcements'),
      ]);

      setSettings(s);
      setCompanyName(s.company_name || '');
      setOfficeStart(s.office_start || '09:00');
      setGraceMinutes(s.grace_minutes || 15);
      setHalfDayHours(s.half_day_hours || 5);
      setOfficeLat(s.office_lat?.toString() || '24.8607');
      setOfficeLng(s.office_lng?.toString() || '67.0011');
      setRadiusMeters(s.office_radius_meters || 150);
      setLatePenaltyRule(s.late_penalty_rule ?? true);

      setDepartments(depts);
      setDesignations(desList);
      setHolidays(hols);
      setAnnouncements(anns);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (userRole !== 'admin') return;

    setSaving(true);
    setFeedback(null);
    try {
      const res = await apiRequest('/api/settings', {
        method: 'PUT',
        body: JSON.stringify({
          company_name: companyName,
          office_start: officeStart,
          grace_minutes: Number(graceMinutes),
          half_day_hours: Number(halfDayHours),
          office_lat: parseFloat(officeLat),
          office_lng: parseFloat(officeLng),
          office_radius_meters: Number(radiusMeters),
          late_penalty_rule: latePenaltyRule,
        }),
      });
      setFeedback('Company settings updated and applied to future check-ins.');
      fetchData();
    } catch (err: any) {
      alert(err.message || 'Failed to update settings.');
    } finally {
      setSaving(false);
    }
  };

  const handleCreateDept = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDeptName || !newDeptCode) return;
    try {
      await apiRequest('/api/organization/departments', {
        method: 'POST',
        body: JSON.stringify({ name: newDeptName, code: newDeptCode }),
      });
      setNewDeptName('');
      setNewDeptCode('');
      fetchData();
    } catch (err: any) {
      alert(err.message || 'Failed to create department.');
    }
  };

  const handleCreateHoliday = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newHolidayName || !newHolidayDate) return;
    try {
      await apiRequest('/api/organization/holidays', {
        method: 'POST',
        body: JSON.stringify({ name: newHolidayName, date: newHolidayDate }),
      });
      setNewHolidayName('');
      setNewHolidayDate('');
      fetchData();
    } catch (err: any) {
      alert(err.message || 'Failed to add holiday.');
    }
  };

  const handlePostAnnouncement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!annTitle || !annContent) return;
    try {
      await apiRequest('/api/announcements', {
        method: 'POST',
        body: JSON.stringify({ title: annTitle, content: annContent, priority: annPriority }),
      });
      setAnnTitle('');
      setAnnContent('');
      setFeedback('Announcement broadcasted to all employee dashboards!');
      fetchData();
    } catch (err: any) {
      alert(err.message || 'Failed to post announcement.');
    }
  };

  return (
    <div className="space-y-6">
      
      {/* Top Header */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Settings className="w-5 h-5 text-indigo-400" /> Company Architecture & Shift Rules
          </h2>
          <p className="text-xs text-slate-400">
            Configure shift thresholds, GPS camera geofencing, leave quotas, departments, and broadcast notices.
          </p>
        </div>
        {userRole !== 'admin' && (
          <span className="text-xs px-3 py-1 bg-slate-800 text-amber-300 rounded-lg border border-slate-700">
            Read-only View (Admin manages)
          </span>
        )}
      </div>

      {feedback && (
        <div className="p-3 bg-emerald-950/60 border border-emerald-500/40 rounded-xl text-emerald-300 text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{feedback}</span>
        </div>
      )}

      {/* Main Settings Form */}
      <form onSubmit={handleSaveSettings} className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 space-y-6 shadow-xl">
        <h3 className="text-sm font-bold text-white flex items-center gap-2 border-b border-slate-800 pb-3">
          <Clock className="w-4 h-4 text-indigo-400" /> Shift Hours & Attendance Policies (Section 3 Rules)
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
          <div className="space-y-1">
            <label className="font-semibold text-slate-300">Company Name</label>
            <input
              type="text"
              disabled={userRole !== 'admin'}
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-white text-xs disabled:opacity-60"
            />
          </div>

          <div className="space-y-1">
            <label className="font-semibold text-slate-300">Office Start Time</label>
            <input
              type="time"
              disabled={userRole !== 'admin'}
              value={officeStart}
              onChange={(e) => setOfficeStart(e.target.value)}
              className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-white text-xs disabled:opacity-60"
            />
            <span className="text-[10px] text-slate-400">Default: 09:00</span>
          </div>

          <div className="space-y-1">
            <label className="font-semibold text-slate-300">Grace Period (Minutes)</label>
            <input
              type="number"
              disabled={userRole !== 'admin'}
              value={graceMinutes}
              onChange={(e) => setGraceMinutes(Number(e.target.value))}
              className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-white text-xs disabled:opacity-60"
            />
            <span className="text-[10px] text-slate-400">Late marked after 09:15</span>
          </div>

          <div className="space-y-1">
            <label className="font-semibold text-slate-300">Half-Day Limit (Hours)</label>
            <input
              type="number"
              disabled={userRole !== 'admin'}
              value={halfDayHours}
              onChange={(e) => setHalfDayHours(Number(e.target.value))}
              className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-white text-xs disabled:opacity-60"
            />
            <span className="text-[10px] text-slate-400">Shift under 5h = half_day</span>
          </div>
        </div>

        {/* Geolocation Geofence Config */}
        <div className="p-5 bg-slate-800/40 rounded-2xl border border-slate-700/60 space-y-4 text-xs">
          <div className="flex items-center justify-between">
            <span className="font-bold text-white flex items-center gap-1.5">
              <MapPin className="w-4 h-4 text-emerald-400" /> Camera Attendance GPS Geofence (Section 5)
            </span>
            <span className="text-[10px] text-slate-400">Haversine formula verified on server</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1">
              <label className="font-semibold text-slate-300">Office Latitude</label>
              <input
                type="text"
                disabled={userRole !== 'admin'}
                value={officeLat}
                onChange={(e) => setOfficeLat(e.target.value)}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-white text-xs font-mono"
              />
            </div>
            <div className="space-y-1">
              <label className="font-semibold text-slate-300">Office Longitude</label>
              <input
                type="text"
                disabled={userRole !== 'admin'}
                value={officeLng}
                onChange={(e) => setOfficeLng(e.target.value)}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-white text-xs font-mono"
              />
            </div>
            <div className="space-y-1">
              <label className="font-semibold text-slate-300 flex justify-between">
                <span>Geofence Radius</span>
                <span className="text-indigo-400 font-mono font-bold">{radiusMeters} meters</span>
              </label>
              <input
                type="range"
                min="50"
                max="500"
                step="10"
                disabled={userRole !== 'admin'}
                value={radiusMeters}
                onChange={(e) => setRadiusMeters(Number(e.target.value))}
                className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-500 mt-2"
              />
            </div>
          </div>

          <div className="flex items-center gap-2 pt-2">
            <input
              type="checkbox"
              id="latePenalty"
              checked={latePenaltyRule}
              onChange={(e) => setLatePenaltyRule(e.target.checked)}
              disabled={userRole !== 'admin'}
              className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 bg-slate-800 border-slate-700"
            />
            <label htmlFor="latePenalty" className="text-xs text-slate-300 font-medium">
              Enable Late Penalty Rule: <strong>3 lates in a month = 0.5 day salary deduction</strong> (Bonus rule)
            </label>
          </div>
        </div>

        {userRole === 'admin' && (
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold shadow transition disabled:opacity-50 cursor-pointer"
            >
              {saving ? 'Saving...' : 'Save Settings'}
            </button>
          </div>
        )}
      </form>

      {/* Departments, Holidays, Announcements Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        
        {/* Departments Manager */}
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 space-y-4">
          <h3 className="text-sm font-bold text-white flex items-center gap-2 border-b border-slate-800 pb-2">
            <Building2 className="w-4 h-4 text-indigo-400" /> Departments ({departments.length})
          </h3>

          <div className="space-y-2 max-h-48 overflow-y-auto">
            {departments.map((d) => (
              <div
                key={d.id}
                className="p-2.5 bg-slate-800/50 rounded-xl border border-slate-700/60 flex items-center justify-between text-xs"
              >
                <span className="font-semibold text-white">{d.name}</span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-700 text-slate-300">
                  {d.code}
                </span>
              </div>
            ))}
          </div>

          {userRole === 'admin' && (
            <form onSubmit={handleCreateDept} className="space-y-2 pt-2 border-t border-slate-800 text-xs">
              <input
                type="text"
                placeholder="Department Name"
                value={newDeptName}
                onChange={(e) => setNewDeptName(e.target.value)}
                className="w-full px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-xl text-white text-xs"
              />
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Code (e.g. FIN)"
                  value={newDeptCode}
                  onChange={(e) => setNewDeptCode(e.target.value)}
                  className="w-24 px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-xl text-white text-xs uppercase"
                />
                <button
                  type="submit"
                  className="flex-1 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold"
                >
                  Add Dept
                </button>
              </div>
            </form>
          )}
        </div>

        {/* Public Holidays Manager */}
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 space-y-4">
          <h3 className="text-sm font-bold text-white flex items-center gap-2 border-b border-slate-800 pb-2">
            <Calendar className="w-4 h-4 text-indigo-400" /> Public Holidays ({holidays.length})
          </h3>

          <div className="space-y-2 max-h-48 overflow-y-auto">
            {holidays.map((h) => (
              <div
                key={h.id}
                className="p-2.5 bg-slate-800/50 rounded-xl border border-slate-700/60 flex items-center justify-between text-xs"
              >
                <span className="font-semibold text-white">{h.name}</span>
                <span className="text-[10px] font-mono text-slate-400">{h.date}</span>
              </div>
            ))}
          </div>

          {userRole === 'admin' && (
            <form onSubmit={handleCreateHoliday} className="space-y-2 pt-2 border-t border-slate-800 text-xs">
              <input
                type="text"
                placeholder="Holiday Name"
                value={newHolidayName}
                onChange={(e) => setNewHolidayName(e.target.value)}
                className="w-full px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-xl text-white text-xs"
              />
              <div className="flex gap-2">
                <input
                  type="date"
                  value={newHolidayDate}
                  onChange={(e) => setNewHolidayDate(e.target.value)}
                  className="flex-1 px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-xl text-white text-xs"
                />
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold"
                >
                  Add
                </button>
              </div>
            </form>
          )}
        </div>

        {/* Announcements Broadcast */}
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 space-y-4">
          <h3 className="text-sm font-bold text-white flex items-center gap-2 border-b border-slate-800 pb-2">
            <Megaphone className="w-4 h-4 text-amber-400" /> Post Announcements
          </h3>

          <form onSubmit={handlePostAnnouncement} className="space-y-2 text-xs">
            <input
              type="text"
              required
              placeholder="Notice Title"
              value={annTitle}
              onChange={(e) => setAnnTitle(e.target.value)}
              className="w-full px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-xl text-white text-xs"
            />
            <textarea
              required
              rows={2}
              placeholder="Announcement text broadcasted to all users..."
              value={annContent}
              onChange={(e) => setAnnContent(e.target.value)}
              className="w-full px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-xl text-white text-xs"
            />
            <div className="flex items-center justify-between pt-1">
              <select
                value={annPriority}
                onChange={(e) => setAnnPriority(e.target.value as any)}
                className="px-2 py-1 bg-slate-800 border border-slate-700 rounded-lg text-white text-xs"
              >
                <option value="normal">Normal</option>
                <option value="urgent">Urgent Banner</option>
              </select>
              <button
                type="submit"
                className="px-4 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded-xl text-xs font-semibold shadow transition"
              >
                Broadcast Notice
              </button>
            </div>
          </form>
        </div>

      </div>

    </div>
  );
};
