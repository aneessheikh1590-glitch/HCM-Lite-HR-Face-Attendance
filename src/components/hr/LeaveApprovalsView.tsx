import React, { useState, useEffect } from 'react';
import { Calendar, CheckCircle2, XCircle, Clock, AlertCircle, MessageSquare } from 'lucide-react';
import { apiRequest } from '../../lib/api.js';
import type { LeaveRequest } from '../../types.js';

export const LeaveApprovalsView: React.FC = () => {
  const [leaves, setLeaves] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeLeave, setActiveLeave] = useState<any | null>(null);
  const [reviewComment, setReviewComment] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const fetchLeaves = async () => {
    try {
      setLoading(true);
      const data = await apiRequest<any[]>('/api/leaves');
      setLeaves(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLeaves();
  }, []);

  const handleDecision = async (status: 'approved' | 'rejected') => {
    if (!activeLeave) return;
    setSubmitting(true);
    try {
      await apiRequest(`/api/leaves/${activeLeave.id}/decision`, {
        method: 'PATCH',
        body: JSON.stringify({ status, review_comment: reviewComment }),
      });
      setActiveLeave(null);
      setReviewComment('');
      fetchLeaves();
    } catch (err: any) {
      alert(err.message || 'Decision failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const pendingLeaves = leaves.filter((l) => l.status === 'pending');
  const pastLeaves = leaves.filter((l) => l.status !== 'pending');

  return (
    <div className="space-y-6">
      
      {/* Header */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Calendar className="w-5 h-5 text-indigo-400" /> Leave Requests & Approvals Inbox
          </h2>
          <p className="text-xs text-slate-400">
            Review pending leave submissions, verify working days quotas, and provide comments.
          </p>
        </div>
        <span className="text-xs px-3 py-1.5 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 font-semibold font-mono">
          {pendingLeaves.length} Pending Actions
        </span>
      </div>

      {/* Pending Requests Grid */}
      <div className="space-y-3">
        <h3 className="text-sm font-bold text-white flex items-center gap-2">
          <Clock className="w-4 h-4 text-amber-400" /> Pending Approvals
        </h3>

        {pendingLeaves.length === 0 ? (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center text-xs text-slate-500">
            No pending leave requests in inbox.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {pendingLeaves.map((l) => (
              <div
                key={l.id}
                className="bg-slate-900 border border-slate-800 hover:border-slate-700 transition rounded-3xl p-5 space-y-4 shadow-xl"
              >
                <div className="flex items-start justify-between border-b border-slate-800 pb-3">
                  <div>
                    <h4 className="font-bold text-white text-sm">
                      {l.employee_name} <span className="font-mono text-slate-400 text-xs">({l.employee_code})</span>
                    </h4>
                    <span className="text-[11px] text-slate-400">{l.department_name}</span>
                  </div>
                  <span className="text-[10px] font-bold uppercase px-2.5 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                    {l.leave_type}
                  </span>
                </div>

                <div className="bg-slate-950/50 p-3 rounded-2xl border border-slate-800/80 space-y-1 text-xs">
                  <div className="text-slate-300">
                    <span className="text-slate-500">Dates: </span>
                    <span className="font-semibold text-white">{l.start_date}</span> to{' '}
                    <span className="font-semibold text-white">{l.end_date}</span> ({l.working_days} working days)
                  </div>
                  <div className="text-slate-400 italic text-[11px]">
                    "{l.reason}"
                  </div>
                </div>

                <button
                  onClick={() => {
                    setActiveLeave(l);
                    setReviewComment('');
                  }}
                  className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold shadow transition cursor-pointer"
                >
                  Review & Decide
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Past Decisions Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-xl">
        <div className="p-4 border-b border-slate-800">
          <h3 className="text-sm font-bold text-white">Recent Decisions History</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-800/80 text-slate-400 font-semibold border-b border-slate-800">
              <tr>
                <th className="p-3.5">Employee</th>
                <th className="p-3.5">Type</th>
                <th className="p-3.5">Date Span</th>
                <th className="p-3.5">Days</th>
                <th className="p-3.5">Reason</th>
                <th className="p-3.5">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-slate-300">
              {pastLeaves.map((l) => (
                <tr key={l.id} className="hover:bg-slate-800/40 transition">
                  <td className="p-3.5 font-semibold text-white">{l.employee_name}</td>
                  <td className="p-3.5 uppercase font-medium text-[11px] text-slate-300">{l.leave_type}</td>
                  <td className="p-3.5 font-mono text-slate-300">
                    {l.start_date} &rarr; {l.end_date}
                  </td>
                  <td className="p-3.5 font-semibold text-white">{l.working_days}</td>
                  <td className="p-3.5 text-slate-400 italic max-w-xs truncate">"{l.reason}"</td>
                  <td className="p-3.5">
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${
                        l.status === 'approved'
                          ? 'bg-emerald-500/20 text-emerald-400'
                          : l.status === 'rejected'
                          ? 'bg-red-500/20 text-red-400'
                          : 'bg-slate-700 text-slate-400'
                      }`}
                    >
                      {l.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Decision Modal */}
      {activeLeave && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-3xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <h3 className="text-base font-bold text-white">Review Leave Application</h3>
            <div className="p-3 bg-slate-800 rounded-xl space-y-1 text-xs text-slate-300">
              <div>
                <strong>Applicant:</strong> {activeLeave.employee_name} ({activeLeave.employee_code})
              </div>
              <div>
                <strong>Category:</strong> {activeLeave.leave_type.toUpperCase()} ({activeLeave.working_days} working days)
              </div>
              <div>
                <strong>Date Range:</strong> {activeLeave.start_date} to {activeLeave.end_date}
              </div>
              <div>
                <strong>Reason:</strong> "{activeLeave.reason}"
              </div>
            </div>

            <div className="space-y-1 text-xs">
              <label className="font-semibold text-slate-300">HR Review Comment</label>
              <textarea
                rows={2}
                value={reviewComment}
                onChange={(e) => setReviewComment(e.target.value)}
                placeholder="Optional decision note for the employee..."
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-white text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setActiveLeave(null)}
                className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => handleDecision('rejected')}
                className="px-3.5 py-2 bg-red-600/80 hover:bg-red-600 text-white rounded-xl text-xs font-semibold"
              >
                Reject Request
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => handleDecision('approved')}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-semibold shadow"
              >
                Approve Leave
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
