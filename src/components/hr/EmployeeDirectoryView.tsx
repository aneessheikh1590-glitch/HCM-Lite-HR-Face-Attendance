import React, { useState, useEffect } from 'react';
import { Users, UserPlus, Upload, Download, Search, Filter, Eye, Camera, Shield, AlertCircle, CheckCircle2, ChevronRight, X } from 'lucide-react';
import { apiRequest } from '../../lib/api.js';
import type { Employee, Department, Designation } from '../../types.js';

interface Props {
  onRefresh?: () => void;
}

export const EmployeeDirectoryView: React.FC<Props> = () => {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [designations, setDesignations] = useState<Designation[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [search, setSearch] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  // Modals
  const [showAddModal, setShowAddModal] = useState(false);
  const [showCsvModal, setShowCsvModal] = useState(false);
  const [selected360Emp, setSelected360Emp] = useState<any | null>(null);
  const [enrollFaceEmp, setEnrollFaceEmp] = useState<Employee | null>(null);

  // Add Employee Form State
  const [code, setCode] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [deptId, setDeptId] = useState('');
  const [desId, setDesId] = useState('');
  const [joiningDate, setJoiningDate] = useState(new Date().toISOString().split('T')[0]);
  const [basicSalary, setBasicSalary] = useState('150000');
  const [tempPassword, setTempPassword] = useState('Welcome@123');
  const [gender, setGender] = useState<'male' | 'female' | 'other'>('male');
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // CSV Dry-Run State
  const [csvContent, setCsvContent] = useState('');
  const [dryRunReport, setDryRunReport] = useState<any | null>(null);
  const [dryRunning, setDryRunning] = useState(false);
  const [parsedRows, setParsedRows] = useState<any[]>([]);

  const fetchEmployees = async () => {
    try {
      setLoading(true);
      const queryParams = new URLSearchParams();
      if (search) queryParams.set('search', search);
      if (departmentFilter) queryParams.set('department_id', departmentFilter);
      if (statusFilter) queryParams.set('status', statusFilter);

      const [empList, depts, desList] = await Promise.all([
        apiRequest<Employee[]>(`/api/employees?${queryParams.toString()}`),
        apiRequest<Department[]>('/api/organization/departments'),
        apiRequest<Designation[]>('/api/organization/designations'),
      ]);

      setEmployees(empList);
      setDepartments(depts);
      setDesignations(desList);
      if (!deptId && depts.length > 0) setDeptId(depts[0].id);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEmployees();
  }, [search, departmentFilter, statusFilter]);

  // Open 360 View
  const handleOpen360 = async (empId: string) => {
    try {
      const data = await apiRequest(`/api/employees/${empId}/360`);
      setSelected360Emp(data);
    } catch (err: any) {
      alert(err.message || 'Could not load 360 profile.');
    }
  };

  // Submit Add Employee
  const handleAddEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFormSuccess(null);
    setSubmitting(true);

    try {
      const res = await apiRequest<{ employee: Employee; temporary_password: string }>('/api/employees', {
        method: 'POST',
        body: JSON.stringify({
          code,
          first_name: firstName,
          last_name: lastName,
          email,
          phone,
          address,
          department_id: deptId,
          designation_id: desId,
          joining_date: joiningDate,
          basic_salary: Number(basicSalary),
          gender,
          temporary_password: tempPassword,
        }),
      });

      setFormSuccess(
        `Employee registered! Login account created with temporary password: "${res.temporary_password}" (must be changed on first sign-in).`
      );
      // Reset form
      setCode('');
      setFirstName('');
      setLastName('');
      setEmail('');
      setPhone('');
      fetchEmployees();
    } catch (err: any) {
      setFormError(err.message || 'Failed to register employee.');
    } finally {
      setSubmitting(false);
    }
  };

  // CSV Dry-run validation
  const handleDryRunCSV = async () => {
    setDryRunning(true);
    setDryRunReport(null);
    try {
      // Parse CSV text into objects
      const lines = csvContent.trim().split('\n');
      if (lines.length < 2) throw new Error('CSV must contain a header and at least one data row.');

      const headers = lines[0].split(',').map((h) => h.trim());
      const rows: any[] = [];

      for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',').map((v) => v.trim());
        if (values.length < 2) continue;
        const rowObj: any = {};
        headers.forEach((h, idx) => {
          rowObj[h] = values[idx] || '';
        });
        rows.push(rowObj);
      }

      setParsedRows(rows);
      const report = await apiRequest('/api/employees/csv-import/dry-run', {
        method: 'POST',
        body: JSON.stringify({ rows }),
      });
      setDryRunReport(report);
    } catch (err: any) {
      alert(err.message || 'CSV dry-run failed.');
    } finally {
      setDryRunning(false);
    }
  };

  const handleCommitCSV = async () => {
    if (!parsedRows.length) return;
    try {
      const res = await apiRequest('/api/employees/csv-import/commit', {
        method: 'POST',
        body: JSON.stringify({ rows: parsedRows }),
      });
      alert(res.message);
      setShowCsvModal(false);
      setCsvContent('');
      setDryRunReport(null);
      fetchEmployees();
    } catch (err: any) {
      alert(err.message || 'Import commit failed.');
    }
  };

  // CSV Export
  const handleExportCSV = () => {
    if (employees.length === 0) return alert('No employee records to export.');
    const headers = 'code,first_name,last_name,email,phone,department,basic_salary,gross_salary,joining_date,status\n';
    const rows = employees
      .map((e) => {
        const d = departments.find((dept) => dept.id === e.department_id);
        return `${e.code},${e.first_name},${e.last_name},${e.email},${e.phone},${d?.name || ''},${e.basic_salary},${e.basic_salary * 1.5},${e.joining_date},${e.status}`;
      })
      .join('\n');

    const blob = new Blob([headers + rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `HCM_Lite_Employees_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
  };

  return (
    <div className="space-y-6">
      
      {/* Top Action Bar */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Users className="w-5 h-5 text-indigo-400" /> Employee Directory & 360 Profiles
          </h2>
          <p className="text-xs text-slate-400">
            Register new personnel, set salary structures, dry-run CSV imports, and inspect Employee 360 profiles.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setShowAddModal(true)}
            className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold shadow transition flex items-center gap-1.5 cursor-pointer"
          >
            <UserPlus className="w-4 h-4" /> Register Employee
          </button>
          <button
            onClick={() => setShowCsvModal(true)}
            className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-semibold border border-slate-700 transition flex items-center gap-1.5 cursor-pointer"
          >
            <Upload className="w-4 h-4" /> CSV Import
          </button>
          <button
            onClick={handleExportCSV}
            className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-semibold border border-slate-700 transition flex items-center gap-1.5 cursor-pointer"
          >
            <Download className="w-4 h-4" /> Export
          </button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col sm:flex-row items-center gap-3">
        <div className="relative flex-1 w-full">
          <Search className="w-4 h-4 absolute left-3 top-3 text-slate-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, employee code, or work email..."
            className="w-full pl-9 pr-4 py-2 bg-slate-800 border border-slate-700 rounded-xl text-white text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        <select
          value={departmentFilter}
          onChange={(e) => setDepartmentFilter(e.target.value)}
          className="w-full sm:w-44 px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-white text-xs"
        >
          <option value="">All Departments</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="w-full sm:w-36 px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-white text-xs"
        >
          <option value="">All Statuses</option>
          <option value="active">Active</option>
          <option value="probation">Probation</option>
          <option value="resigned">Resigned</option>
        </select>
      </div>

      {/* Employees Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-800/80 text-slate-400 font-semibold border-b border-slate-800">
              <tr>
                <th className="p-3.5">Code</th>
                <th className="p-3.5">Employee Name</th>
                <th className="p-3.5">Department</th>
                <th className="p-3.5">Basic / Gross Salary</th>
                <th className="p-3.5">Joining Date</th>
                <th className="p-3.5">Face Enrolled</th>
                <th className="p-3.5">Status</th>
                <th className="p-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-slate-300">
              {employees.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-slate-500">
                    No employees found matching current filter criteria.
                  </td>
                </tr>
              ) : (
                employees.map((emp) => {
                  const dept = departments.find((d) => d.id === emp.department_id);
                  const gross = emp.basic_salary * 1.5;
                  return (
                    <tr key={emp.id} className="hover:bg-slate-800/40 transition">
                      <td className="p-3.5 font-mono font-bold text-indigo-400">{emp.code}</td>
                      <td className="p-3.5">
                        <div className="font-semibold text-white">
                          {emp.first_name} {emp.last_name}
                        </div>
                        <div className="text-[11px] text-slate-400">{emp.email}</div>
                      </td>
                      <td className="p-3.5 text-slate-300">{dept?.name || 'Unassigned'}</td>
                      <td className="p-3.5 font-mono">
                        <span className="text-white font-semibold">PKR {gross.toLocaleString()}</span>
                        <span className="text-[10px] text-slate-400 block">
                          Basic: {emp.basic_salary.toLocaleString()}
                        </span>
                      </td>
                      <td className="p-3.5 text-slate-400">{emp.joining_date}</td>
                      <td className="p-3.5">
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                            emp.face_enrolled
                              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                              : 'bg-slate-800 text-slate-400 border border-slate-700'
                          }`}
                        >
                          {emp.face_enrolled ? 'Enrolled' : 'Pending'}
                        </span>
                        {emp.face_enrolled && (
                          <button
                            type="button"
                            onClick={async () => {
                              if (!confirm(`Delete face template of ${emp.first_name}? They must enroll again.`)) return;
                              try { await apiRequest(`/api/face/${emp.id}`, { method: 'DELETE' }); window.location.reload(); }
                              catch (err: any) { alert(err.message || 'Failed to delete face template.'); }
                            }}
                            className="ml-2 text-[10px] text-red-400 hover:text-red-300 underline"
                          >
                            Reset
                          </button>
                        )}
                      </td>
                      <td className="p-3.5">
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded-full uppercase font-bold ${
                            emp.status === 'active'
                              ? 'bg-emerald-500/20 text-emerald-400'
                              : emp.status === 'probation'
                              ? 'bg-amber-500/20 text-amber-400'
                              : 'bg-red-500/20 text-red-400'
                          }`}
                        >
                          {emp.status}
                        </span>
                      </td>
                      <td className="p-3.5 text-right space-x-2">
                        <button
                          onClick={() => handleOpen360(emp.id)}
                          className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-medium border border-slate-700 transition"
                        >
                          360 Profile
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Register Employee Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="bg-slate-900 border border-slate-700 rounded-3xl max-w-2xl w-full p-6 sm:p-8 space-y-4 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <UserPlus className="w-5 h-5 text-indigo-400" /> Register New Employee
              </h3>
              <button onClick={() => setShowAddModal(false)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-400">
              Registering an employee automatically provisions their login account with a temporary password that they must change on first sign-in.
            </p>

            {formError && (
              <div className="p-3 bg-red-950/60 border border-red-500/40 rounded-xl text-red-300 text-xs">
                {formError}
              </div>
            )}

            {formSuccess && (
              <div className="p-3 bg-emerald-950/60 border border-emerald-500/40 rounded-xl text-emerald-300 text-xs">
                {formSuccess}
              </div>
            )}

            <form onSubmit={handleAddEmployee} className="space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label className="font-semibold text-slate-300">Employee Code</label>
                  <input
                    type="text"
                    required
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="e.g. EMP004"
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-white text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-semibold text-slate-300">First Name</label>
                  <input
                    type="text"
                    required
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    placeholder="First Name"
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-white text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-semibold text-slate-300">Last Name</label>
                  <input
                    type="text"
                    required
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    placeholder="Last Name"
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-white text-xs"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-semibold text-slate-300">Work Email (Login Email)</label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@company.com"
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-white text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-semibold text-slate-300">Temporary Password</label>
                  <input
                    type="text"
                    required
                    value={tempPassword}
                    onChange={(e) => setTempPassword(e.target.value)}
                    placeholder="Temporary password"
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-white text-xs font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label className="font-semibold text-slate-300">Department</label>
                  <select
                    value={deptId}
                    onChange={(e) => setDeptId(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-white text-xs"
                  >
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="font-semibold text-slate-300">Designation</label>
                  <select
                    value={desId}
                    onChange={(e) => setDesId(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-white text-xs"
                  >
                    <option value="">Select Designation</option>
                    {designations.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.title}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="font-semibold text-slate-300">Gender</label>
                  <select
                    value={gender}
                    onChange={(e) => setGender(e.target.value as any)}
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-white text-xs"
                  >
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                    <option value="other">Other</option>
                  </select>
                </div>
              </div>

              {/* Salary Structure (Section 3 Rule: Gross = 1.5 * Basic) */}
              <div className="p-4 bg-slate-800/60 rounded-2xl border border-slate-700 space-y-2">
                <label className="font-semibold text-slate-300 block">
                  Salary Structure (Section 3 Formula)
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <span className="text-[10px] text-slate-400">Basic Monthly Pay (PKR)</span>
                    <input
                      type="number"
                      required
                      value={basicSalary}
                      onChange={(e) => setBasicSalary(e.target.value)}
                      className="w-full px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-xl text-white font-mono mt-1 text-xs"
                    />
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400">HRA 40% + Medical 10%</span>
                    <div className="text-slate-300 font-mono font-semibold py-2">
                      PKR {(Number(basicSalary) * 0.5).toLocaleString()}
                    </div>
                  </div>
                  <div>
                    <span className="text-[10px] text-indigo-400 font-semibold">Total Gross (1.5x)</span>
                    <div className="text-emerald-400 font-mono font-bold py-2">
                      PKR {(Number(basicSalary) * 1.5).toLocaleString()}
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 bg-slate-800 text-slate-300 rounded-xl text-xs hover:bg-slate-700"
                >
                  Close
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold shadow transition disabled:opacity-50"
                >
                  {submitting ? 'Registering...' : 'Register Employee & Create Login'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CSV Import Dry-Run Modal (Section 3 Rule: checks required fields, unique code/email, valid email, known dept, ISO date, salary > 0) */}
      {showCsvModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="bg-slate-900 border border-slate-700 rounded-3xl max-w-2xl w-full p-6 sm:p-8 space-y-4 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Upload className="w-5 h-5 text-indigo-400" /> CSV Batch Import with Dry-Run Report
              </h3>
              <button onClick={() => setShowCsvModal(false)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-400">
              Paste employee CSV data below. The dry-run engine checks required fields, email format, duplicate codes/emails, recognized departments, and positive salary values before committing.
            </p>

            <textarea
              rows={6}
              value={csvContent}
              onChange={(e) => setCsvContent(e.target.value)}
              placeholder="code,first_name,last_name,email,department_name,basic_salary,joining_date&#10;EMP010,Sarmad,Ali,sarmad.ali@saylani.com,Engineering,180000,2026-02-01&#10;EMP011,Fatima,Zehra,fatima.zehra@saylani.com,Human Resources,140000,2026-03-01"
              className="w-full p-3 bg-slate-950 border border-slate-800 rounded-xl text-white font-mono text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />

            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() =>
                  setCsvContent(
                    `code,first_name,last_name,email,department_name,basic_salary,joining_date\nEMP010,Sarmad,Ali,sarmad.ali@saylani.com,Engineering,180000,2026-02-01\nEMP011,Fatima,Zehra,fatima.zehra@saylani.com,Human Resources,140000,2026-03-01`
                  )
                }
                className="text-[11px] text-indigo-400 hover:underline"
              >
                Insert Sample Rows
              </button>
              <button
                type="button"
                onClick={handleDryRunCSV}
                disabled={dryRunning || !csvContent.trim()}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold shadow disabled:opacity-50"
              >
                {dryRunning ? 'Validating Dry Run...' : 'Execute Dry Run'}
              </button>
            </div>

            {/* Dry-run validation report */}
            {dryRunReport && (
              <div className="p-4 bg-slate-800/80 rounded-2xl border border-slate-700 space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-white">Dry Run Validation Summary:</span>
                  <div className="flex gap-2">
                    <span className="text-emerald-400 font-semibold">{dryRunReport.valid_count} Valid</span>
                    <span className="text-red-400 font-semibold">{dryRunReport.error_count} Errors</span>
                  </div>
                </div>

                {dryRunReport.errors && dryRunReport.errors.length > 0 ? (
                  <div className="space-y-1.5 max-h-36 overflow-y-auto">
                    {dryRunReport.errors.map((err: any, idx: number) => (
                      <div key={idx} className="p-2 bg-red-950/60 border border-red-500/30 rounded-lg text-[11px] text-red-300 flex items-center gap-2">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                        <span>
                          Row {err.row} [{err.field}]: {err.reason}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-2.5 bg-emerald-950/60 border border-emerald-500/30 rounded-xl text-xs text-emerald-300 flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4" /> All rows passed validation checks!
                  </div>
                )}

                {dryRunReport.valid_count > 0 && dryRunReport.error_count === 0 && (
                  <button
                    onClick={handleCommitCSV}
                    className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold uppercase tracking-wider shadow transition"
                  >
                    Commit & Register {dryRunReport.valid_count} Employees
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Employee 360 Profile Modal (Section 3 & 7) */}
      {selected360Emp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="bg-slate-900 border border-slate-700 rounded-3xl max-w-3xl w-full p-6 sm:p-8 space-y-6 shadow-2xl max-h-[90vh] overflow-y-auto text-xs">
            
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <span className="text-[10px] uppercase font-bold text-indigo-400 tracking-wider">Employee 360 Dossier</span>
                <h3 className="text-xl font-bold text-white">
                  {selected360Emp.employee.first_name} {selected360Emp.employee.last_name} ({selected360Emp.employee.code})
                </h3>
              </div>
              <button onClick={() => setSelected360Emp(null)} className="text-slate-400 hover:text-white p-1">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Attrition Risk & Compensation Bar */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="p-4 bg-slate-800/60 rounded-2xl border border-slate-700">
                <span className="text-[10px] text-slate-400 uppercase font-semibold block">Monthly Gross Pay</span>
                <div className="text-xl font-bold text-emerald-400 font-mono mt-1">
                  PKR {selected360Emp.gross_salary.toLocaleString()}
                </div>
                <span className="text-[10px] text-slate-400">Basic: {selected360Emp.employee.basic_salary.toLocaleString()}</span>
              </div>

              <div className="p-4 bg-slate-800/60 rounded-2xl border border-slate-700">
                <span className="text-[10px] text-slate-400 uppercase font-semibold block">Bonus: Attrition Risk Score</span>
                <div className="text-xl font-bold text-amber-400 font-mono mt-1">
                  {selected360Emp.attrition_risk_score} / 100
                </div>
                <span className="text-[10px] text-slate-400">Based on tenure & late trends</span>
              </div>

              <div className="p-4 bg-slate-800/60 rounded-2xl border border-slate-700">
                <span className="text-[10px] text-slate-400 uppercase font-semibold block">Leave Availability</span>
                <div className="text-xl font-bold text-white font-mono mt-1">
                  {selected360Emp.leave_balance?.annual?.remaining}a / {selected360Emp.leave_balance?.sick?.remaining}s / {selected360Emp.leave_balance?.casual?.remaining}c
                </div>
                <span className="text-[10px] text-slate-400">Annual / Sick / Casual left</span>
              </div>
            </div>

            {/* Attendance Logs & Leaves */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <span className="font-semibold text-slate-300 block">Recent Attendance (Last 30d):</span>
                <div className="bg-slate-950 p-3 rounded-xl max-h-40 overflow-y-auto space-y-1.5 border border-slate-800">
                  {selected360Emp.attendance_recent?.length === 0 ? (
                    <p className="text-slate-500">No attendance entries recorded.</p>
                  ) : (
                    selected360Emp.attendance_recent.map((a: any) => (
                      <div key={a.id} className="flex justify-between text-[11px] text-slate-300">
                        <span>{a.date} ({new Date(a.check_in).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})</span>
                        <span className={`uppercase font-bold ${a.status === 'present' ? 'text-emerald-400' : 'text-amber-400'}`}>
                          {a.status}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <span className="font-semibold text-slate-300 block">Leave History:</span>
                <div className="bg-slate-950 p-3 rounded-xl max-h-40 overflow-y-auto space-y-1.5 border border-slate-800">
                  {selected360Emp.leave_requests?.length === 0 ? (
                    <p className="text-slate-500">No leave requests logged.</p>
                  ) : (
                    selected360Emp.leave_requests.map((l: any) => (
                      <div key={l.id} className="flex justify-between text-[11px] text-slate-300">
                        <span>{l.start_date} ({l.leave_type})</span>
                        <span className={`uppercase font-bold ${l.status === 'approved' ? 'text-emerald-400' : 'text-amber-400'}`}>
                          {l.status}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

          </div>
        </div>
      )}

    </div>
  );
};
