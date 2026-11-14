import React, { useState, useEffect } from 'react';
import { FileText, Download, DollarSign, ShieldAlert, Sparkles, CheckCircle2 } from 'lucide-react';
import { apiRequest } from '../../lib/api.js';
import { downloadPayslipPDF } from '../../lib/pdf.js';
import type { Payslip } from '../../types.js';

interface Props {
  employeeId: string;
  companyName?: string;
}

export const EmployeePayslipsView: React.FC<Props> = ({ employeeId, companyName }) => {
  const [payslips, setPayslips] = useState<Payslip[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchPayslips = async () => {
    try {
      setLoading(true);
      const data = await apiRequest<Payslip[]>('/api/payroll/payslips');
      setPayslips(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPayslips();
  }, [employeeId]);

  return (
    <div className="space-y-6">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <FileText className="w-5 h-5 text-indigo-400" /> My Monthly Payslips
          </h2>
          <p className="text-xs text-slate-400">
            View detailed compensation breakdowns, allowances, tax deductions, and download verified PDF payslips.
          </p>
        </div>
      </div>

      {payslips.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-12 text-center space-y-3">
          <FileText className="w-10 h-10 text-slate-600 mx-auto" />
          <h3 className="text-sm font-semibold text-slate-300">No Payslips Published Yet</h3>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            Once HR drafts monthly payroll and Admin locks/finalizes it, your verified payslip will appear here with instant PDF download.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {payslips.map((slip) => (
            <div
              key={slip.id}
              className="bg-slate-900 border border-slate-800 hover:border-slate-700 transition rounded-3xl p-6 space-y-4 shadow-xl"
            >
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div>
                  <span className="text-[10px] uppercase font-bold text-indigo-400 tracking-wider">Salary Statement</span>
                  <h3 className="text-base font-bold text-white">Month: {slip.month}</h3>
                </div>
                <button
                  onClick={() => downloadPayslipPDF(slip, companyName)}
                  className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold shadow transition flex items-center gap-1.5 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" /> PDF
                </button>
              </div>

              {/* Earnings & Deductions breakdown */}
              <div className="grid grid-cols-2 gap-3 text-xs bg-slate-950/40 p-3.5 rounded-2xl border border-slate-800/80">
                <div className="space-y-1">
                  <span className="text-[10px] font-semibold text-slate-400 uppercase">Gross Earnings</span>
                  <div className="text-white font-mono font-semibold">PKR {slip.gross_salary.toLocaleString()}</div>
                  <div className="text-[10px] text-slate-400">
                    Basic: {slip.basic_salary.toLocaleString()} | HRA: {slip.hra.toLocaleString()}
                  </div>
                </div>

                <div className="space-y-1">
                  <span className="text-[10px] font-semibold text-slate-400 uppercase">Deductions & Tax</span>
                  <div className="text-red-400 font-mono font-semibold">
                    - PKR {(slip.absent_deduction + slip.income_tax).toLocaleString()}
                  </div>
                  <div className="text-[10px] text-slate-400">
                    Tax: {slip.income_tax.toLocaleString()} | Abs: {slip.absent_deduction.toLocaleString()}
                  </div>
                </div>
              </div>

              {/* Working days & Lates */}
              <div className="flex items-center justify-between text-xs text-slate-300 px-1">
                <span>Working: {slip.working_days}d (Attended: {slip.attended_days}d)</span>
                <span>Lates: {slip.late_count} ({slip.late_penalty_days}d penalty)</span>
              </div>

              {/* Net Payable Highlight */}
              <div className="bg-indigo-950/40 border border-indigo-500/30 rounded-2xl p-4 flex items-center justify-between">
                <div>
                  <span className="text-[10px] text-indigo-300 font-semibold uppercase">Net Take-Home Salary</span>
                  <div className="text-xl font-bold text-white font-mono">
                    PKR {slip.net_salary.toLocaleString()}
                  </div>
                </div>
                <div className="w-9 h-9 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold">
                  ✓
                </div>
              </div>

            </div>
          ))}
        </div>
      )}
    </div>
  );
};
