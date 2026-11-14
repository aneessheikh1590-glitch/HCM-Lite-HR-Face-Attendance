import React, { useState, useEffect } from 'react';
import { apiRequest, setAuthToken, getAuthToken } from './lib/api';
import { SetupWizard } from './components/SetupWizard';
import { AuthModal } from './components/AuthModal';
import { Layout } from './components/Layout';
import { DocGuideModal } from './components/DocGuideModal';
import { AIAssistantDrawer } from './components/AIAssistantDrawer';

// Admin views
import { AdminDashboard } from './components/admin/AdminDashboard';
import { CompanySettingsView } from './components/admin/CompanySettingsView';
import { UserManagementView } from './components/admin/UserManagementView';
import { AuditLogView } from './components/admin/AuditLogView';

// HR views
import { HRDashboard } from './components/hr/HRDashboard';
import { EmployeeDirectoryView } from './components/hr/EmployeeDirectoryView';
import { AttendanceBoardView } from './components/hr/AttendanceBoardView';
import { LeaveApprovalsView } from './components/hr/LeaveApprovalsView';
import { PayrollRunsView } from './components/hr/PayrollRunsView';

// Employee views
import { EmployeeDashboard } from './components/employee/EmployeeDashboard';
import { FaceAttendanceView } from './components/employee/FaceAttendanceView';
import { EmployeeLeavesView } from './components/employee/EmployeeLeavesView';
import { AttendanceHistoryView } from './components/employee/AttendanceHistoryView';
import { EmployeePayslipsView } from './components/employee/EmployeePayslipsView';

import type { User, UserRole, Employee, CompanySettings } from './types';

export default function App() {
  const [systemConfigured, setSystemConfigured] = useState<boolean | null>(null);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [currentEmployee, setCurrentEmployee] = useState<Employee | null>(null);
  const [companySettings, setCompanySettings] = useState<CompanySettings | undefined>(undefined);

  const [activeTab, setActiveTab] = useState<string>('dashboard');
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showDocGuide, setShowDocGuide] = useState(false);
  const [showAIDrawer, setShowAIDrawer] = useState(false);

  // Initial Boot & System Check
  const bootSystem = async () => {
    try {
      const status = await apiRequest<{ is_configured: boolean; company_name: string }>('/api/system/status');
      setSystemConfigured(status.is_configured);

      if (status.is_configured) {
        const token = getAuthToken();
        if (token) {
          try {
            const me = await apiRequest<{ user: User & { profile?: Employee }; settings: CompanySettings }>('/api/auth/me');
            setCurrentUser(me.user);
            setCurrentEmployee(me.user.profile || null);
            setCompanySettings(me.settings);
            setDefaultTabForRole(me.user.role);
          } catch (err) {
            setAuthToken(null);
            setShowAuthModal(true);
          }
        } else {
          setShowAuthModal(true);
        }
      }
    } catch (err) {
      console.error('System boot error:', err);
      setSystemConfigured(false);
    }
  };

  useEffect(() => {
    bootSystem();
  }, []);

  const setDefaultTabForRole = (role: UserRole) => {
    if (role === 'admin') setActiveTab('admin-dashboard');
    else if (role === 'hr') setActiveTab('hr-dashboard');
    else setActiveTab('employee-dashboard');
  };

  const handleLoginSuccess = (user: User & { profile?: Employee }) => {
    setCurrentUser(user);
    setCurrentEmployee(user.profile || null);
    setDefaultTabForRole(user.role);
    setShowAuthModal(false);
  };

  const handleLogout = () => {
    setAuthToken(null);
    setCurrentUser(null);
    setCurrentEmployee(null);
    setShowAuthModal(true);
  };

  // If system status is checking
  if (systemConfigured === null) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-400 text-xs font-mono">
        Starting HCM Lite Engine...
      </div>
    );
  }

  // If system is not yet configured, launch First-Run Setup Wizard
  if (!systemConfigured) {
    return (
      <>
        <SetupWizard
          onSetupComplete={(adminUser) => {
            setSystemConfigured(true);
            handleLoginSuccess(adminUser);
          }}
        />
        <DocGuideModal
          isOpen={showDocGuide}
          onClose={() => setShowDocGuide(false)}
        />
      </>
    );
  }

  // If no user is logged in
  if (!currentUser) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col justify-center items-center p-4">
        <AuthModal
          isOpen={true}
          onClose={() => {}}
          onLoginSuccess={handleLoginSuccess}
        />
        <DocGuideModal
          isOpen={showDocGuide}
          onClose={() => setShowDocGuide(false)}
        />
      </div>
    );
  }

  return (
    <Layout
      user={currentUser}
      onLogout={handleLogout}
      activeTab={activeTab}
      onSelectTab={setActiveTab}
      onOpenDocGuide={() => setShowDocGuide(true)}
      onOpenAI={() => setShowAIDrawer(true)}
      companyName={companySettings?.company_name}
    >
      {/* Admin Module Screens */}
      {currentUser.role === 'admin' && (
        <>
          {activeTab === 'admin-dashboard' && (
            <AdminDashboard
              onNavigate={setActiveTab}
              onOpenAI={() => setShowAIDrawer(true)}
            />
          )}
          {activeTab === 'company-settings' && (
            <CompanySettingsView userRole="admin" />
          )}
          {activeTab === 'user-management' && <UserManagementView />}
          {activeTab === 'payroll-runs' && (
            <PayrollRunsView
              userRole="admin"
              companyName={companySettings?.company_name}
            />
          )}
          {activeTab === 'audit-logs' && <AuditLogView />}
        </>
      )}

      {/* HR Module Screens */}
      {currentUser.role === 'hr' && (
        <>
          {activeTab === 'hr-dashboard' && (
            <HRDashboard
              onNavigate={setActiveTab}
              onOpenAI={() => setShowAIDrawer(true)}
            />
          )}
          {activeTab === 'employee-directory' && <EmployeeDirectoryView />}
          {activeTab === 'attendance-board' && <AttendanceBoardView />}
          {activeTab === 'leave-approvals' && <LeaveApprovalsView />}
          {activeTab === 'payroll-runs' && (
            <PayrollRunsView
              userRole="hr"
              companyName={companySettings?.company_name}
            />
          )}
        </>
      )}

      {/* Employee Module Screens */}
      {currentUser.role === 'employee' && (
        <>
          {currentEmployee ? (
            <>
              {activeTab === 'employee-dashboard' && (
                <EmployeeDashboard
                  employee={currentEmployee}
                  onNavigate={setActiveTab}
                  onOpenAI={() => setShowAIDrawer(true)}
                />
              )}
              {activeTab === 'face-attendance' && (
                <FaceAttendanceView
                  employee={currentEmployee}
                  settings={companySettings}
                  onAttendanceSuccess={() => setActiveTab('attendance-history')}
                  onRequestCorrection={() => setActiveTab('attendance-history')}
                />
              )}
              {activeTab === 'employee-leaves' && (
                <EmployeeLeavesView employeeId={currentEmployee.id} />
              )}
              {activeTab === 'attendance-history' && (
                <AttendanceHistoryView employeeId={currentEmployee.id} />
              )}
              {activeTab === 'employee-payslips' && (
                <EmployeePayslipsView
                  employeeId={currentEmployee.id}
                  companyName={companySettings?.company_name}
                />
              )}
            </>
          ) : (
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 text-center text-xs text-slate-400">
              No employee record linked to this login account. Contact HR to link your profile.
            </div>
          )}
        </>
      )}

      {/* Documentation & 5-Min Hackathon Demo Guide */}
      <DocGuideModal
        isOpen={showDocGuide}
        onClose={() => setShowDocGuide(false)}
      />

      {/* AI Assistant Drawer (Gemini Tool Calling) */}
      <AIAssistantDrawer
        isOpen={showAIDrawer}
        onClose={() => setShowAIDrawer(false)}
        userRole={currentUser.role}
        userEmail={currentUser.email}
      />

      {/* Auth Modal when opened */}
      <AuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
        onLoginSuccess={handleLoginSuccess}
        mustChangePasswordUser={currentUser?.must_change_password ? currentUser : undefined}
      />
    </Layout>
  );
}
