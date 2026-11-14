import React, { useState, useEffect } from 'react';
import {
  Building2,
  Users,
  Clock,
  Calendar,
  FileText,
  DollarSign,
  Shield,
  Bot,
  Bell,
  LogOut,
  Award,
  ChevronRight,
  Menu,
  X,
  Sparkles,
  Camera,
  Layers,
} from 'lucide-react';
import { apiRequest, setAuthToken } from '../lib/api.js';
import type { User, UserRole, Notification } from '../types.js';

interface Props {
  user: User;
  onLogout: () => void;
  activeTab: string;
  onSelectTab: (tab: string) => void;
  onOpenDocGuide: () => void;
  onOpenAI: () => void;
  companyName?: string;
  children: React.ReactNode;
}

export const Layout: React.FC<Props> = ({
  user,
  onLogout,
  activeTab,
  onSelectTab,
  onOpenDocGuide,
  onOpenAI,
  companyName = 'Saylani Tech Innovations Ltd.',
  children,
}) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [showNotifDropdown, setShowNotifDropdown] = useState(false);

  const fetchNotifs = async () => {
    try {
      const data = await apiRequest<Notification[]>('/api/notifications');
      setNotifications(data);
    } catch (e) {
      // ignore
    }
  };

  useEffect(() => {
    fetchNotifs();
    const interval = setInterval(fetchNotifs, 15000);
    return () => clearInterval(interval);
  }, [user.id]);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const markNotifRead = async (id: string) => {
    try {
      await apiRequest(`/api/notifications/${id}/read`, { method: 'PATCH' });
      setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    } catch (e) {
      // ignore
    }
  };

  // Role-specific navigation items (Section 2 & 8)
  const navItems =
    user.role === 'admin'
      ? [
          { id: 'admin-dashboard', label: 'Executive Dashboard', icon: Building2 },
          { id: 'company-settings', label: 'Company Settings', icon: Layers },
          { id: 'user-management', label: 'User Logins', icon: Shield },
          { id: 'payroll-runs', label: 'Payroll & Locking', icon: DollarSign },
          { id: 'audit-logs', label: 'Audit Trail', icon: Shield },
        ]
      : user.role === 'hr'
      ? [
          { id: 'hr-dashboard', label: 'Operations Dashboard', icon: Users },
          { id: 'employee-directory', label: 'Employees & 360', icon: Users },
          { id: 'attendance-board', label: 'Attendance Board', icon: Clock },
          { id: 'leave-approvals', label: 'Leave Approvals', icon: Calendar },
          { id: 'payroll-runs', label: 'Monthly Payroll', icon: DollarSign },
        ]
      : [
          { id: 'employee-dashboard', label: 'My Dashboard', icon: Building2 },
          { id: 'face-attendance', label: 'Camera Attendance', icon: Camera },
          { id: 'employee-leaves', label: 'Smart Leave (AI)', icon: Calendar },
          { id: 'attendance-history', label: 'Attendance History', icon: Clock },
          { id: 'employee-payslips', label: 'My Payslips', icon: FileText },
        ];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      
      {/* Top Navbar */}
      <header className="sticky top-0 z-40 bg-slate-900/90 backdrop-blur-md border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          
          {/* Logo & Mobile Toggle */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="lg:hidden p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800"
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>

            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-600 to-purple-600 flex items-center justify-center text-white shadow-md shadow-indigo-600/30">
                <Building2 className="w-5 h-5" />
              </div>
              <div>
                <span className="font-extrabold text-base tracking-tight text-white block">
                  HCM Lite
                </span>
                <span className="text-[10px] text-slate-400 hidden sm:block truncate max-w-[200px]">
                  {companyName}
                </span>
              </div>
            </div>
          </div>

          {/* Right Controls: Docs, AI, Notifs, User */}
          <div className="flex items-center gap-2">
            
            {/* 5-Min Demo Guide Modal Button */}
            <button
              onClick={onOpenDocGuide}
              className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold border border-slate-700 flex items-center gap-1.5 transition cursor-pointer"
              title="Open Saylani Hackathon 5-Minute Evaluation Guide"
            >
              <Award className="w-3.5 h-3.5 text-amber-400" />
              <span className="hidden sm:inline">Demo Guide</span>
            </button>

            {/* AI Assistant Button */}
            <button
              onClick={onOpenAI}
              className="px-3 py-1.5 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white rounded-xl text-xs font-bold shadow-md shadow-indigo-600/30 flex items-center gap-1.5 transition cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-300" />
              <span className="hidden sm:inline">Ask AI</span>
            </button>

            {/* Notification Bell */}
            <div className="relative">
              <button
                onClick={() => setShowNotifDropdown(!showNotifDropdown)}
                className="p-2 text-slate-400 hover:text-white rounded-xl hover:bg-slate-800 relative transition"
              >
                <Bell className="w-4 h-4" />
                {unreadCount > 0 && (
                  <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
                )}
              </button>

              {showNotifDropdown && (
                <div className="absolute right-0 mt-2 w-80 bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-3 z-50 text-xs space-y-2">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                    <span className="font-bold text-white">Notifications ({unreadCount} new)</span>
                    <button
                      onClick={() => setShowNotifDropdown(false)}
                      className="text-slate-400 hover:text-white"
                    >
                      ✕
                    </button>
                  </div>
                  <div className="space-y-1.5 max-h-60 overflow-y-auto">
                    {notifications.length === 0 ? (
                      <p className="text-slate-500 text-center py-4">No notifications yet.</p>
                    ) : (
                      notifications.slice(0, 8).map((n) => (
                        <div
                          key={n.id}
                          onClick={() => markNotifRead(n.id)}
                          className={`p-2.5 rounded-xl border transition cursor-pointer ${
                            n.read
                              ? 'bg-slate-950/40 border-slate-800/80 text-slate-400'
                              : 'bg-indigo-950/40 border-indigo-500/30 text-slate-200'
                          }`}
                        >
                          <div className="font-semibold text-white text-[11px]">{n.title}</div>
                          <p className="text-[10px] text-slate-300 mt-0.5">{n.message}</p>
                          <span className="text-[9px] text-slate-500 block mt-1">
                            {new Date(n.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* User Profile & Logout */}
            <div className="flex items-center gap-2 pl-2 border-l border-slate-800">
              <div className="hidden sm:block text-right">
                <span className="font-semibold text-white text-xs block leading-tight truncate max-w-[120px]">
                  {user.email}
                </span>
                <span
                  className={`text-[9px] font-bold uppercase tracking-wider ${
                    user.role === 'admin'
                      ? 'text-emerald-400'
                      : user.role === 'hr'
                      ? 'text-indigo-400'
                      : 'text-amber-400'
                  }`}
                >
                  {user.role}
                </span>
              </div>
              <button
                onClick={onLogout}
                className="p-2 text-slate-400 hover:text-red-400 rounded-xl hover:bg-slate-800 transition"
                title="Sign Out"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>

          </div>

        </div>
      </header>

      {/* Main Layout Area */}
      <div className="max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 flex-1 flex flex-col lg:flex-row gap-6">
        
        {/* Desktop Sidebar Navigation */}
        <aside className="hidden lg:block w-64 shrink-0 space-y-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-4 space-y-1 shadow-xl">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 px-3 py-1 block">
              {user.role.toUpperCase()} WORKSPACE
            </span>

            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => onSelectTab(item.id)}
                  className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-2xl text-xs font-semibold transition cursor-pointer ${
                    isActive
                      ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{item.label}</span>
                  </div>
                  {isActive && <ChevronRight className="w-3.5 h-3.5" />}
                </button>
              );
            })}
          </div>

          {/* Quick Info Box */}
          <div className="bg-slate-900/60 border border-slate-800/80 rounded-3xl p-4 text-xs space-y-2">
            <span className="font-bold text-slate-300 block">Saylani Hackathon 2026</span>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Zaitoon Ashraf IT Park Campus. Built strictly following 25 functionalities and Section 3 business rules.
            </p>
          </div>
        </aside>

        {/* Mobile Navigation Drawer */}
        {mobileMenuOpen && (
          <div className="lg:hidden fixed inset-0 z-50 bg-black/80 backdrop-blur-sm p-4 flex flex-col">
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <span className="font-bold text-white text-sm">{user.role.toUpperCase()} MENU</span>
                <button onClick={() => setMobileMenuOpen(false)} className="text-slate-400 hover:text-white">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="space-y-1">
                {navItems.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => {
                      onSelectTab(item.id);
                      setMobileMenuOpen(false);
                    }}
                    className={`w-full text-left px-4 py-3 rounded-xl text-xs font-semibold ${
                      activeTab === item.id ? 'bg-indigo-600 text-white' : 'text-slate-300'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Main Content Area */}
        <main className="flex-1 min-w-0">{children}</main>

      </div>

      {/* Footer */}
      <footer className="border-t border-slate-900 py-4 text-center text-xs text-slate-600">
        Saylani IT Training Hackathon · HCM Lite — Human Capital Management & Biometrics System · 24 October 2026
      </footer>

    </div>
  );
};
