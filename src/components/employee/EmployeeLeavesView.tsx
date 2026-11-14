import React, { useState, useEffect } from 'react';
import { Calendar, Sparkles, AlertCircle, CheckCircle2, Clock, Send, XCircle } from 'lucide-react';
import { apiRequest } from '../../lib/api.js';
import type { LeaveBalance, LeaveRequest, LeaveType } from '../../types.js';

interface Props {
  employeeId: string;
}

export const EmployeeLeavesView: React.FC<Props> = ({ employeeId }) => {
  const [balance, setBalance] = useState<LeaveBalance | null>(null);
  const [leaves, setLeaves] = useState<LeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);

  // Smart leave state
  const [smartPrompt, setSmartPrompt] = useState('Need next Monday and Tuesday off for my sister’s wedding');
  const [smartParsing, setSmartParsing] = useState(false);

  // Form state
  const [leaveType, setLeaveType] = useState<LeaveType>('casual');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reason, setReason] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [bal, list] = await Promise.all([
        apiRequest<LeaveBalance>(`/api/leaves/balance?employee_id=${employeeId}`),
        apiRequest<LeaveRequest[]>('/api/leaves'),
      ]);
      setBalance(bal);
      setLeaves(list);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch leave records.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [employeeId]);

  // AI Smart Leave parser
  const handleParseSmartLeave = async () => {
    if (!smartPrompt.trim()) return;
    setSmartParsing(true);
    setError(null);

    try {
      const res = await apiRequest<{ parsed: { leave_type: LeaveType; start_date: string; end_date: string; reason: string } }>(
        '/api/ai/smart-leave',
        {
          method: 'POST',
          body: JSON.stringify({ prompt: smartPrompt }),
        }
      );

      if (res.parsed) {
        setLeaveType(res.parsed.leave_type || 'casual');
        setStartDate(res.parsed.start_date || '');
        setEndDate(res.parsed.end_date || '');
        setReason(res.parsed.reason || smartPrompt);
        setSuccess('AI extracted leave details and pre-filled the form! Please review and confirm.');
      }
    } catch (err: any) {
      setError('Could not parse smart leave sentence. You can fill out the form manually.');
    } finally {
      setSmartParsing(false);
    }
  };

  // Submit Leave
  const handleApply = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setSubmitting(true);

    try {
      await apiRequest('/api/leaves', {
        method: 'POST',
        body: JSON.stringify({
          employee_id: employeeId,
          leave_type: leaveType,
          start_date: startDate,
          end_date: endDate,
          reason,
        }),
      });

      setSuccess('Leave request submitted successfully for HR approval!');
      setReason('');
      fetchData();
    } catch (err: any) {
      setError(err.message || 'Failed to apply for leave.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancelLeave = async (leaveId: string) => {
    if (!confirm('Are you sure you want to cancel this leave request?')) return;
    try {
      await apiRequest(`/api/leaves/${leaveId}/cancel`, { method: 'PATCH' });
      fetchData();
    } catch (err: any) {
      alert(err.message || 'Could not cancel leave.');
    }
  };

  return (
    <div className="space-y-6">
      
      {/* Leave Balances Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-4 bg-slate-900 border border-slate-800 rounded-2xl">
          <span className="text-xs text-slate-400 block">Annual Leave</span>
          <div className="text-2xl font-bold text-white mt-1">
            {balance ? balance.annual.remaining : '--'} <span className="text-xs text-slate-400 font-normal">/ {balance?.annual.total} left</span>
          </div>
          <span className="text-[11px] text-indigo-400 mt-1 block">Used: {balance?.annual.used} days</span>
        </div>

        <div className="p-4 bg-slate-900 border border-slate-800 rounded-2xl">
          <span className="text-xs text-slate-400 block">Sick Leave</span>
          <div className="text-2xl font-bold text-white mt-1">
            {balance ? balance.sick.remaining : '--'} <span className="text-xs text-slate-400 font-normal">/ {balance?.sick.total} left</span>
          </div>
          <span className="text-[11px] text-emerald-400 mt-1 block">Used: {balance?.sick.used} days</span>
        </div>

        <div className="p-4 bg-slate-900 border border-slate-800 rounded-2xl">
          <span className="text-xs text-slate-400 block">Casual Leave</span>
          <div className="text-2xl font-bold text-white mt-1">
            {balance ? balance.casual.remaining : '--'} <span className="text-xs text-slate-400 font-normal">/ {balance?.casual.total} left</span>
          </div>
          <span className="text-[11px] text-amber-400 mt-1 block">Used: {balance?.casual.used} days</span>
        </div>

        <div className="p-4 bg-slate-900 border border-slate-800 rounded-2xl">
          <span className="text-xs text-slate-400 block">Unpaid Leave</span>
          <div className="text-2xl font-bold text-white mt-1">
            {balance ? balance.unpaid.used : '--'} <span className="text-xs text-slate-400 font-normal">days used</span>
          </div>
          <span className="text-[11px] text-slate-400 mt-1 block">Unlimited quota</span>
        </div>
      </div>

      {/* Smart Leave AI Input Card */}
      <div className="p-6 bg-gradient-to-r from-indigo-950/40 via-purple-950/30 to-slate-900 border border-indigo-500/30 rounded-3xl space-y-3 shadow-lg">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-indigo-600/30 text-indigo-400">
            <Sparkles className="w-4 h-4" />
          </div>
          <h3 className="text-sm font-bold text-white">Smart Leave (AI Plain Words)</h3>
          <span className="text-[10px] px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 font-medium">
            English / Roman Urdu
          </span>
        </div>
        <p className="text-xs text-slate-300">
          Describe your leave request in everyday words. The AI will calculate the dates, identify the leave category, and pre-fill your form.
        </p>
        <div className="flex flex-col sm:flex-row items-center gap-2">
          <input
            type="text"
            value={smartPrompt}
            onChange={(e) => setSmartPrompt(e.target.value)}
            placeholder="e.g. Need next Monday and Tuesday off for my sister's wedding"
            className="flex-1 w-full px-4 py-2.5 bg-slate-900/90 border border-indigo-500/40 rounded-xl text-white text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <button
            type="button"
            onClick={handleParseSmartLeave}
            disabled={smartParsing}
            className="w-full sm:w-auto px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold shadow transition disabled:opacity-50 flex items-center justify-center gap-1.5 shrink-0 cursor-pointer"
          >
            <Sparkles className="w-3.5 h-3.5" />
            {smartParsing ? 'Analyzing...' : 'Parse & Pre-fill Form'}
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3 bg-red-950/60 border border-red-500/40 rounded-xl text-red-300 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {success && (
        <div className="p-3 bg-emerald-950/60 border border-emerald-500/40 rounded-xl text-emerald-300 text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{success}</span>
        </div>
      )}

      {/* Main Grid: Application Form & History */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Form */}
        <div className="lg:col-span-5 bg-slate-900 border border-slate-800 rounded-3xl p-6 space-y-4">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <Calendar className="w-4 h-4 text-indigo-400" /> Apply for Leave
          </h3>

          <form onSubmit={handleApply} className="space-y-3 text-xs">
            <div className="space-y-1">
              <label className="font-semibold text-slate-300">Leave Type</label>
              <select
                value={leaveType}
                onChange={(e) => setLeaveType(e.target.value as LeaveType)}
                className="w-full px-3.5 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-white text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="annual">Annual Leave ({balance?.annual.remaining || 0} remaining)</option>
                <option value="sick">Sick Leave ({balance?.sick.remaining || 0} remaining)</option>
                <option value="casual">Casual Leave ({balance?.casual.remaining || 0} remaining)</option>
                <option value="unpaid">Unpaid Leave (Unlimited)</option>
              </select>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="font-semibold text-slate-300">Start Date</label>
                <input
                  type="date"
                  required
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full px-3.5 py-2 bg-slate-800 border border-slate-700 rounded-xl text-white text-xs"
                />
              </div>
              <div className="space-y-1">
                <label className="font-semibold text-slate-300">End Date</label>
                <input
                  type="date"
                  required
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full px-3.5 py-2 bg-slate-800 border border-slate-700 rounded-xl text-white text-xs"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="font-semibold text-slate-300">Reason</label>
              <textarea
                required
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Reason for absence..."
                className="w-full px-3.5 py-2 bg-slate-800 border border-slate-700 rounded-xl text-white text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <span className="text-[10px] text-slate-400 block">
              Note: System automatically skips weekends and official holidays when calculating days.
            </span>

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold shadow transition disabled:opacity-50 cursor-pointer"
            >
              {submitting ? 'Submitting Request...' : 'Submit Leave for Approval'}
            </button>
          </form>
        </div>

        {/* History */}
        <div className="lg:col-span-7 bg-slate-900 border border-slate-800 rounded-3xl p-6 space-y-4">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <Clock className="w-4 h-4 text-indigo-400" /> My Leave Requests
          </h3>

          {leaves.length === 0 ? (
            <p className="text-xs text-slate-400 py-6 text-center">No leave requests submitted yet.</p>
          ) : (
            <div className="space-y-2 overflow-y-auto max-h-96">
              {leaves.map((l) => (
                <div
                  key={l.id}
                  className="p-3 bg-slate-800/60 border border-slate-700/60 rounded-xl flex items-center justify-between text-xs"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-white uppercase text-[10px] px-2 py-0.5 rounded bg-slate-700">
                        {l.leave_type}
                      </span>
                      <span className="text-slate-300">
                        {l.start_date} &rarr; {l.end_date} ({l.working_days} working days)
                      </span>
                    </div>
                    <p className="text-slate-400 text-[11px] italic">"{l.reason}"</p>
                    {l.review_comment && (
                      <p className="text-[10px] text-indigo-300">HR Comment: {l.review_comment}</p>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className={`text-[10px] font-semibold px-2 py-1 rounded-full uppercase ${
                        l.status === 'approved'
                          ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                          : l.status === 'pending'
                          ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                          : l.status === 'rejected'
                          ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                          : 'bg-slate-700 text-slate-400'
                      }`}
                    >
                      {l.status}
                    </span>

                    {l.status === 'pending' && (
                      <button
                        onClick={() => handleCancelLeave(l.id)}
                        className="p-1 text-slate-400 hover:text-red-400 transition"
                        title="Cancel Request"
                      >
                        <XCircle className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>

    </div>
  );
};
