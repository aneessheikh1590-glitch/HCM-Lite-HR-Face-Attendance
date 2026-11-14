import React, { useState, useEffect } from 'react';
import { Clock, Calendar, FileText, User, MapPin, Phone, Edit3, Check, Sparkles, AlertCircle, CheckCircle2 } from 'lucide-react';
import { apiRequest } from '../../lib/api.js';
import type { Employee, Announcement } from '../../types.js';

interface Props {
  employee: Employee;
  onNavigate: (tab: string) => void;
  onOpenAI: () => void;
}

export const EmployeeDashboard: React.FC<Props> = ({ employee, onNavigate, onOpenAI }) => {
  const [metrics, setMetrics] = useState<any>(null);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);

  // Edit phone/address
  const [editingProfile, setEditingProfile] = useState(false);
  const [phone, setPhone] = useState(employee.phone || '');
  const [address, setAddress] = useState(employee.address || '');
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileSuccess, setProfileSuccess] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const [m, a] = await Promise.all([
          apiRequest('/api/analytics/employee'),
          apiRequest<Announcement[]>('/api/announcements'),
        ]);
        setMetrics(m);
        setAnnouncements(a);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [employee.id]);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileSaving(true);
    setProfileSuccess(false);

    try {
      await apiRequest(`/api/employees/${employee.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ phone, address }),
      });
      setProfileSuccess(true);
      setEditingProfile(false);
    } catch (err: any) {
      alert(err.message || 'Could not update profile.');
    } finally {
      setProfileSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      
      {/* Welcome & Announcements Banner */}
      <div className="bg-gradient-to-r from-indigo-950/60 via-purple-950/40 to-slate-900 border border-indigo-500/30 rounded-3xl p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-xl">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 font-semibold border border-indigo-500/30">
              Employee Self-Service
            </span>
          </div>
          <h2 className="text-2xl font-bold text-white tracking-tight">
            Welcome back, {employee.first_name}!
          </h2>
          <p className="text-xs text-slate-300">
            Saylani IT Park Campus · Track attendance, manage leaves, and view verified payslips.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={() => onNavigate('face-attendance')}
            className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-emerald-600/30 transition cursor-pointer"
          >
            Mark Camera Check-In
          </button>
          <button
            onClick={onOpenAI}
            className="px-3.5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-medium border border-slate-700 transition flex items-center gap-1.5 cursor-pointer"
          >
            <Sparkles className="w-3.5 h-3.5 text-indigo-400" /> Ask AI
          </button>
        </div>
      </div>

      {/* Announcements */}
      {announcements.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex items-start gap-3">
          <span className="text-xs font-bold uppercase tracking-wider text-amber-400 bg-amber-500/10 px-2.5 py-1 rounded-lg border border-amber-500/20 shrink-0">
            Notice
          </span>
          <div className="text-xs">
            <span className="font-semibold text-white">{announcements[0].title}: </span>
            <span className="text-slate-300">{announcements[0].content}</span>
          </div>
        </div>
      )}

      {/* KPI Cards (Section 7) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        
        {/* Today's Status */}
        <div className="p-5 bg-slate-900 border border-slate-800 rounded-3xl space-y-2">
          <span className="text-xs text-slate-400 font-medium">Today's Attendance</span>
          <div className="flex items-center gap-2">
            <div
              className={`w-3 h-3 rounded-full ${
                metrics?.todayAttendance ? 'bg-emerald-400' : 'bg-slate-600'
              }`}
            />
            <span className="text-lg font-bold text-white capitalize">
              {metrics?.todayAttendance ? metrics.todayAttendance.status : 'Not Checked In'}
            </span>
          </div>
          <span className="text-[11px] text-slate-400 block">
            {metrics?.todayAttendance?.check_in
              ? `In at ${new Date(metrics.todayAttendance.check_in).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}`
              : 'Use camera to mark today'}
          </span>
        </div>

        {/* Weekly Hours vs 40h */}
        <div className="p-5 bg-slate-900 border border-slate-800 rounded-3xl space-y-2">
          <span className="text-xs text-slate-400 font-medium">Weekly Hours</span>
          <div className="text-2xl font-bold text-white font-mono">
            {metrics?.hoursThisWeek ?? 0} <span className="text-xs text-slate-400 font-normal">/ 40 hrs</span>
          </div>
          <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
            <div
              className="bg-indigo-500 h-full rounded-full transition-all"
              style={{ width: `${Math.min(100, ((metrics?.hoursThisWeek || 0) / 40) * 100)}%` }}
            />
          </div>
        </div>

        {/* Late Arrivals Count */}
        <div className="p-5 bg-slate-900 border border-slate-800 rounded-3xl space-y-2">
          <span className="text-xs text-slate-400 font-medium">Late Arrivals (This Month)</span>
          <div className="text-2xl font-bold text-amber-400 font-mono">
            {metrics?.lateCountThisMonth ?? 0}
          </div>
          <span className="text-[11px] text-slate-400 block">
            Rule: 3 lates = 0.5 day deduction
          </span>
        </div>

        {/* Leave Balance Available */}
        <div className="p-5 bg-slate-900 border border-slate-800 rounded-3xl space-y-2">
          <span className="text-xs text-slate-400 font-medium">Leave Remaining</span>
          <div className="text-2xl font-bold text-emerald-400 font-mono">
            {metrics?.leaveBalance
              ? metrics.leaveBalance.annual.remaining +
                metrics.leaveBalance.sick.remaining +
                metrics.leaveBalance.casual.remaining
              : '--'} <span className="text-xs text-slate-400 font-normal">days</span>
          </div>
          <span className="text-[11px] text-slate-400 block">
            {metrics?.leaveBalance ? `${metrics.leaveBalance.sick.remaining} sick, ${metrics.leaveBalance.casual.remaining} casual` : ''}
          </span>
        </div>

      </div>

      {/* Profile & Contact Details (Editable by employee per Section 2) */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <User className="w-4 h-4 text-indigo-400" /> My Profile & Contact Information
            </h3>
            <p className="text-xs text-slate-400">
              Per Section 2 rules, employees can view own profile and update phone number & home address.
            </p>
          </div>
          <button
            onClick={() => setEditingProfile(!editingProfile)}
            className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1 font-semibold"
          >
            <Edit3 className="w-3.5 h-3.5" />
            {editingProfile ? 'Cancel' : 'Edit Contact'}
          </button>
        </div>

        {profileSuccess && (
          <div className="p-2.5 bg-emerald-950/50 border border-emerald-500/30 text-emerald-300 rounded-xl text-xs flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4" /> Contact details updated successfully!
          </div>
        )}

        {editingProfile ? (
          <form onSubmit={handleSaveProfile} className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div className="space-y-1">
              <label className="font-semibold text-slate-300 flex items-center gap-1.5">
                <Phone className="w-3.5 h-3.5 text-slate-400" /> Mobile Phone
              </label>
              <input
                type="text"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+92 300 1234567"
                className="w-full px-3.5 py-2 bg-slate-800 border border-slate-700 rounded-xl text-white text-xs"
              />
            </div>
            <div className="space-y-1">
              <label className="font-semibold text-slate-300 flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-slate-400" /> Home Address
              </label>
              <input
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Residential Address"
                className="w-full px-3.5 py-2 bg-slate-800 border border-slate-700 rounded-xl text-white text-xs"
              />
            </div>
            <div className="sm:col-span-2 flex justify-end">
              <button
                type="submit"
                disabled={profileSaving}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold shadow transition"
              >
                {profileSaving ? 'Saving...' : 'Save Updates'}
              </button>
            </div>
          </form>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
            <div>
              <span className="text-slate-400 block">Employee Code</span>
              <span className="text-white font-mono font-semibold">{employee.code}</span>
            </div>
            <div>
              <span className="text-slate-400 block">Work Email</span>
              <span className="text-white font-mono">{employee.email}</span>
            </div>
            <div>
              <span className="text-slate-400 block">Phone</span>
              <span className="text-white">{phone || 'Not set'}</span>
            </div>
            <div>
              <span className="text-slate-400 block">Address</span>
              <span className="text-white truncate block">{address || 'Not set'}</span>
            </div>
          </div>
        )}
      </div>

    </div>
  );
};
