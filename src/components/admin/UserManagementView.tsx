import React, { useState, useEffect } from 'react';
import { Shield, UserPlus, KeyRound, CheckCircle2, AlertCircle, Ban, RefreshCw, X } from 'lucide-react';
import { apiRequest } from '../../lib/api.js';
import type { User } from '../../types.js';

export const UserManagementView: React.FC = () => {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);

  // Create HR Modal
  const [showHrModal, setShowHrModal] = useState(false);
  const [hrEmail, setHrEmail] = useState('');
  const [hrPassword, setHrPassword] = useState('');

  // Reset Password Modal
  const [resetTargetUser, setResetTargetUser] = useState<User | null>(null);
  const [newTempPassword, setNewTempPassword] = useState('Welcome@123');

  const [feedback, setFeedback] = useState<string | null>(null);

  const fetchUsers = async () => {
    try {
      setLoading(true);
      const data = await apiRequest<User[]>('/api/users');
      setUsers(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleCreateHR = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const created = await apiRequest<{ temporary_password: string; user: { email: string } }>('/api/users/hr', {
        method: 'POST',
        body: JSON.stringify({ email: hrEmail.trim(), password: hrPassword || undefined }),
      });
      setFeedback(`HR login created.  Email: ${created.user.email}   Temporary password: ${created.temporary_password}   (share it securely; HR must change it on first login)`);
      setShowHrModal(false);
      setHrEmail('');
      setHrPassword('');
      fetchUsers();
    } catch (err: any) {
      alert(err.message || 'Failed to create HR account.');
    }
  };

  const handleToggleStatus = async (user: User) => {
    const nextStatus = user.status === 'active' ? 'deactivated' : 'active';
    if (!confirm(`Are you sure you want to change status of ${user.email} to ${nextStatus}?`)) return;

    try {
      await apiRequest(`/api/users/${user.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: nextStatus }),
      });
      fetchUsers();
    } catch (err: any) {
      alert(err.message || 'Failed to update user status.');
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetTargetUser) return;

    try {
      await apiRequest(`/api/users/${resetTargetUser.id}/reset-password`, {
        method: 'POST',
        body: JSON.stringify({ temporary_password: newTempPassword }),
      });
      setFeedback(`Password reset for ${resetTargetUser.email}. User must change password on next login.`);
      setResetTargetUser(null);
      fetchUsers();
    } catch (err: any) {
      alert(err.message || 'Password reset failed.');
    }
  };

  return (
    <div className="space-y-6">
      
      {/* Header */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Shield className="w-5 h-5 text-indigo-400" /> User Access & Login Management
          </h2>
          <p className="text-xs text-slate-400">
            Provision HR credentials, deactivate/reactivate compromised accounts, and reset temporary passwords.
          </p>
        </div>

        <button
          onClick={() => setShowHrModal(true)}
          className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold shadow transition flex items-center gap-1.5 cursor-pointer"
        >
          <UserPlus className="w-4 h-4" /> Create HR Login
        </button>
      </div>

      {feedback && (
        <div className="p-3 bg-emerald-950/60 border border-emerald-500/40 rounded-xl text-emerald-300 text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{feedback}</span>
        </div>
      )}

      {/* Users Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-800/80 text-slate-400 font-semibold border-b border-slate-800">
              <tr>
                <th className="p-3.5">User Email</th>
                <th className="p-3.5">System Role</th>
                <th className="p-3.5">Status</th>
                <th className="p-3.5">Must Change Password</th>
                <th className="p-3.5">Registered</th>
                <th className="p-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-slate-300">
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-slate-800/40 transition">
                  <td className="p-3.5 font-mono text-white font-medium">{u.email}</td>
                  <td className="p-3.5">
                    <span
                      className={`text-[10px] font-bold uppercase px-2.5 py-0.5 rounded-full ${
                        u.role === 'admin'
                          ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                          : u.role === 'hr'
                          ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30'
                          : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                      }`}
                    >
                      {u.role}
                    </span>
                  </td>
                  <td className="p-3.5">
                    <span
                      className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                        u.status === 'active'
                          ? 'bg-emerald-500/10 text-emerald-400'
                          : 'bg-red-500/10 text-red-400'
                      }`}
                    >
                      {u.status}
                    </span>
                  </td>
                  <td className="p-3.5 text-slate-400">
                    {u.must_change_password ? (
                      <span className="text-amber-400 font-semibold">Yes (Pending first login)</span>
                    ) : (
                      'No'
                    )}
                  </td>
                  <td className="p-3.5 text-slate-400 font-mono text-[11px]">
                    {new Date(u.created_at).toLocaleDateString()}
                  </td>
                  <td className="p-3.5 text-right space-x-2">
                    <button
                      onClick={() => setResetTargetUser(u)}
                      className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs border border-slate-700 transition"
                    >
                      Reset Password
                    </button>
                    {u.role !== 'admin' && (
                      <button
                        onClick={() => handleToggleStatus(u)}
                        className={`px-2.5 py-1 rounded-lg text-xs font-medium transition ${
                          u.status === 'active'
                            ? 'bg-red-950/60 hover:bg-red-900 text-red-300 border border-red-500/30'
                            : 'bg-emerald-950/60 hover:bg-emerald-900 text-emerald-300 border border-emerald-500/30'
                        }`}
                      >
                        {u.status === 'active' ? 'Deactivate' : 'Activate'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create HR Modal */}
      {showHrModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-3xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <h3 className="text-base font-bold text-white">Create HR Login Account</h3>
            <p className="text-xs text-slate-400">
              HR users have permissions to manage employee registrations, process leaves, and generate payroll drafts.
            </p>

            <form onSubmit={handleCreateHR} className="space-y-3 text-xs">
              <div className="space-y-1">
                <label className="font-semibold text-slate-300">HR Work Email</label>
                <input
                  type="email"
                  required
                  value={hrEmail}
                  onChange={(e) => setHrEmail(e.target.value)}
                  placeholder="hr.officer@company.com"
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-white text-xs"
                />
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-slate-300">Temporary Password</label>
                <input
                  type="text"
                  value={hrPassword}
                  onChange={(e) => setHrPassword(e.target.value)}
                  placeholder="Leave empty to auto-generate"
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-white text-xs font-mono"
                />
                <span className="text-[10px] text-slate-400">Min 8 characters with letters and numbers. Leave empty to auto-generate a strong one. Must be changed on first login.</span>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowHrModal(false)}
                  className="px-3.5 py-2 bg-slate-800 text-slate-300 rounded-xl text-xs hover:bg-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold shadow"
                >
                  Create HR User
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reset Password Modal */}
      {resetTargetUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-3xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <h3 className="text-base font-bold text-white">Reset User Password</h3>
            <p className="text-xs text-slate-400">
              Reset temporary password for <strong>{resetTargetUser.email}</strong>.
            </p>

            <form onSubmit={handleResetPassword} className="space-y-3 text-xs">
              <div className="space-y-1">
                <label className="font-semibold text-slate-300">New Temporary Password</label>
                <input
                  type="text"
                  required
                  value={newTempPassword}
                  onChange={(e) => setNewTempPassword(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-white text-xs font-mono"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setResetTargetUser(null)}
                  className="px-3.5 py-2 bg-slate-800 text-slate-300 rounded-xl text-xs hover:bg-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold shadow"
                >
                  Reset & Require Change
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};
