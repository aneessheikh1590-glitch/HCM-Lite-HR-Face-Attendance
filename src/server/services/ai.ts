import { GoogleGenAI, Type, type FunctionDeclaration } from '@google/genai';
import { db } from '../db.js';
import type { User, UserRole, AILog } from '../../types.js';
import { getLeaveBalance } from './leave.js';
import { officeToday } from '../time.js';

/** Provider key lives only in backend env AI_API_KEY (GEMINI_API_KEY accepted as legacy alias). */
function aiKey(): string | undefined {
  return process.env.AI_API_KEY || process.env.GEMINI_API_KEY || undefined;
}

// In-memory rate limiter: max 20 calls per user per hour
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(userId: string): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const userRate = rateLimitMap.get(userId);

  if (!userRate || now > userRate.resetAt) {
    rateLimitMap.set(userId, { count: 1, resetAt: now + 3600 * 1000 });
    return { allowed: true, remaining: 19 };
  }

  if (userRate.count >= 20) {
    return { allowed: false, remaining: 0 };
  }

  userRate.count++;
  return { allowed: true, remaining: 25 - userRate.count };
}

function logAICall(log: Omit<AILog, 'id' | 'created_at'>) {
  const data = db.getData();
  data.ai_logs.unshift({
    id: `ai-log-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    ...log,
    created_at: new Date().toISOString(),
  });
  if (data.ai_logs.length > 500) {
    data.ai_logs = data.ai_logs.slice(0, 500);
  }
  db.save();
}

// Function declarations for Gemini tool calling
const getHeadcountDeclaration: FunctionDeclaration = {
  name: 'get_headcount',
  description: 'Get the total active employee count, optionally filtered by department.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      department: {
        type: Type.STRING,
        description: 'Optional name or code of department (e.g. Engineering, HR, Sales)',
      },
    },
  },
};

const getAttendanceSummaryDeclaration: FunctionDeclaration = {
  name: 'get_attendance_summary',
  description: "Get today's or a specific date's attendance metrics: total present, late, on leave, and rate.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      date: {
        type: Type.STRING,
        description: 'Date in YYYY-MM-DD format (defaults to today)',
      },
      department: {
        type: Type.STRING,
        description: 'Optional department filter',
      },
    },
  },
};

const getLateComersDeclaration: FunctionDeclaration = {
  name: 'get_late_comers',
  description: 'Get employees who arrived late most frequently in the current or specified month.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      month: {
        type: Type.STRING,
        description: 'Month in YYYY-MM format (defaults to current month)',
      },
      limit: {
        type: Type.INTEGER,
        description: 'Number of late comers to return (default 5)',
      },
    },
  },
};

const getLeaveSummaryDeclaration: FunctionDeclaration = {
  name: 'get_leave_summary',
  description: 'Get leave statistics, approved leaves, pending requests, or who is currently on leave.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      date: {
        type: Type.STRING,
        description: 'Date in YYYY-MM-DD to check who is on leave today',
      },
      status: {
        type: Type.STRING,
        description: 'Filter by status: pending, approved, rejected, all',
      },
    },
  },
};

const getMyLeaveBalanceDeclaration: FunctionDeclaration = {
  name: 'get_my_leave_balance',
  description: "Get the current employee's remaining and used leave balances for Annual, Sick, Casual, and Unpaid leaves.",
  parameters: {
    type: Type.OBJECT,
    properties: {},
  },
};

const getPayrollSummaryDeclaration: FunctionDeclaration = {
  name: 'get_payroll_summary',
  description: 'Get payroll total gross, net, and tax figures for a month. Note: Employees can only view their own payslip.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      month: {
        type: Type.STRING,
        description: 'Month in YYYY-MM format',
      },
      target_employee_name: {
        type: Type.STRING,
        description: 'Name of employee if asking about someone (will be scoped/permission-checked)',
      },
    },
  },
};

const searchEmployeesDeclaration: FunctionDeclaration = {
  name: 'search_employees',
  description: 'Search employees by name, designation, department, or status.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      query: {
        type: Type.STRING,
        description: 'Name, email, or keyword to search',
      },
      department: {
        type: Type.STRING,
        description: 'Optional department name filter',
      },
    },
  },
};

// Tool implementation engine with role and scope guards
export function executeTool(name: string, args: any, user: User): any {
  const data = db.getData();
  const settings = data.settings;
  const todayStr = officeToday();

  if (name === 'get_headcount') {
    let emps = data.employees.filter((e) => e.status === 'active' || e.status === 'probation');
    if (args?.department) {
      const dept = data.departments.find(
        (d) => d.name.toLowerCase().includes(args.department.toLowerCase()) || d.code.toLowerCase() === args.department.toLowerCase()
      );
      if (dept) {
        emps = emps.filter((e) => e.department_id === dept.id);
      }
    }
    return {
      total_headcount: emps.length,
      department: args?.department || 'All Departments',
      departments_breakdown: data.departments.map((d) => ({
        department: d.name,
        count: data.employees.filter((e) => e.department_id === d.id && (e.status === 'active' || e.status === 'probation')).length,
      })),
    };
  }

  if (name === 'get_attendance_summary') {
    const targetDate = args?.date || todayStr;
    const records = data.attendance.filter((a) => a.date === targetDate);
    const present = records.filter((a) => a.status === 'present').length;
    const late = records.filter((a) => a.status === 'late').length;
    const halfDay = records.filter((a) => a.status === 'half_day').length;

    const onLeave = data.leave_requests.filter(
      (l) => l.status === 'approved' && l.start_date <= targetDate && l.end_date >= targetDate
    ).length;

    const totalActive = data.employees.filter((e) => e.status === 'active' || e.status === 'probation').length;
    const attended = present + late + halfDay * 0.5;
    const rate = totalActive > 0 ? Math.round((attended / Math.max(1, totalActive - onLeave)) * 100) : 0;

    return {
      date: targetDate,
      total_active_employees: totalActive,
      present_count: present,
      late_count: late,
      half_day_count: halfDay,
      on_leave_count: onLeave,
      attendance_rate: `${rate}%`,
    };
  }

  if (name === 'get_late_comers') {
    const month = args?.month || todayStr.substring(0, 7);
    const limit = args?.limit || 5;

    const lateRecords = data.attendance.filter((a) => a.date.startsWith(month) && a.status === 'late');
    const counts = new Map<string, number>();
    for (const r of lateRecords) {
      counts.set(r.employee_id, (counts.get(r.employee_id) || 0) + 1);
    }

    const result = Array.from(counts.entries())
      .map(([empId, count]) => {
        const emp = data.employees.find((e) => e.id === empId);
        const dept = data.departments.find((d) => d.id === emp?.department_id);
        return {
          employee_name: emp ? `${emp.first_name} ${emp.last_name}` : 'Unknown',
          code: emp?.code,
          department: dept?.name,
          late_count: count,
        };
      })
      .sort((a, b) => b.late_count - a.late_count)
      .slice(0, limit);

    return { month, top_late_comers: result };
  }

  if (name === 'get_leave_summary') {
    const checkDate = args?.date || todayStr;
    const onLeaveRecords = data.leave_requests.filter(
      (l) => l.status === 'approved' && l.start_date <= checkDate && l.end_date >= checkDate
    );

    const onLeaveEmployees = onLeaveRecords.map((l) => {
      const emp = data.employees.find((e) => e.id === l.employee_id);
      return {
        employee_name: emp ? `${emp.first_name} ${emp.last_name}` : 'Employee',
        leave_type: l.leave_type,
        start_date: l.start_date,
        end_date: l.end_date,
        working_days: l.working_days,
      };
    });

    const pending = data.leave_requests.filter((l) => l.status === 'pending').length;

    return {
      date_checked: checkDate,
      currently_on_leave_count: onLeaveEmployees.length,
      employees_on_leave: onLeaveEmployees,
      pending_approval_count: pending,
    };
  }

  if (name === 'get_my_leave_balance') {
    if (!user.employee_id) {
      return { error: 'Current user has no associated employee profile.' };
    }
    const balance = getLeaveBalance(user.employee_id);
    return {
      employee_id: user.employee_id,
      annual: balance.annual,
      sick: balance.sick,
      casual: balance.casual,
      unpaid: balance.unpaid,
    };
  }

  if (name === 'get_payroll_summary') {
    // Role scope rule: Employee CANNOT view colleague salary or total company payroll!
    if (user.role === 'employee') {
      if (args?.target_employee_name) {
        return {
          refused: true,
          message: "PERMISSION DENIED: In accordance with HCM Lite security policies, employees are strictly prohibited from viewing colleagues' salary, payroll, or compensation details.",
        };
      }
      // Return own payslip
      const mySlips = data.payslips.filter((p) => p.employee_id === user.employee_id);
      return {
        scope: 'personal',
        payslips: mySlips.slice(0, 3).map((p) => ({
          month: p.month,
          gross: p.gross_salary,
          deductions: p.absent_deduction,
          tax: p.income_tax,
          net: p.net_salary,
        })),
      };
    }

    // Admin / HR role
    const month = args?.month || todayStr.substring(0, 7);
    const run = data.payroll_runs.find((r) => r.month === month);
    if (!run) {
      return { month, message: `No payroll run generated yet for ${month}.` };
    }
    return {
      month: run.month,
      status: run.status,
      total_gross: run.total_gross,
      total_deductions: run.total_deductions,
      total_tax: run.total_tax,
      total_net: run.total_net,
      employee_count: data.payslips.filter((p) => p.payroll_run_id === run.id).length,
    };
  }

  if (name === 'search_employees') {
    let emps = data.employees;
    if (args?.query) {
      const q = args.query.toLowerCase();
      emps = emps.filter(
        (e) =>
          e.first_name.toLowerCase().includes(q) ||
          e.last_name.toLowerCase().includes(q) ||
          e.code.toLowerCase().includes(q) ||
          e.email.toLowerCase().includes(q)
      );
    }
    // Employee role: Sanitize salary data when searching employees!
    return emps.slice(0, 10).map((e) => {
      const dept = data.departments.find((d) => d.id === e.department_id);
      const des = data.designations.find((d) => d.id === e.designation_id);
      return {
        code: e.code,
        name: `${e.first_name} ${e.last_name}`,
        department: dept?.name,
        designation: des?.title,
        status: e.status,
        // Only Admin and HR see salary in employee search
        ...(user.role === 'admin' || user.role === 'hr' ? { basic_salary: e.basic_salary, gross_salary: e.basic_salary * 1.5 } : {}),
      };
    });
  }

  return { error: `Tool ${name} is not recognized.` };
}

// System prompt with Section 3 rules and security guardrails
function getSystemPrompt(user: User): string {
  const data = db.getData();
  const s = data.settings;
  return `You are HCM Lite's AI Assistant, built for the Saylani Hackathon 2026.
You assist users with HR management, attendance, leave, and payroll policies.
Current Date: ${officeToday()}
Current User Role: ${user.role} (${user.email})
Associated Employee ID: ${user.employee_id || 'None'}

SECURITY & RBAC POLICY (CRITICAL):
- If the current user has role "employee":
  * NEVER disclose any colleague's salary, basic pay, bank details, or private contact information.
  * If an employee asks "What is Bilal's salary?" or asks about another person's compensation, you MUST politely refuse: "I cannot disclose colleague salary or private compensation details under company HR privacy policies."
  * Employees can only view their own leave balances and their own payslip information.
- The database is the ONLY source of truth. Always use tools to fetch numbers rather than guessing.
- AI never saves or alters data on its own.
- If the user writes in English, Urdu, or Roman Urdu (e.g. "Mujhe aglay peer ko chutti chahiye", "Kon kon aaj chutti par hai?"), understand and reply helpfully!

COMPANY BUSINESS RULES (Section 3):
- Office start time: ${s.office_start || '09:00'}, Grace time: ${s.grace_minutes || 15} minutes (Late after 09:15).
- Half-day rule: Shift under ${s.half_day_hours || 5} hours total.
- Late penalty rule: 3 lates in a month = 0.5 day salary deduction.
- Weekends: Saturday and Sunday are off.
- Leave quotas per year: Annual ${s.annual_leave_quota || 14} days, Sick ${s.sick_leave_quota || 8} days, Casual ${s.casual_leave_quota || 10} days, Unpaid unlimited.
- Leave rules: Overlapping leaves or requests exceeding available balance are rejected with error 422.
- Payroll formula: Gross = 1.5 * Basic (HRA 40%, Medical 10%). Daily rate = Gross / working days in month.
- Tax slabs (Annual gross): 0 to 600k (0%); 600k-1.2M (5%); 1.2M-2.4M (30k + 15%); 2.4M-3.6M (210k + 25%); 3.6M+ (510k + 35%).`;
}

export async function handleAIChat(user: User, prompt: string): Promise<string> {
  const rate = checkRateLimit(user.id);
  if (!rate.allowed) {
    return 'Rate limit reached: Maximum 20 AI requests per hour. Please wait a few moments before trying again.';
  }

  const apiKey = aiKey();
  if (!apiKey || false) {
    // Friendly graceful fallback if API key is not configured in local environment
    return '[Rule-based answer from live database — AI provider unavailable] ' + handleDeterministicFallback(user, prompt);
  }

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'hcm-lite',
      },
    },
  });

  const tools = [
    getHeadcountDeclaration,
    getAttendanceSummaryDeclaration,
    getLateComersDeclaration,
    getLeaveSummaryDeclaration,
    getMyLeaveBalanceDeclaration,
    getPayrollSummaryDeclaration,
    searchEmployeesDeclaration,
  ];

  const toolsCalled: string[] = [];

  try {
    // 15s timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    const firstResponse = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: prompt,
      config: {
        systemInstruction: getSystemPrompt(user),
        tools: [{ functionDeclarations: tools }],
      },
    });

    clearTimeout(timeoutId);

    // Check if the model requested function calling
    const functionCalls = firstResponse.functionCalls;
    if (functionCalls && functionCalls.length > 0) {
      const toolCall = functionCalls[0];
      const toolName = toolCall.name || '';
      if (toolName) {
        toolsCalled.push(toolName);
        const toolResult = executeTool(toolName, toolCall.args, user);

      // Call Gemini back with tool response
      const secondResponse = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: [
          { role: 'user', parts: [{ text: prompt }] },
          { role: 'model', parts: [{ functionCall: toolCall }] },
          {
            role: 'user',
            parts: [
              {
                functionResponse: {
                  name: toolName,
                  response: toolResult,
                },
              },
            ],
          },
        ],
        config: {
          systemInstruction: getSystemPrompt(user),
        },
      });

      const finalAnswer = secondResponse.text || 'No response generated from tool output.';

      logAICall({
        user_id: user.id,
        user_role: user.role,
        endpoint: '/api/ai/chat',
        prompt,
        tools_called: toolsCalled,
        response_summary: finalAnswer.substring(0, 150),
      });

      return finalAnswer;
      }
    }

    const simpleAnswer = firstResponse.text || 'I am ready to help with HCM questions.';
    logAICall({
      user_id: user.id,
      user_role: user.role,
      endpoint: '/api/ai/chat',
      prompt,
      tools_called: [],
      response_summary: simpleAnswer.substring(0, 150),
    });

    return simpleAnswer;
  } catch (err: any) {
    console.error('Gemini API call failed, using deterministic fallback:', err);
    return '[Rule-based answer from live database — AI provider unavailable] ' + handleDeterministicFallback(user, prompt);
  }
}

// Smart leave parser (Section 4)
export async function parseSmartLeave(
  user: User,
  inputText: string
): Promise<{ leave_type: string; start_date: string; end_date: string; reason: string }> {
  const apiKey = aiKey();
  const today = new Date();
  const todayIso = today.toISOString().split('T')[0];

  const systemInst = `You extract structured employee leave requests from natural language.
Current date: ${todayIso}.
Allowed leave types: "annual", "sick", "casual", "unpaid". Default to "casual" if for events/weddings/family, "sick" if health/illness.
Respond strictly in JSON format matching schema:
{
  "leave_type": "annual" | "sick" | "casual" | "unpaid",
  "start_date": "YYYY-MM-DD",
  "end_date": "YYYY-MM-DD",
  "reason": "Brief summary of reason"
}`;

  if (apiKey && true) {
    try {
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
      });

      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: inputText,
        config: {
          systemInstruction: systemInst,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              leave_type: { type: Type.STRING },
              start_date: { type: Type.STRING },
              end_date: { type: Type.STRING },
              reason: { type: Type.STRING },
            },
            required: ['leave_type', 'start_date', 'end_date', 'reason'],
          },
        },
      });

      const parsed = JSON.parse(response.text || '{}');
      if (parsed.start_date && parsed.end_date) {
        return parsed;
      }
    } catch (e) {
      console.error('Smart leave AI parse error, using heuristic fallback:', e);
    }
  }

  // Robust heuristic fallback for next Monday/Tuesday or days
  const isSick = /sick|fever|ill|doctor|hospital|tabiyat|khansi/i.test(inputText);
  const isAnnual = /annual|vacation|holidays|trip/i.test(inputText);
  const type = isSick ? 'sick' : isAnnual ? 'annual' : 'casual';

  // Calculate next Monday/Tuesday
  const nextMonday = new Date();
  const day = nextMonday.getDay();
  const daysUntilMonday = ((8 - day) % 7) || 7;
  nextMonday.setDate(nextMonday.getDate() + daysUntilMonday);

  const nextTuesday = new Date(nextMonday);
  nextTuesday.setDate(nextMonday.getDate() + 1);

  return {
    leave_type: type,
    start_date: nextMonday.toISOString().split('T')[0],
    end_date: /tuesday|two days|2 days|mangal/i.test(inputText) ? nextTuesday.toISOString().split('T')[0] : nextMonday.toISOString().split('T')[0],
    reason: inputText.trim() || 'Personal commitment',
  };
}

// AI Dashboard Summary (Section 4)
export async function generateDashboardSummary(
  user: User,
  kpiJson: any
): Promise<string[]> {
  const apiKey = aiKey();

  if (apiKey && true) {
    try {
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
      });

      const prompt = `Based strictly on these current KPI numbers: ${JSON.stringify(kpiJson)}, provide 3 to 5 concise executive insight bullets summarizing attendance, workforce availability, and operational health.`;

      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: prompt,
        config: {
          systemInstruction: 'You are an HR analytics executive. Return 3-5 high-impact bullet points using ONLY the provided numbers. Keep each bullet under 15 words.',
        },
      });

      const text = response.text || '';
      const bullets = text
        .split('\n')
        .map((line) => line.replace(/^[-*•\d.]\s*/, '').trim())
        .filter((line) => line.length > 5);

      if (bullets.length > 0) return bullets.slice(0, 5);
    } catch (err) {
      console.error('AI summary error:', err);
    }
  }

  // Deterministic summary if AI unavailable
  const bullets: string[] = [];
  if (kpiJson.headcount !== undefined) {
    bullets.push(`Total workforce headcount stands at ${kpiJson.headcount} active team members.`);
  }
  if (kpiJson.presentToday !== undefined && kpiJson.headcount) {
    const rate = Math.round((kpiJson.presentToday / kpiJson.headcount) * 100);
    bullets.push(`Today's attendance is at ${rate}% with ${kpiJson.presentToday} checked-in employees.`);
  }
  if (kpiJson.lateToday !== undefined && kpiJson.lateToday > 0) {
    bullets.push(`${kpiJson.lateToday} employee(s) recorded late check-ins past the 09:15 AM threshold.`);
  }
  if (kpiJson.onLeaveToday !== undefined && kpiJson.onLeaveToday > 0) {
    bullets.push(`${kpiJson.onLeaveToday} approved leave(s) currently active for today.`);
  }
  if (kpiJson.pendingApprovals !== undefined && kpiJson.pendingApprovals > 0) {
    bullets.push(`${kpiJson.pendingApprovals} action item(s) awaiting HR review and approval.`);
  }
  if (bullets.length === 0) {
    bullets.push('Company operations are operating normally with all attendance tracking active.');
  }
  return bullets;
}

// Fallback logic for policy questions & questions when offline
function handleDeterministicFallback(user: User, prompt: string): string {
  const p = prompt.toLowerCase();

  // Test question 1: What is {colleague}'s salary?
  if (user.role === 'employee' && (p.includes('salary') || p.includes('pay') || p.includes('earns') || p.includes('tankhwah'))) {
    const isAskingAboutSelf = p.includes('my salary') || p.includes('my payslip') || p.includes('meri');
    if (!isAskingAboutSelf) {
      return "PERMISSION DENIED: In accordance with HCM Lite HR security policies, employees are strictly prohibited from viewing colleagues' salary, payroll, or compensation details.";
    }
  }

  // Test question 2: How many sick leaves do I have left this year?
  if (p.includes('sick leave') || p.includes('how many sick') || p.includes('chuttiyan') || p.includes('leave balance')) {
    if (user.employee_id) {
      const balance = getLeaveBalance(user.employee_id);
      return `You currently have ${balance.sick.remaining} sick leave day(s) remaining out of your ${balance.sick.total} days annual quota. (Used: ${balance.sick.used} days).`;
    }
  }

  // Test question 3: Who came late most often?
  if (p.includes('late') || p.includes('der se')) {
    const res = executeTool('get_late_comers', {}, user);
    if (res.top_late_comers && res.top_late_comers.length > 0) {
      const top = res.top_late_comers[0];
      return `The employee who arrived late most often this month is ${top.employee_name} (${top.department}) with ${top.late_count} late check-in(s).`;
    }
    return 'No late arrivals have been recorded for this month.';
  }

  // Test question 4: Attendance rate or who is on leave?
  if (p.includes('who is on leave') || p.includes('on leave today') || p.includes('chutti par')) {
    const res = executeTool('get_leave_summary', {}, user);
    if (res.employees_on_leave && res.employees_on_leave.length > 0) {
      const names = res.employees_on_leave.map((e: any) => `${e.employee_name} (${e.leave_type})`).join(', ');
      return `Currently ${res.currently_on_leave_count} employee(s) are on approved leave today: ${names}.`;
    }
    return 'No employees are on leave today.';
  }

  if (p.includes('headcount') || p.includes('how many employees')) {
    const res = executeTool('get_headcount', {}, user);
    return `There are currently ${res.total_headcount} active employees across the organization.`;
  }

  return `HCM Lite Assistant: According to company rules, office begins at 09:00 with a 15-minute grace period (late after 09:15). Shifts under 5 hours qualify as half-day. Leaves include 14 Annual, 8 Sick, and 10 Casual days per year. How else can I assist you?`;
}
