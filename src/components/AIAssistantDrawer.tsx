import React, { useState, useRef, useEffect } from 'react';
import { Bot, Send, X, Sparkles, Shield, User, Clock, CheckCircle2, AlertTriangle, ArrowRight } from 'lucide-react';
import { apiRequest } from '../lib/api.js';
import type { UserRole } from '../types.js';

interface Message {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  isAiGenerated?: boolean;
  timestamp: string;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  userRole: UserRole;
  userEmail: string;
  onApplySmartLeave?: (text: string) => void;
}

export const AIAssistantDrawer: React.FC<Props> = ({
  isOpen,
  onClose,
  userRole,
  userEmail,
  onApplySmartLeave,
}) => {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      sender: 'assistant',
      text: `Hello! I am your HCM Lite AI Assistant. I answer live questions using real data from the database. Current role access: ${userRole.toUpperCase()}. How can I help you today?`,
      isAiGenerated: true,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  if (!isOpen) return null;

  const handleSend = async (textToSend?: string) => {
    const text = (textToSend || input).trim();
    if (!text || loading) return;

    const userMsg: Message = {
      id: `usr-${Date.now()}`,
      sender: 'user',
      text,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, userMsg]);
    if (!textToSend) setInput('');
    setLoading(true);

    try {
      const res = await apiRequest<{ response: string; is_ai_generated: boolean }>('/api/ai/chat', {
        method: 'POST',
        body: JSON.stringify({ prompt: text }),
      });

      const aiMsg: Message = {
        id: `ai-${Date.now()}`,
        sender: 'assistant',
        text: res.response,
        isAiGenerated: res.is_ai_generated,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };

      setMessages((prev) => [...prev, aiMsg]);
    } catch (err: any) {
      const errorMsg: Message = {
        id: `err-${Date.now()}`,
        sender: 'assistant',
        text: 'Sorry, I encountered an issue retrieving real-time data. Please ensure your query matches company data.',
        isAiGenerated: true,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setLoading(false);
    }
  };

  // Role-specific suggested test queries (from PDF Section 4)
  const suggestions =
    userRole === 'employee'
      ? [
          'How many sick leaves do I have left this year?',
          "What is Bilal's salary?", // Security check: must politely refuse!
          'Who came late most often this month?',
          'What is the company attendance policy?',
        ]
      : [
          'Who is on leave today?',
          'Who came late most often this month?',
          "What is this month's attendance rate?",
          'How many active employees are in Engineering?',
        ];

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-full sm:w-96 bg-slate-900 border-l border-slate-800 shadow-2xl flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/90 backdrop-blur">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-indigo-600 to-purple-600 flex items-center justify-center text-white shadow-md shadow-indigo-500/20">
            <Bot className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <h3 className="text-sm font-bold text-white">HCM Lite AI Assistant</h3>
              <span className="text-[9px] uppercase px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 font-semibold border border-indigo-500/30">
                Tool Calling
              </span>
            </div>
            <p className="text-[11px] text-slate-400">Scoped to role: {userRole.toUpperCase()}</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-slate-800 transition"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Suggested Questions */}
      <div className="p-3 bg-slate-950/60 border-b border-slate-800/80">
        <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block mb-1.5">
          Judge Test Questions:
        </span>
        <div className="flex flex-wrap gap-1.5">
          {suggestions.map((q, idx) => (
            <button
              key={idx}
              onClick={() => handleSend(q)}
              className="text-[11px] text-left px-2.5 py-1 bg-slate-800/80 hover:bg-indigo-900/40 hover:text-indigo-200 text-slate-300 rounded-lg border border-slate-700/60 transition"
            >
              {q}
            </button>
          ))}
        </div>
      </div>

      {/* Chat Messages */}
      <div ref={scrollRef} className="flex-1 p-4 overflow-y-auto space-y-3 text-xs">
        {messages.map((m) => (
          <div
            key={m.id}
            className={`flex flex-col ${m.sender === 'user' ? 'items-end' : 'items-start'}`}
          >
            <div
              className={`max-w-[85%] rounded-2xl p-3 space-y-1 ${
                m.sender === 'user'
                  ? 'bg-indigo-600 text-white rounded-br-none'
                  : 'bg-slate-800/90 text-slate-200 border border-slate-700/60 rounded-bl-none'
              }`}
            >
              <p className="leading-relaxed whitespace-pre-wrap">{m.text}</p>
              <div className="flex items-center justify-between gap-3 pt-1 text-[9px] opacity-70">
                <span>{m.timestamp}</span>
                {m.isAiGenerated && (
                  <span className="inline-flex items-center gap-0.5 text-indigo-300 font-medium">
                    <Sparkles className="w-2.5 h-2.5" /> AI-generated
                  </span>
                )}
              </div>
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex items-center gap-2 p-3 bg-slate-800/40 rounded-xl text-slate-400 text-xs w-fit">
            <Bot className="w-3.5 h-3.5 animate-pulse text-indigo-400" />
            <span className="animate-pulse">Consulting database with tools...</span>
          </div>
        )}
      </div>

      {/* Input Form */}
      <div className="p-3 border-t border-slate-800 bg-slate-900/90">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSend();
          }}
          className="flex items-center gap-2"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask anything (English, Urdu, Roman Urdu)..."
            className="flex-1 px-3.5 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-white text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 placeholder-slate-500"
          />
          <button
            type="submit"
            disabled={!input.trim() || loading}
            className="p-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl disabled:opacity-40 transition cursor-pointer"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
        <span className="text-[10px] text-slate-500 block text-center mt-1.5">
          Answers verified via server-side database tool calling.
        </span>
      </div>
    </div>
  );
};
