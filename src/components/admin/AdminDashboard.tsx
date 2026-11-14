import React, { useState, useEffect } from 'react';
import { Building2, Users, DollarSign, Activity, Sparkles, TrendingUp, Shield, Clock } from 'lucide-react';
import { apiRequest } from '../../lib/api.js';

interface Props {
  onNavigate: (tab: string) => void;
  onOpenAI: () => void;
}

export const AdminDashboard: React.FC<Props> = ({ onNavigate, onOpenAI }) => {
  const [metrics, setMetrics] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // AI Summary
  const [summaryBullets, setSummaryBullets] = useState<string[]>([]);
  const [summarizing, setSummarizing] = useState(false);

  useEffect(() => {
    const fetchMetrics = async () => {
      try {
        setLoading(true);
        const data = await apiRequest('/api/analytics/admin');
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
    setSummarizing(true);
    try {
      const res = await apiRequest<{ bullets: string[] }>('/api/ai/dashboard-summary', {
        method: 'POST',
        body: JSON.stringify({ kpis: metrics }),
      });
      setSummaryBullets(res.bullets || []);
    } catch (err) {
      console.error(err);
    } finally {
      setSummarizing(false);
    }
  };

  return (
    <div className="space-y-6">
      
      {/* Top Banner with AI Summarize Button */}
      <div className="bg-gradient-to-r from-indigo-950/60 via-purple-950/40 to-slate-900 border border-indigo-500/30 rounded-3xl p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-xl">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-semibold border border-emerald-500/30">
              Admin Executive Portal
            </span>
          </div>
          <h2 className="text-2xl font-bold text-white tracking-tight">Organization Overview & Audit</h2>
          <p className="text-xs text-slate-300">
            Company-level KPIs: attrition rate, total payroll cost, headcount distribution, and governance audit trail.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={handleGenerateSummary}
            disabled={summarizing || !metrics}
            className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-indigo-600/30 transition flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
          >
            <Sparkles className="w-4 h-4 text-amber-300" />
            {summarizing ? 'Summarizing...' : 'Summarize with AI'}
          </button>
          <button
            onClick={onOpenAI}
            className="px-3.5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-medium border border-slate-700 transition"
          >
            Ask AI Assistant
          </button>
        </div>
      </div>

      {/* AI Summary Card */}
      {summaryBullets.length > 0 && (
        <div className="p-6 bg-gradient-to-r from-indigo-950/40 to-slate-900 border border-indigo-500/30 rounded-3xl space-y-3 shadow-lg">
          <div className="flex items-center gap-2 text-xs font-bold text-indigo-300">
            <Sparkles className="w-4 h-4 text-amber-300" />
            <span>AI Executive Briefing (Database Grounded)</span>
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

      {/* Primary 4 Admin KPIs (Section 7) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        
        <div className="p-5 bg-slate-900 border border-slate-800 rounded-3xl space-y-2">
          <span className="text-xs text-slate-400 font-medium flex items-center gap-1.5">
            <Users className="w-4 h-4 text-indigo-400" /> Total Headcount
          </span>
          <div className="text-2xl font-bold text-white font-mono">{metrics?.headcount ?? 0}</div>
          <span className="text-[11px] text-slate-400">Active and probation staff</span>
        </div>

        <div className="p-5 bg-slate-900 border border-slate-800 rounded-3xl space-y-2">
          <span className="text-xs text-slate-400 font-medium flex items-center gap-1.5">
            <TrendingUp className="w-4 h-4 text-emerald-400" /> Attrition Rate (YTD)
          </span>
          <div className="text-2xl font-bold text-emerald-400 font-mono">
            {metrics?.attritionYTD ?? 0}%
          </div>
          <span className="text-[11px] text-slate-400">Formula: Exits ÷ Avg headcount</span>
        </div>

        <div className="p-5 bg-slate-900 border border-slate-800 rounded-3xl space-y-2">
          <span className="text-xs text-slate-400 font-medium flex items-center gap-1.5">
            <DollarSign className="w-4 h-4 text-amber-400" /> Total Monthly Payroll
          </span>
          <div className="text-2xl font-bold text-white font-mono">
            PKR {metrics?.latestPayrollCost ? (metrics.latestPayrollCost / 1000).toFixed(0) + 'k' : '0'}
          </div>
          <span className="text-[11px] text-slate-400">Sum of gross wages (1.5x)</span>
        </div>

        <div className="p-5 bg-slate-900 border border-slate-800 rounded-3xl space-y-2">
          <span className="text-xs text-slate-400 font-medium flex items-center gap-1.5">
            <Activity className="w-4 h-4 text-purple-400" /> Average Salary
          </span>
          <div className="text-2xl font-bold text-purple-400 font-mono">
            PKR {metrics?.avgSalary ? metrics.avgSalary.toLocaleString() : '0'}
          </div>
          <span className="text-[11px] text-slate-400">Mean gross across company</span>
        </div>

      </div>

      {/* Department Breakdown & Audit Feed */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
        
        {/* Department Distribution (Headcount & Cost) */}
        <div className="md:col-span-7 bg-slate-900 border border-slate-800 rounded-3xl p-6 space-y-4 shadow-xl">
          <h3 className="text-sm font-bold text-white flex items-center gap-2 border-b border-slate-800 pb-3">
            <Building2 className="w-4 h-4 text-indigo-400" /> Department Workforce & Payroll Distribution
          </h3>

          <div className="space-y-4">
            {metrics?.headcountByDept?.map((dept: any, idx: number) => {
              const cost = metrics?.payrollByDept?.find((p: any) => p.department === dept.department)?.cost || 0;
              return (
                <div key={idx} className="space-y-1.5 text-xs">
                  <div className="flex justify-between text-slate-300">
                    <span className="font-semibold text-white">{dept.department}</span>
                    <span className="font-mono text-slate-400">
                      {dept.count} members · PKR {cost.toLocaleString()}
                    </span>
                  </div>
                  <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
                    <div
                      className="bg-indigo-500 h-full rounded-full"
                      style={{
                        width: `${Math.min(100, (dept.count / Math.max(1, metrics.headcount)) * 100)}%`,
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Gender breakdown */}
          <div className="pt-4 border-t border-slate-800 grid grid-cols-3 gap-2 text-center text-xs">
            <div className="p-2.5 bg-slate-950/60 rounded-xl border border-slate-800">
              <span className="text-slate-400 text-[10px] block">Male</span>
              <span className="text-white font-bold font-mono text-sm">{metrics?.genderStats?.male ?? 0}</span>
            </div>
            <div className="p-2.5 bg-slate-950/60 rounded-xl border border-slate-800">
              <span className="text-slate-400 text-[10px] block">Female</span>
              <span className="text-white font-bold font-mono text-sm">{metrics?.genderStats?.female ?? 0}</span>
            </div>
            <div className="p-2.5 bg-slate-950/60 rounded-xl border border-slate-800">
              <span className="text-slate-400 text-[10px] block">Other</span>
              <span className="text-white font-bold font-mono text-sm">{metrics?.genderStats?.other ?? 0}</span>
            </div>
          </div>
        </div>

        {/* Live Governance Audit Feed (Latest 10 actions) */}
        <div className="md:col-span-5 bg-slate-900 border border-slate-800 rounded-3xl p-6 space-y-4 shadow-xl">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Shield className="w-4 h-4 text-emerald-400" /> Recent Audit Activity
            </h3>
            <button
              onClick={() => onNavigate('audit-logs')}
              className="text-[11px] text-indigo-400 hover:text-indigo-300 font-medium underline"
            >
              Full Log &rarr;
            </button>
          </div>

          <div className="space-y-2.5 max-h-80 overflow-y-auto">
            {!metrics?.auditFeed || metrics.auditFeed.length === 0 ? (
              <p className="text-xs text-slate-500 text-center py-6">No audit records yet.</p>
            ) : (
              metrics.auditFeed.map((log: any) => (
                <div
                  key={log.id}
                  className="p-3 bg-slate-800/40 rounded-xl border border-slate-800 text-xs space-y-1"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-bold text-indigo-300 text-[11px]">
                      {log.action}
                    </span>
                    <span className="text-[10px] text-slate-500">
                      {new Date(log.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <div className="text-slate-400 text-[11px]">
                    By <span className="text-slate-200">{log.actor_email}</span> ({log.actor_role})
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

      </div>

    </div>
  );
};
