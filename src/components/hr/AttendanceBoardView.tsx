import React, { useState, useEffect } from 'react';
import { Calendar, Clock, CheckCircle2, XCircle, Search, Filter, Camera, MapPin, AlertTriangle } from 'lucide-react';
import { apiRequest } from '../../lib/api.js';
import type { Attendance, AttendanceCorrection } from '../../types.js';

export const AttendanceBoardView: React.FC = () => {
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [attendanceList, setAttendanceList] = useState<any[]>([]);
  const [corrections, setCorrections] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Review modal
  const [activeCorrection, setActiveCorrection] = useState<any | null>(null);
  const [reviewComment, setReviewComment] = useState('');
  const [reviewing, setReviewing] = useState(false);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [atts, corrs] = await Promise.all([
        apiRequest<any[]>(`/api/attendance?date=${selectedDate}`),
        apiRequest<any[]>('/api/attendance/corrections'),
      ]);
      setAttendanceList(atts);
      setCorrections(corrs);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [selectedDate]);

  const handleDecision = async (status: 'approved' | 'rejected') => {
    if (!activeCorrection) return;
    setReviewing(true);
    try {
      await apiRequest(`/api/attendance/corrections/${activeCorrection.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status, review_comment: reviewComment }),
      });
      setActiveCorrection(null);
      setReviewComment('');
      fetchData();
    } catch (err: any) {
      alert(err.message || 'Decision submission failed.');
    } finally {
      setReviewing(false);
    }
  };

  const pendingCorrections = corrections.filter((c) => c.status === 'pending');

  return (
    <div className="space-y-6">
      
      {/* Top Header & Date Filter */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Clock className="w-5 h-5 text-indigo-400" /> Daily Attendance Board & Corrections
          </h2>
          <p className="text-xs text-slate-400">
            Real-time daily roster, check-in timestamps, GPS distances, and pending employee correction approvals.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-400 font-medium">Select Date:</label>
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="px-3.5 py-2 bg-slate-800 border border-slate-700 rounded-xl text-white text-xs font-mono"
          />
        </div>
      </div>

      {/* Pending Corrections Callout */}
      {pendingCorrections.length > 0 && (
        <div className="bg-amber-950/40 border border-amber-500/30 rounded-3xl p-6 space-y-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400" />
            <h3 className="text-sm font-bold text-amber-300">
              Pending Attendance Corrections ({pendingCorrections.length} awaiting HR review)
            </h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {pendingCorrections.map((c) => (
              <div
                key={c.id}
                className="p-4 bg-slate-900/80 rounded-2xl border border-slate-800 flex items-center justify-between text-xs"
              >
                <div>
                  <span className="font-semibold text-white block">
                    {c.employee_name} ({c.employee_code})
                  </span>
                  <span className="text-slate-400 text-[11px] block">
                    Date: {c.date} | Requested In: {new Date(c.requested_check_in).toLocaleTimeString()}
                  </span>
                  <p className="text-slate-300 italic text-[11px] mt-1">"{c.reason}"</p>
                </div>
                <button
                  onClick={() => {
                    setActiveCorrection(c);
                    setReviewComment('');
                  }}
                  className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold shrink-0 cursor-pointer"
                >
                  Review
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Attendance Board Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-xl">
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
          <h3 className="text-sm font-bold text-white">Daily Roster — {selectedDate}</h3>
          <span className="text-xs text-slate-400">{attendanceList.length} logs recorded</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-800/80 text-slate-400 font-semibold border-b border-slate-800">
              <tr>
                <th className="p-3.5">Employee</th>
                <th className="p-3.5">Department</th>
                <th className="p-3.5">Check In</th>
                <th className="p-3.5">Check Out</th>
                <th className="p-3.5">Hours</th>
                <th className="p-3.5">Source & GPS</th>
                <th className="p-3.5">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-slate-300">
              {attendanceList.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-slate-500">
                    No attendance records logged for {selectedDate}.
                  </td>
                </tr>
              ) : (
                attendanceList.map((att) => (
                  <tr key={att.id} className="hover:bg-slate-800/40 transition">
                    <td className="p-3.5">
                      <div className="font-semibold text-white">{att.employee_name}</div>
                      <div className="text-[11px] text-slate-400 font-mono">{att.employee_code}</div>
                    </td>
                    <td className="p-3.5 text-slate-300">{att.department_name || 'General'}</td>
                    <td className="p-3.5 font-mono text-slate-200">
                      {new Date(att.check_in).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="p-3.5 font-mono text-slate-200">
                      {att.check_out ? (
                        new Date(att.check_out).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                      ) : (
                        <span className="text-amber-400 italic">Active</span>
                      )}
                    </td>
                    <td className="p-3.5 font-semibold text-white">
                      {att.total_hours ? `${att.total_hours}h` : '--'}
                    </td>
                    <td className="p-3.5">
                      <div className="flex items-center gap-1.5 uppercase font-medium text-[10px] text-slate-300">
                        {att.source === 'camera' ? (
                          <Camera className="w-3.5 h-3.5 text-indigo-400" />
                        ) : (
                          <span className="text-slate-400">Web</span>
                        )}
                        <span>{att.source}</span>
                      </div>
                      {att.distance_meters !== null && (
                        <span className="text-[10px] text-slate-400 block font-mono">
                          {att.distance_meters}m from geofence
                        </span>
                      )}
                    </td>
                    <td className="p-3.5">
                      <span
                        className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full uppercase ${
                          att.status === 'present'
                            ? 'bg-emerald-500/20 text-emerald-400'
                            : att.status === 'late'
                            ? 'bg-amber-500/20 text-amber-400'
                            : att.status === 'half_day'
                            ? 'bg-purple-500/20 text-purple-400'
                            : 'bg-red-500/20 text-red-400'
                        }`}
                      >
                        {att.status}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Review Modal */}
      {activeCorrection && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-3xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <h3 className="text-base font-bold text-white">Review Attendance Correction</h3>
            <div className="p-3 bg-slate-800 rounded-xl space-y-1 text-xs text-slate-300">
              <div>
                <strong>Employee:</strong> {activeCorrection.employee_name} ({activeCorrection.employee_code})
              </div>
              <div>
                <strong>Date:</strong> {activeCorrection.date}
              </div>
              <div>
                <strong>Reason:</strong> "{activeCorrection.reason}"
              </div>
            </div>

            <div className="space-y-1 text-xs">
              <label className="font-semibold text-slate-300">HR Review Comment</label>
              <textarea
                rows={2}
                value={reviewComment}
                onChange={(e) => setReviewComment(e.target.value)}
                placeholder="Optional review comment or justification..."
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-white text-xs"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setActiveCorrection(null)}
                className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={reviewing}
                onClick={() => handleDecision('rejected')}
                className="px-3.5 py-2 bg-red-600/80 hover:bg-red-600 text-white rounded-xl text-xs font-semibold"
              >
                Reject Request
              </button>
              <button
                type="button"
                disabled={reviewing}
                onClick={() => handleDecision('approved')}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-semibold"
              >
                Approve & Update
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
