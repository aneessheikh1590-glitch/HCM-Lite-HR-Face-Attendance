import React from 'react';
import { X, CheckCircle, Shield, Award, Camera, MapPin, Sparkles, BookOpen, Download, Terminal } from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export const DocGuideModal: React.FC<Props> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-700 text-slate-100 rounded-2xl max-w-4xl w-full p-6 sm:p-8 shadow-2xl max-h-[90vh] overflow-y-auto space-y-6">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
              <Award className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold tracking-tight text-white">Saylani Hackathon — HCM Lite Demonstration Guide</h2>
              <p className="text-xs text-slate-400">Official Evaluation Criteria, 5-Minute Demo Script & Biometrics Architecture</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 5-Minute Demo Script */}
        <div className="space-y-3">
          <h3 className="text-sm font-bold uppercase tracking-wider text-indigo-400 flex items-center gap-2">
            <BookOpen className="w-4 h-4" /> 5-Minute Live Demo Script (Section 9)
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
            <div className="p-3 bg-slate-800/60 rounded-xl border border-slate-700/60 space-y-1">
              <span className="font-semibold text-emerald-400">Step 1: Admin Setup</span>
              <p className="text-slate-300">
                Log in as Admin (<code>admin@saylani.com</code> / <code>admin123</code>). Review company hours (09:00 start, 15m grace), office geofence coordinates, and HR login management.
              </p>
            </div>
            <div className="p-3 bg-slate-800/60 rounded-xl border border-slate-700/60 space-y-1">
              <span className="font-semibold text-indigo-400">Step 2: HR Operations</span>
              <p className="text-slate-300">
                Switch to HR (<code>hr@saylani.com</code> / <code>hr123</code>). View Employee directory, register an employee with salary, or run CSV import dry-run validation.
              </p>
            </div>
            <div className="p-3 bg-slate-800/60 rounded-xl border border-slate-700/60 space-y-1">
              <span className="font-semibold text-amber-400">Step 3: Employee Camera Attendance</span>
              <p className="text-slate-300">
                Switch to Employee (<code>bilal.ahmed@saylani.com</code> / <code>emp123</code>). Open Camera Check-in. See real face detection box, liveness detection, and GPS geofence distance check.
              </p>
            </div>
            <div className="p-3 bg-slate-800/60 rounded-xl border border-slate-700/60 space-y-1">
              <span className="font-semibold text-pink-400">Step 4: Smart Leave (AI) & Approval</span>
              <p className="text-slate-300">
                In Employee portal, type: <em>"Need next Monday and Tuesday off for sister's wedding"</em>. Smart leave pre-fills casual leave. Submit, then switch to HR to approve.
              </p>
            </div>
            <div className="p-3 bg-slate-800/60 rounded-xl border border-slate-700/60 space-y-1">
              <span className="font-semibold text-cyan-400">Step 5: Monthly Payroll & Payslip PDF</span>
              <p className="text-slate-300">
                HR runs monthly payroll draft calculating Gross (1.5x basic), attendance deductions, and tax slabs. Admin finalizes/locks. Employee downloads PDF payslip!
              </p>
            </div>
            <div className="p-3 bg-slate-800/60 rounded-xl border border-slate-700/60 space-y-1">
              <span className="font-semibold text-purple-400">Step 6: AI Tool Calling & Security Test</span>
              <p className="text-slate-300">
                Open AI drawer. As Employee, ask <em>"What is Bilal's salary?"</em> &rarr; Politely refused! Ask <em>"Who is on leave today?"</em> &rarr; Answers from real database numbers.
              </p>
            </div>
          </div>
        </div>

        {/* Biometrics & Facial Recognition Technical Brief */}
        <div className="space-y-3 bg-slate-800/40 p-4 rounded-xl border border-slate-700">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <Camera className="w-4 h-4 text-emerald-400" />
            Face Recognition, Liveness & Geofencing Architecture (Section 5)
          </h3>
          <p className="text-xs text-slate-300 leading-relaxed">
            HCM Lite utilizes an in-browser biometric analyzer with <strong>YCbCr skin-tone clustering</strong> and facial landmark proportion localization. An 8-dimensional normalized facial descriptor vector is extracted and compared against the employee's enrolled biometric profile using <strong>cosine similarity</strong> with a strict acceptance threshold.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
            <div className="p-2.5 bg-slate-900 rounded-lg border border-slate-800">
              <span className="font-semibold text-slate-200">Face Validation</span>
              <p className="text-slate-400 mt-1">Rejects check-in if 0 faces or &gt;1 faces are detected in the webcam frame.</p>
            </div>
            <div className="p-2.5 bg-slate-900 rounded-lg border border-slate-800">
              <span className="font-semibold text-slate-200">Liveness Detection</span>
              <p className="text-slate-400 mt-1">Analyzes optical reflectance dynamics across consecutive frames to detect natural eye blinks and micro-expressions.</p>
            </div>
            <div className="p-2.5 bg-slate-900 rounded-lg border border-slate-800">
              <span className="font-semibold text-slate-200">Haversine Geofence</span>
              <p className="text-slate-400 mt-1">Calculates spherical geodesic distance from office coordinates. Rejects if distance &gt; radius or GPS accuracy &gt; 100m.</p>
            </div>
          </div>
        </div>

        {/* Credentials Table */}
        <div className="space-y-2">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">Pre-seeded Demo Test Logins</h4>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border border-slate-800 rounded-lg overflow-hidden">
              <thead className="bg-slate-800/80 text-slate-300 font-semibold">
                <tr>
                  <th className="p-2">Role</th>
                  <th className="p-2">Email</th>
                  <th className="p-2">Password</th>
                  <th className="p-2">Key Permissions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 text-slate-300">
                <tr>
                  <td className="p-2 font-semibold text-emerald-400">Admin</td>
                  <td className="p-2 font-mono">admin@saylani.com</td>
                  <td className="p-2 font-mono">admin123</td>
                  <td className="p-2">Company setup, Lock payroll, Audit log, User management</td>
                </tr>
                <tr>
                  <td className="p-2 font-semibold text-indigo-400">HR</td>
                  <td className="p-2 font-mono">hr@saylani.com</td>
                  <td className="p-2 font-mono">hr123</td>
                  <td className="p-2">Register employees, CSV import, Leave approvals, Payroll draft</td>
                </tr>
                <tr>
                  <td className="p-2 font-semibold text-amber-400">Employee (Lead)</td>
                  <td className="p-2 font-mono">muhammad.anees@saylani.com</td>
                  <td className="p-2 font-mono">emp123</td>
                  <td className="p-2">Camera check-in, Smart leave, Download payslips</td>
                </tr>
                <tr>
                  <td className="p-2 font-semibold text-amber-300">Employee (Sr Dev)</td>
                  <td className="p-2 font-mono">bilal.ahmed@saylani.com</td>
                  <td className="p-2 font-mono">emp123</td>
                  <td className="p-2">Camera check-in, Attendance corrections, Own profile</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end pt-2 border-t border-slate-800">
          <button
            onClick={onClose}
            className="px-5 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-medium transition"
          >
            Close Guide
          </button>
        </div>

      </div>
    </div>
  );
};
