import React, { useState, useEffect } from 'react';
import { Users, UserCheck, Clock, Calendar, CheckSquare, Sparkles, TrendingUp, AlertTriangle } from 'lucide-react';
import { apiRequest } from '../../lib/api.js';

interface Props {
  onNavigate: (tab: string) => void;
  onOpenAI: () => void;
}

export const HRDashboard: React.FC<Props> = ({ onNavigate, onOpenAI }) => {
  const [metrics, setMetrics] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // AI Summary
  const [summaryBullets, setSummaryBullets] = useState<string[]>([]);
  const [generatingSummary, setGeneratingSummary] = useState(false);

  useEffect(() => {
    const fetchMetrics = async () => {
      try {
        setLoading(true);
        const data = await apiRequest('/api/analytics/hr');
        setMetrics(data);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetchMetrics();
  }, []);

  const handleGenerateSummary = async () => {
    if (!metrics) return;
    setGeneratingSummary(true);
    try {
      const res = await apiRequest<{ bullets: string[] }>('/api/ai/dashboard-summary', {
        method: 'POST',
        body: JSON.stringify({ kpis: metrics }),
      });
      setSummaryBullets(res.bullets || []);
    } catch (err) {
      console.error(err);
    } finally {
      setGeneratingSummary(false);
    }
  };

  return (
    <div className="space-y-6">
      
      {/* Top Banner with AI Summarize Button */}
      <div className="bg-gradient-to-r from-indigo-950/60 via-purple-950/40 to-slate-900 border border-indigo-500/30 rounded-3xl p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-xl">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 font-semibold border border-indigo-500/30">
              HR Operations Control
            </span>
          </div>
          <h2 className="text-2xl font-bold text-white tracking-tight">People Operations & Insights</h2>
          <p className="text-xs text-slate-300">
            Workforce attendance, active leaves, late arrivals, and monthly payroll preparation.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={handleGenerateSummary}
            disabled={generatingSummary || !metrics}
            className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-indigo-600/30 transition flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
          >
            <Sparkles className="w-4 h-4 text-amber-300" />
            {generatingSummary ? 'Summarizing...' : 'Summarize with AI'}
          </button>
          <button
            onClick={onOpenAI}
            className="px-3.5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-medium border border-slate-700 transition"
          >
            Ask AI Assistant
          </button>
        </div>
      </div>

      {/* AI Summary Card (Section 4) */}
      {summaryBullets.length > 0 && (
        <div className="p-6 bg-gradient-to-r from-indigo-950/40 to-slate-900 border border-indigo-500/30 rounded-3xl space-y-3 shadow-lg">
          <div className="flex items-center gap-2 text-xs font-bold text-indigo-300">
            <Sparkles className="w-4 h-4 text-amber-300" />
            <span>AI Executive Briefing (Live Database Verified)</span>
          </div>
          <ul className="space-y-1.5 text-xs text-slate-200">
            {summaryBullets.map((b, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="text-indigo-400 font-bold">•</span>
                <span>{b}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 5 Primary KPIs (Section 7) */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3.5">
        <div className="p-4 bg-slate-900 border border-slate-800 rounded-2xl space-y-1">
          <span className="text-[11px] text-slate-400 flex items-center gap-1">
            <Users className="w-3.5 h-3.5 text-indigo-400" /> Total Headcount
          </span>
          <div className="text-2xl font-bold text-white font-mono">{metrics?.headcount ?? 0}</div>
          <span className="text-[10px] text-slate-400">Active workforce</span>
        </div>

        <div className="p-4 bg-slate-900 border border-slate-800 rounded-2xl space-y-1">
          <span className="text-[11px] text-slate-400 flex items-center gap-1">
            <UserCheck className="w-3.5 h-3.5 text-emerald-400" /> Present Today
          </span>
          <div className="text-2xl font-bold text-emerald-400 font-mono">{metrics?.presentToday ?? 0}</div>
          <span className="text-[10px] text-slate-400">Attendance rate: {metrics?.attendanceRate ?? 0}%</span>
        </div>

        <div className="p-4 bg-slate-900 border border-slate-800 rounded-2xl space-y-1">
          <span className="text-[11px] text-slate-400 flex items-center gap-1">
            <Clock className="w-3.5 h-3.5 text-amber-400" /> Late Today
          </span>
          <div className="text-2xl font-bold text-amber-400 font-mono">{metrics?.lateToday ?? 0}</div>
          <span className="text-[10px] text-slate-400">After 09:15 threshold</span>
        </div>

        <div className="p-4 bg-slate-900 border border-slate-800 rounded-2xl space-y-1">
          <span className="text-[11px] text-slate-400 flex items-center gap-1">
            <Calendar className="w-3.5 h-3.5 text-purple-400" /> On Leave Today
          </span>
          <div className="text-2xl font-bold text-purple-400 font-mono">{metrics?.onLeaveToday ?? 0}</div>
          <span className="text-[10px] text-slate-400">Approved leaves</span>
        </div>

        <div
          onClick={() => onNavigate('leave-approvals')}
          className="p-4 bg-slate-900 border border-slate-800 hover:border-indigo-500/50 transition cursor-pointer rounded-2xl space-y-1 col-span-2 lg:col-span-1"
        >
          <span className="text-[11px] text-slate-400 flex items-center gap-1">
            <CheckSquare className="w-3.5 h-3.5 text-cyan-400" /> Pending Approvals
          </span>
          <div className="text-2xl font-bold text-cyan-400 font-mono">{metrics?.pendingApprovals ?? 0}</div>
          <span className="text-[10px] text-indigo-400 underline">Review pending &rarr;</span>
        </div>
      </div>

      {/* Analytics Insights: Top Late Comers & Leave Utilization */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
        
        {/* Top 5 Late Comers (Section 7) */}
        <div className="md:col-span-7 bg-slate-900 border border-slate-800 rounded-3xl p-6 space-y-4 shadow-xl">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Clock className="w-4 h-4 text-amber-400" /> Top 5 Late-Comers (Past 30 Days)
            </h3>
            <span className="text-[10px] text-slate-400">3 lates = 0.5 day penalty</span>
          </div>

          {!metrics?.topLateComers || metrics.topLateComers.length === 0 ? (
            <p className="text-xs text-slate-400 py-6 text-center">No late arrivals logged.</p>
          ) : (
            <div className="space-y-2.5">
              {metrics.topLateComers.map((item: any, idx: number) => (
                <div
                  key={idx}
                  className="p-3 bg-slate-800/50 border border-slate-700/60 rounded-xl flex items-center justify-between text-xs"
                >
                  <div className="flex items-center gap-3">
                    <span className="w-6 h-6 rounded-lg bg-amber-500/20 text-amber-300 font-mono font-bold flex items-center justify-center text-[10px]">
                      #{idx + 1}
                    </span>
                    <div>
                      <span className="font-semibold text-white">{item.name}</span>
                      <span className="text-slate-400 text-[11px] block">{item.department} ({item.code})</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="font-bold text-amber-400 font-mono">{item.late_count} Late Arrivals</span>
                    <span className="text-[10px] text-slate-400 block">
                      Penalty: {Math.floor(item.late_count / 3) * 0.5} day deduction
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Leave Utilization by Type */}
        <div className="md:col-span-5 bg-slate-900 border border-slate-800 rounded-3xl p-6 space-y-4 shadow-xl">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Calendar className="w-4 h-4 text-indigo-400" /> Leave Distribution (YTD)
            </h3>
          </div>

          <div className="space-y-3 text-xs">
            <div className="space-y-1">
              <div className="flex justify-between text-slate-300">
                <span>Annual Leave</span>
                <span className="font-mono text-indigo-400 font-semibold">{metrics?.leaveByType?.annual ?? 0} days</span>
              </div>
              <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
                <div
                  className="bg-indigo-500 h-full rounded-full"
                  style={{ width: `${Math.min(100, (metrics?.leaveByType?.annual || 0) * 5)}%` }}
                />
              </div>
            </div>

            <div className="space-y-1">
              <div className="flex justify-between text-slate-300">
                <span>Sick Leave</span>
                <span className="font-mono text-emerald-400 font-semibold">{metrics?.leaveByType?.sick ?? 0} days</span>
              </div>
              <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
                <div
                  className="bg-emerald-500 h-full rounded-full"
                  style={{ width: `${Math.min(100, (metrics?.leaveByType?.sick || 0) * 8)}%` }}
                />
              </div>
            </div>

            <div className="space-y-1">
              <div className="flex justify-between text-slate-300">
                <span>Casual Leave</span>
                <span className="font-mono text-amber-400 font-semibold">{metrics?.leaveByType?.casual ?? 0} days</span>
              </div>
              <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
                <div
                  className="bg-amber-500 h-full rounded-full"
                  style={{ width: `${Math.min(100, (metrics?.leaveByType?.casual || 0) * 6)}%` }}
                />
              </div>
            </div>

            <div className="space-y-1">
              <div className="flex justify-between text-slate-300">
                <span>Unpaid Leave</span>
                <span className="font-mono text-red-400 font-semibold">{metrics?.leaveByType?.unpaid ?? 0} days</span>
              </div>
              <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
                <div
                  className="bg-red-500 h-full rounded-full"
                  style={{ width: `${Math.min(100, (metrics?.leaveByType?.unpaid || 0) * 10)}%` }}
                />
              </div>
            </div>
          </div>

          <div className="pt-2 border-t border-slate-800 text-[11px] text-slate-400">
            Unpaid leaves and absent days directly deduct from monthly payroll calculations.
          </div>
        </div>

      </div>

    </div>
  );
};
