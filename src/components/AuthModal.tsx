import React, { useState } from 'react';
import { LogIn, KeyRound, Lock, Mail, AlertCircle, CheckCircle2 } from 'lucide-react';
import { apiRequest, setAuthToken } from '../lib/api.js';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onLoginSuccess: (user: any) => void;
  mustChangePasswordUser?: any;
}

export const AuthModal: React.FC<Props> = ({
  isOpen,
  onClose,
  onLoginSuccess,
  mustChangePasswordUser,
}) => {
  const [isChangingPassword, setIsChangingPassword] = useState(!!mustChangePasswordUser);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [forgotMode, setForgotMode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await apiRequest<{ token: string; user: any }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim(), password }),
      });

      setAuthToken(res.token);

      if (res.user.must_change_password) {
        setIsChangingPassword(true);
        setCurrentPassword(password);
      } else {
        onLoginSuccess(res.user);
        onClose();
      }
    } catch (err: any) {
      setError(err.message || 'Login failed. Check your email and password.');
    } finally {
      setLoading(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (newPassword.length < 8 || !/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword)) {
      setError('New password must be at least 8 characters and contain letters and numbers.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('New passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      await apiRequest('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({
          current_password: currentPassword,
          new_password: newPassword,
        }),
      });

      setSuccessMsg('Password updated successfully! Welcome to your account.');
      setTimeout(async () => {
        const me = await apiRequest<{ user: any }>('/api/auth/me');
        onLoginSuccess(me.user);
        onClose();
      }, 1000);
    } catch (err: any) {
      setError(err.message || 'Failed to update password.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-md w-full p-6 sm:p-8 shadow-2xl relative space-y-6">
        
        {/* Header */}
        <div className="text-center space-y-1">
          <div className="w-12 h-12 rounded-2xl bg-indigo-600/20 border border-indigo-500/30 text-indigo-400 mx-auto flex items-center justify-center mb-3">
            {isChangingPassword ? <KeyRound className="w-6 h-6" /> : <LogIn className="w-6 h-6" />}
          </div>
          <h2 className="text-xl font-bold text-white tracking-tight">
            {isChangingPassword ? 'Update Temporary Password' : 'Sign In to HCM Lite'}
          </h2>
          <p className="text-xs text-slate-400">
            {isChangingPassword
              ? 'Security Policy: Please choose a new personal password before first use.'
              : 'Enter your credentials to access your portal.'}
          </p>
        </div>

        {error && (
          <div className="p-3 bg-red-950/60 border border-red-500/40 rounded-xl text-red-300 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {successMsg && (
          <div className="p-3 bg-emerald-950/60 border border-emerald-500/40 rounded-xl text-emerald-300 text-xs flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        {forgotMode ? (
          <ForgotPanel onBack={() => setForgotMode(false)} />
        ) : isChangingPassword ? (
          <form onSubmit={handleChangePassword} className="space-y-4 text-xs">
            <div className="space-y-1">
              <label className="font-semibold text-slate-300">Temporary Password</label>
              <input
                type="password"
                required
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Current temporary password"
                className="w-full px-3.5 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div className="space-y-1">
              <label className="font-semibold text-slate-300">New Personal Password</label>
              <input
                type="password"
                required
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Min 8 characters, letters + numbers"
                className="w-full px-3.5 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div className="space-y-1">
              <label className="font-semibold text-slate-300">Confirm New Password</label>
              <input
                type="password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Repeat new password"
                className="w-full px-3.5 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold shadow transition disabled:opacity-50"
            >
              {loading ? 'Updating Password...' : 'Save Password & Continue'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleLogin} className="space-y-4 text-xs">
            <div className="space-y-1">
              <label className="font-semibold text-slate-300 flex items-center gap-1.5">
                <Mail className="w-3.5 h-3.5 text-slate-400" /> Work Email
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@company.com"
                className="w-full px-3.5 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div className="space-y-1">
              <label className="font-semibold text-slate-300 flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5 text-slate-400" /> Password
              </label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full px-3.5 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold shadow transition disabled:opacity-50 mt-2 cursor-pointer"
            >
              {loading ? 'Verifying...' : 'Sign In'}
            </button>
            <button type="button" onClick={() => { setError(null); setForgotMode(true); }} className="w-full text-center text-[11px] text-slate-400 hover:text-slate-200 underline">
              Forgot password?
            </button>
          </form>
        )}

      </div>
    </div>
  );
};

const fieldCls = 'w-full px-3.5 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500';

/** Two-step forgot/reset password: request a one-time code (delivered to Admins in-app), then set a new password. */
const ForgotPanel: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const [step, setStep] = useState<'request' | 'reset'>('request');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const request = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null); setBusy(true);
    try {
      const r = await apiRequest<{ message: string }>('/api/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) });
      setMsg(r.message); setStep('reset');
    } catch (e2: any) { setErr(e2.message); } finally { setBusy(false); }
  };
  const reset = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null);
    if (pw !== pw2) return setErr('Passwords do not match.');
    setBusy(true);
    try {
      const r = await apiRequest<{ message: string }>('/api/auth/reset-password', { method: 'POST', body: JSON.stringify({ email, code, new_password: pw }) });
      setMsg(r.message); setTimeout(onBack, 1500);
    } catch (e2: any) { setErr(e2.message); } finally { setBusy(false); }
  };

  return (
    <form onSubmit={step === 'request' ? request : reset} className="space-y-4 text-xs">
      {err && <div role="alert" className="p-3 bg-red-950/60 border border-red-500/40 rounded-xl text-red-300">{err}</div>}
      {msg && <div className="p-3 bg-emerald-950/60 border border-emerald-500/40 rounded-xl text-emerald-300">{msg}</div>}
      <label className="block space-y-1"><span className="font-semibold text-slate-300">Work email</span>
        <input type="email" required className={fieldCls} value={email} onChange={(e) => setEmail(e.target.value)} readOnly={step === 'reset'} /></label>
      {step === 'reset' && (
        <>
          <label className="block space-y-1"><span className="font-semibold text-slate-300">One-time reset code (from your Admin)</span>
            <input required className={fieldCls} value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" /></label>
          <label className="block space-y-1"><span className="font-semibold text-slate-300">New password</span>
            <input type="password" required className={fieldCls} value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" /></label>
          <label className="block space-y-1"><span className="font-semibold text-slate-300">Confirm new password</span>
            <input type="password" required className={fieldCls} value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" /></label>
        </>
      )}
      <button type="submit" disabled={busy} className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-semibold disabled:opacity-50">
        {busy ? 'Please wait…' : step === 'request' ? 'Request reset code' : 'Reset password'}
      </button>
      <button type="button" onClick={onBack} className="w-full text-center text-[11px] text-slate-400 hover:text-slate-200 underline">Back to sign in</button>
    </form>
  );
};
