import React, { useState, useEffect } from 'react';
import { Calendar, Clock, AlertTriangle, CheckCircle2, Plus, MessageSquare } from 'lucide-react';
import { apiRequest } from '../../lib/api.js';
import type { Attendance, AttendanceCorrection } from '../../types.js';

interface Props {
  employeeId: string;
}

export const AttendanceHistoryView: React.FC<Props> = ({ employeeId }) => {
  const [records, setRecords] = useState<Attendance[]>([]);
  const [corrections, setCorrections] = useState<AttendanceCorrection[]>([]);
  const [loading, setLoading] = useState(true);

  // Correction Modal
  const [showModal, setShowModal] = useState(false);
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [requestedCheckIn, setRequestedCheckIn] = useState('09:00');
  const [requestedCheckOut, setRequestedCheckOut] = useState('17:30');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [atts, corrs] = await Promise.all([
        apiRequest<Attendance[]>('/api/attendance'),
        apiRequest<AttendanceCorrection[]>('/api/attendance/corrections'),
      ]);
      setRecords(atts);
      setCorrections(corrs);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [employeeId]);

  const handleSubmitCorrection = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setFeedback(null);

    try {
      const isoCheckIn = `${date}T${requestedCheckIn}:00.000Z`;
      const isoCheckOut = `${date}T${requestedCheckOut}:00.000Z`;

      await apiRequest('/api/attendance/corrections', {
        method: 'POST',
        body: JSON.stringify({
          date,
          requested_check_in: isoCheckIn,
          requested_check_out: isoCheckOut,
          reason,
        }),
      });

      setFeedback('Correction request sent to HR for review!');
      setReason('');
      setShowModal(false);
      fetchData();
    } catch (err: any) {
      alert(err.message || 'Failed to submit correction.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-900 border border-slate-800 p-6 rounded-3xl">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Clock className="w-5 h-5 text-indigo-400" /> Attendance History & Logs
          </h2>
          <p className="text-xs text-slate-400">
            View daily timestamps, hours worked, late flags, and submit correction requests for HR review.
          </p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold shadow transition flex items-center gap-1.5 self-start sm:self-auto cursor-pointer"
        >
          <Plus className="w-4 h-4" /> Request Correction
        </button>
      </div>

      {feedback && (
        <div className="p-3 bg-emerald-950/60 border border-emerald-500/40 rounded-xl text-emerald-300 text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{feedback}</span>
        </div>
      )}

      {/* Attendance Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-xl">
        <div className="p-4 border-b border-slate-800">
          <h3 className="text-sm font-bold text-white">Daily Attendance Records</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-800/80 text-slate-400 font-semibold border-b border-slate-800">
              <tr>
                <th className="p-3.5">Date</th>
                <th className="p-3.5">Check In</th>
                <th className="p-3.5">Check Out</th>
                <th className="p-3.5">Hours</th>
                <th className="p-3.5">Source</th>
                <th className="p-3.5">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-slate-300">
              {records.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-6 text-center text-slate-500">
                    No attendance records logged yet.
                  </td>
                </tr>
              ) : (
                records.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-800/40 transition">
                    <td className="p-3.5 font-medium text-white">{r.date}</td>
                    <td className="p-3.5 font-mono text-slate-300">
                      {new Date(r.check_in).toLocaleTimeString()}
                    </td>
                    <td className="p-3.5 font-mono text-slate-300">
                      {r.check_out ? new Date(r.check_out).toLocaleTimeString() : <span className="text-amber-400/80 italic">Active</span>}
                    </td>
                    <td className="p-3.5 font-semibold text-slate-200">
                      {r.total_hours ? `${r.total_hours} hrs` : '--'}
                    </td>
                    <td className="p-3.5 uppercase text-[10px] text-slate-400 font-medium">
                      {r.source}
                    </td>
                    <td className="p-3.5">
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${
                          r.status === 'present'
                            ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                            : r.status === 'late'
                            ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                            : r.status === 'half_day'
                            ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30'
                            : 'bg-red-500/20 text-red-400 border border-red-500/30'
                        }`}
                      >
                        {r.status}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Submitted Corrections */}
      {corrections.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 space-y-3">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-indigo-400" /> Submitted Correction Requests
          </h3>
          <div className="space-y-2">
            {corrections.map((c) => (
              <div
                key={c.id}
                className="p-3 bg-slate-800/50 border border-slate-700/60 rounded-xl flex items-center justify-between text-xs"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-white">{c.date}</span>
                    <span className="text-slate-400 text-[11px]">
                      Requested: {new Date(c.requested_check_in).toLocaleTimeString()}
                    </span>
                  </div>
                  <p className="text-slate-400 text-[11px] mt-0.5 italic">"{c.reason}"</p>
                  {c.review_comment && (
                    <p className="text-[10px] text-indigo-300 mt-0.5">HR: {c.review_comment}</p>
                  )}
                </div>
                <span
                  className={`text-[10px] font-bold px-2.5 py-1 rounded-full uppercase ${
                    c.status === 'approved'
                      ? 'bg-emerald-500/20 text-emerald-400'
                      : c.status === 'rejected'
                      ? 'bg-red-500/20 text-red-400'
                      : 'bg-amber-500/20 text-amber-400'
                  }`}
                >
                  {c.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Request Correction Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-3xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <h3 className="text-base font-bold text-white">Request Attendance Correction</h3>
            <p className="text-xs text-slate-400">
              Submit your actual check-in/out times along with an explanation for HR review.
            </p>

            <form onSubmit={handleSubmitCorrection} className="space-y-3 text-xs">
              <div className="space-y-1">
                <label className="font-semibold text-slate-300">Date of Incident</label>
                <input
                  type="date"
                  required
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-white text-xs"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="font-semibold text-slate-300">Actual Check In</label>
                  <input
                    type="time"
                    required
                    value={requestedCheckIn}
                    onChange={(e) => setRequestedCheckIn(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-white text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-semibold text-slate-300">Actual Check Out</label>
                  <input
                    type="time"
                    value={requestedCheckOut}
                    onChange={(e) => setRequestedCheckOut(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-white text-xs"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-slate-300">Reason / Explanation</label>
                <textarea
                  required
                  rows={3}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. Device camera glitch during morning check-in..."
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-white text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold shadow transition disabled:opacity-50"
                >
                  {submitting ? 'Submitting...' : 'Submit to HR'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
