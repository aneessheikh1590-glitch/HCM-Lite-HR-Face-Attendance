import React, { useState, useEffect } from 'react';
import { DollarSign, FileText, Download, Lock, CheckCircle2, AlertCircle, Play, Sparkles } from 'lucide-react';
import { apiRequest } from '../../lib/api.js';
import { downloadPayslipPDF } from '../../lib/pdf.js';
import type { PayrollRun, Payslip } from '../../types.js';

interface Props {
  userRole: 'admin' | 'hr';
  companyName?: string;
}

export const PayrollRunsView: React.FC<Props> = ({ userRole, companyName }) => {
  const [selectedMonth, setSelectedMonth] = useState('2026-10');
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [payslips, setPayslips] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const fetchPayroll = async () => {
    try {
      setLoading(true);
      const [r, p] = await Promise.all([
        apiRequest<PayrollRun[]>('/api/payroll/runs'),
        apiRequest<any[]>(`/api/payroll/payslips?month=${selectedMonth}`),
      ]);
      setRuns(r);
      setPayslips(p);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPayroll();
  }, [selectedMonth]);

  const currentRun = runs.find((r) => r.month === selectedMonth);

  // HR generates draft
  const handleGenerateDraft = async () => {
    setGenerating(true);
    setFeedback(null);
    try {
      await apiRequest('/api/payroll/draft', {
        method: 'POST',
        body: JSON.stringify({ month: selectedMonth }),
      });
      setFeedback(`Draft payroll generated for ${selectedMonth}!`);
      fetchPayroll();
    } catch (err: any) {
      alert(err.message || 'Failed to generate payroll draft.');
    } finally {
      setGenerating(false);
    }
  };

  // Admin finalizes and locks
  const handleFinalize = async () => {
    if (!confirm(`Are you sure you want to finalize payroll for ${selectedMonth}? Once locked, it cannot be modified.`)) {
      return;
    }
    setFinalizing(true);
    setFeedback(null);
    try {
      await apiRequest('/api/payroll/finalize', {
        method: 'POST',
        body: JSON.stringify({ month: selectedMonth }),
      });
      setFeedback(`Payroll for ${selectedMonth} locked and finalized! Notifications sent to all employees.`);
      fetchPayroll();
    } catch (err: any) {
      alert(err.message || 'Failed to finalize payroll.');
    } finally {
      setFinalizing(false);
    }
  };

  return (
    <div className="space-y-6">
      
      {/* Top Header */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-indigo-400" /> Monthly Payroll Lite & Payslip Generator
          </h2>
          <p className="text-xs text-slate-400">
            Automates Section 3 rules: Gross (1.5x basic), attendance deductions, and annual tax brackets.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="month"
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="px-3.5 py-2 bg-slate-800 border border-slate-700 rounded-xl text-white text-xs font-mono"
          />

          {userRole === 'hr' && (
            <button
              onClick={handleGenerateDraft}
              disabled={generating || currentRun?.status === 'finalized'}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold shadow transition flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
            >
              <Play className="w-3.5 h-3.5" />
              {generating ? 'Calculating...' : currentRun ? 'Re-run Draft' : 'Run Monthly Draft'}
            </button>
          )}

          {userRole === 'admin' && currentRun && currentRun.status === 'draft' && (
            <button
              onClick={handleFinalize}
              disabled={finalizing}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold shadow transition flex items-center gap-1.5 cursor-pointer"
            >
              <Lock className="w-3.5 h-3.5" />
              {finalizing ? 'Locking...' : 'Finalize & Lock Month'}
            </button>
          )}
        </div>
      </div>

      {feedback && (
        <div className="p-3 bg-emerald-950/60 border border-emerald-500/40 rounded-xl text-emerald-300 text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{feedback}</span>
        </div>
      )}

      {/* Current Month Run Summary Card */}
      {currentRun && (
        <div className="bg-gradient-to-r from-slate-900 to-indigo-950/40 border border-slate-800 rounded-3xl p-6 shadow-xl space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div className="flex items-center gap-2">
              <span className="font-bold text-white text-sm">Payroll Status:</span>
              <span
                className={`text-xs px-2.5 py-0.5 rounded-full font-bold uppercase ${
                  currentRun.status === 'finalized'
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                    : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                }`}
              >
                {currentRun.status === 'finalized' ? 'Finalized & Locked' : 'Draft (Editable by HR)'}
              </span>
            </div>
            <span className="text-xs text-slate-400">
              Working Days in Month: <strong className="text-white">{currentRun.working_days_in_month}d</strong>
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
            <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800">
              <span className="text-slate-400 text-[10px] uppercase font-semibold">Total Gross</span>
              <div className="text-lg font-bold text-white font-mono mt-1">
                PKR {currentRun.total_gross.toLocaleString()}
              </div>
            </div>

            <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800">
              <span className="text-slate-400 text-[10px] uppercase font-semibold">Absent Deductions</span>
              <div className="text-lg font-bold text-amber-400 font-mono mt-1">
                - PKR {currentRun.total_deductions.toLocaleString()}
              </div>
            </div>

            <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800">
              <span className="text-slate-400 text-[10px] uppercase font-semibold">Income Tax Slabs</span>
              <div className="text-lg font-bold text-red-400 font-mono mt-1">
                - PKR {currentRun.total_tax.toLocaleString()}
              </div>
            </div>

            <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800">
              <span className="text-slate-400 text-[10px] uppercase font-semibold">Net Pay Distribution</span>
              <div className="text-lg font-bold text-emerald-400 font-mono mt-1">
                PKR {currentRun.total_net.toLocaleString()}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Individual Payslips Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-xl">
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
          <h3 className="text-sm font-bold text-white">Employee Breakdown — {selectedMonth}</h3>
          <span className="text-xs text-slate-400">{payslips.length} slips calculated</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-800/80 text-slate-400 font-semibold border-b border-slate-800">
              <tr>
                <th className="p-3.5">Employee</th>
                <th className="p-3.5">Basic / HRA / Med</th>
                <th className="p-3.5">Gross (1.5x)</th>
                <th className="p-3.5">Attendance Days</th>
                <th className="p-3.5">Deductions</th>
                <th className="p-3.5">Income Tax</th>
                <th className="p-3.5">Net Pay</th>
                <th className="p-3.5 text-right">PDF</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-slate-300">
              {payslips.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-slate-500">
                    No payroll run created for {selectedMonth}. Click "Run Monthly Draft" above to compute.
                  </td>
                </tr>
              ) : (
                payslips.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-800/40 transition">
                    <td className="p-3.5">
                      <div className="font-semibold text-white">{p.employee_name}</div>
                      <div className="text-[11px] text-slate-400 font-mono">{p.employee_code}</div>
                    </td>
                    <td className="p-3.5 text-slate-400 text-[11px]">
                      {p.basic_salary.toLocaleString()} + {p.hra.toLocaleString()} + {p.medical_allowance.toLocaleString()}
                    </td>
                    <td className="p-3.5 font-mono text-white font-semibold">
                      PKR {p.gross_salary.toLocaleString()}
                    </td>
                    <td className="p-3.5 text-slate-300">
                      {p.attended_days}d / {p.working_days}d
                      {p.late_penalty_days > 0 && (
                        <span className="text-[10px] text-amber-400 block">
                          Late pen: {p.late_penalty_days}d ({p.late_count} lates)
                        </span>
                      )}
                    </td>
                    <td className="p-3.5 font-mono text-amber-400">
                      - {p.absent_deduction.toLocaleString()}
                    </td>
                    <td className="p-3.5 font-mono text-red-400">
                      - {p.income_tax.toLocaleString()}
                    </td>
                    <td className="p-3.5 font-mono text-emerald-400 font-bold">
                      PKR {p.net_salary.toLocaleString()}
                    </td>
                    <td className="p-3.5 text-right">
                      <button
                        onClick={() => downloadPayslipPDF(p, companyName)}
                        className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-medium border border-slate-700 transition"
                      >
                        Download PDF
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
};
