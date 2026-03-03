import { useState, useEffect, useRef } from 'react';
import { Download, TrendingUp, ShoppingBag, Coffee, Clock, AlertTriangle, Percent, Layers, Activity, Sparkles, Send, Bot } from 'lucide-react';
import { getBusinessInsight } from '../services/gemini';
import { motion, AnimatePresence } from 'motion/react';

export default function Owner() {
  const [metrics, setMetrics] = useState<any>(null);
  const [insight, setInsight] = useState<string>('');
  const [chatOpen, setChatOpen] = useState(false);
  const [messages, setMessages] = useState<{role: 'user' | 'agent', text: string}[]>([]);
  const [input, setInput] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/api/metrics')
      .then(async (res) => {
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: 'Unknown error' }));
          throw new Error(err.error || 'Failed to fetch metrics');
        }
        return res.json();
      })
      .then(async (data) => {
        setMetrics(data);
        // Proactive Pulse Check
        try {
          const summary = await getBusinessInsight(data);
          setInsight(summary || '');
          setMessages([{ role: 'agent', text: summary || "Hello! I'm analyzing today's data." }]);
        } catch (e) {
          console.error("Failed to get insight", e);
        }
      })
      .catch(err => {
        console.error("Dashboard Error:", err);
        setMetrics({ error: err.message });
      });
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, chatOpen]);

  const handleAsk = async () => {
    if (!input.trim() || !metrics) return;
    
    const userMsg = input;
    setMessages(prev => [...prev, { role: 'user', text: userMsg }]);
    setInput('');
    setIsThinking(true);

    try {
      const response = await getBusinessInsight(metrics, userMsg);
      setMessages(prev => [...prev, { role: 'agent', text: response || "I couldn't find an answer to that." }]);
    } catch (e) {
      setMessages(prev => [...prev, { role: 'agent', text: "Sorry, I'm having trouble connecting to the data service." }]);
    } finally {
      setIsThinking(false);
    }
  };

  if (!metrics) return <div className="p-8 text-center text-stone-500">Loading dashboard...</div>;
  
  if (metrics.error) {
    return (
      <div className="p-8 text-center">
        <div className="bg-red-50 text-red-800 p-4 rounded-lg inline-block text-left max-w-md">
          <h3 className="font-bold mb-2 flex items-center gap-2">
            <AlertTriangle className="w-5 h-5" />
            Dashboard Error
          </h3>
          <p className="mb-4">{metrics.error}</p>
          <p className="text-sm opacity-80">
            If you just set up Supabase, you might need to run the database schema migration.
            Check the "SQL Editor" in your Supabase dashboard.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto pb-12 relative">
      <div className="flex justify-between items-end mb-8">
        <div>
          <h1 className="text-3xl font-bold font-serif text-stone-900">Owner Dashboard</h1>
          <p className="text-stone-500 mt-1">End of day pulse check. Instantly understand today's performance.</p>
        </div>
        <div className="flex gap-3">
          <button 
            onClick={() => setChatOpen(!chatOpen)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all shadow-sm ${chatOpen ? 'bg-amber-100 text-amber-900 ring-2 ring-amber-500' : 'bg-white border border-stone-200 text-stone-700 hover:bg-stone-50'}`}
          >
            <Sparkles className="w-4 h-4 text-amber-500" />
            {chatOpen ? 'Hide Assistant' : 'Ask AI Assistant'}
          </button>
          <a 
            href="/api/export" 
            download="orders.csv"
            className="flex items-center gap-2 bg-stone-900 text-white px-4 py-2 rounded-lg font-medium hover:bg-stone-800 transition-colors"
          >
            <Download className="w-4 h-4" />
            Export CSV
          </a>
        </div>
      </div>

      {/* Proactive Insight Banner */}
      {insight && !chatOpen && (
        <motion.div 
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8 bg-gradient-to-r from-stone-900 to-stone-800 text-white p-6 rounded-xl shadow-lg flex items-start gap-4 relative overflow-hidden"
        >
          <div className="absolute top-0 right-0 p-4 opacity-10">
            <Sparkles className="w-32 h-32" />
          </div>
          <div className="bg-white/10 p-3 rounded-full shrink-0 backdrop-blur-sm">
            <Bot className="w-6 h-6 text-amber-300" />
          </div>
          <div className="relative z-10">
            <h3 className="font-bold text-amber-300 text-sm uppercase tracking-wider mb-1">AI Pulse Check</h3>
            <p className="text-lg font-light leading-relaxed">{insight}</p>
          </div>
        </motion.div>
      )}

      {/* Inline Agent Chat Interface */}
      <AnimatePresence>
        {chatOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0, marginBottom: 0 }}
            animate={{ opacity: 1, height: 'auto', marginBottom: 32 }}
            exit={{ opacity: 0, height: 0, marginBottom: 0 }}
            className="bg-white border border-stone-200 rounded-xl shadow-lg overflow-hidden"
          >
            <div className="bg-stone-50 border-b border-stone-200 p-4 flex items-center justify-between">
              <div className="flex items-center gap-2 font-bold text-stone-800">
                <Sparkles className="w-4 h-4 text-amber-500" />
                Data Assistant
              </div>
              <span className="text-xs text-stone-500">Powered by Gemini 3.1 Pro</span>
            </div>
            
            <div className="h-64 overflow-y-auto p-4 space-y-4 bg-stone-50/30">
              {messages.map((m, i) => (
                <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[80%] p-3 rounded-xl text-sm ${m.role === 'user' ? 'bg-stone-900 text-white rounded-br-none' : 'bg-white border border-stone-200 text-stone-800 rounded-bl-none shadow-sm'}`}>
                    {m.text}
                  </div>
                </div>
              ))}
              {isThinking && (
                <div className="flex justify-start">
                  <div className="bg-white border border-stone-200 p-3 rounded-xl rounded-bl-none shadow-sm flex gap-1 items-center">
                    <div className="w-1.5 h-1.5 bg-stone-400 rounded-full animate-bounce" />
                    <div className="w-1.5 h-1.5 bg-stone-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
                    <div className="w-1.5 h-1.5 bg-stone-400 rounded-full animate-bounce" style={{ animationDelay: '0.4s' }} />
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            <div className="p-4 bg-white border-t border-stone-200 flex gap-2">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAsk()}
                placeholder="Ask about revenue, trends, or inventory..."
                className="flex-1 border border-stone-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-amber-500 text-sm"
              />
              <button 
                onClick={handleAsk}
                disabled={!input.trim() || isThinking}
                className="bg-amber-500 text-white p-2 rounded-lg hover:bg-amber-600 disabled:opacity-50 transition-colors"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {metrics.anomalyFlag && (
        <div className="mb-8 bg-amber-50 border border-amber-200 text-amber-800 p-4 rounded-xl flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5 text-amber-600" />
          <div>
            <h3 className="font-bold">Operational Anomaly Detected: {metrics.anomalyFlag}</h3>
            <p className="text-sm mt-1 opacity-90">Drinks are unusually complex today (avg {metrics.avgModsPerDrink.toFixed(1)} mods/drink). This may cause slower service times at the bar.</p>
          </div>
        </div>
      )}

      {/* Section 1: Top-Line Financials */}
      <h2 className="text-lg font-bold mb-4 font-serif text-stone-800 border-b border-stone-200 pb-2">Top-Line Financials</h2>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <div className="bg-white p-5 rounded-xl border border-stone-200 shadow-sm">
          <div className="flex items-center gap-2 text-stone-500 mb-3">
            <TrendingUp className="w-4 h-4" />
            <span className="font-medium text-xs tracking-wide uppercase">Total Revenue</span>
          </div>
          <div className="text-3xl font-light text-stone-900 mb-1">${metrics.revenue.toFixed(2)}</div>
          <div className={`text-xs font-medium ${metrics.dodGrowth >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
            {metrics.dodGrowth >= 0 ? '+' : ''}{(metrics.dodGrowth * 100).toFixed(1)}% vs yesterday
          </div>
        </div>

        <div className="bg-white p-5 rounded-xl border border-stone-200 shadow-sm">
          <div className="flex items-center gap-2 text-stone-500 mb-3">
            <ShoppingBag className="w-4 h-4" />
            <span className="font-medium text-xs tracking-wide uppercase">Total Orders</span>
          </div>
          <div className="text-3xl font-light text-stone-900 mb-1">{metrics.orders}</div>
          <div className="text-xs text-stone-500">Foot traffic indicator</div>
        </div>

        <div className="bg-white p-5 rounded-xl border border-stone-200 shadow-sm">
          <div className="flex items-center gap-2 text-stone-500 mb-3">
            <Coffee className="w-4 h-4" />
            <span className="font-medium text-xs tracking-wide uppercase">Avg Order Value</span>
          </div>
          <div className="text-3xl font-light text-stone-900 mb-1">${metrics.aov.toFixed(2)}</div>
          <div className="text-xs text-stone-500">Upsell & group order proxy</div>
        </div>

        <div className="bg-white p-5 rounded-xl border border-stone-200 shadow-sm">
          <div className="flex items-center gap-2 text-stone-500 mb-3">
            <Clock className="w-4 h-4" />
            <span className="font-medium text-xs tracking-wide uppercase">Peak Hour</span>
          </div>
          <div className="text-3xl font-light text-stone-900 mb-1">{metrics.peakHour}</div>
          <div className="text-xs text-stone-500">Optimize staff scheduling</div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Section 2: Operational Load & Mix */}
        <div>
          <h2 className="text-lg font-bold mb-4 font-serif text-stone-800 border-b border-stone-200 pb-2">Operational Load & Mix</h2>
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-white p-5 rounded-xl border border-stone-200 shadow-sm">
              <div className="flex items-center gap-2 text-stone-500 mb-2">
                <Layers className="w-4 h-4" />
                <span className="font-medium text-xs tracking-wide uppercase">Items / Order</span>
              </div>
              <div className="text-2xl font-light text-stone-900">{metrics.avgItemsPerOrder.toFixed(1)}</div>
              <div className="text-xs text-stone-500 mt-1">Group vs single walk-ins</div>
            </div>
            
            <div className="bg-white p-5 rounded-xl border border-stone-200 shadow-sm">
              <div className="flex items-center gap-2 text-stone-500 mb-2">
                <Activity className="w-4 h-4" />
                <span className="font-medium text-xs tracking-wide uppercase">Mods / Drink</span>
              </div>
              <div className="text-2xl font-light text-stone-900">{metrics.avgModsPerDrink.toFixed(1)}</div>
              <div className="text-xs text-stone-500 mt-1">Barista complexity proxy</div>
            </div>

            <div className="bg-white p-5 rounded-xl border border-stone-200 shadow-sm">
              <div className="flex items-center gap-2 text-stone-500 mb-2">
                <Percent className="w-4 h-4" />
                <span className="font-medium text-xs tracking-wide uppercase">Oat Milk Rate</span>
              </div>
              <div className="text-2xl font-light text-stone-900">{(metrics.oatMilkRate * 100).toFixed(0)}%</div>
              <div className="text-xs text-stone-500 mt-1">Premium dairy alternative</div>
            </div>

            <div className="bg-white p-5 rounded-xl border border-stone-200 shadow-sm">
              <div className="flex items-center gap-2 text-stone-500 mb-2">
                <Percent className="w-4 h-4" />
                <span className="font-medium text-xs tracking-wide uppercase">Syrup Rate</span>
              </div>
              <div className="text-2xl font-light text-stone-900">{(metrics.syrupRate * 100).toFixed(0)}%</div>
              <div className="text-xs text-stone-500 mt-1">Key margin driver</div>
            </div>
          </div>
        </div>

        {/* Section 3: Product Mix */}
        <div>
          <h2 className="text-lg font-bold mb-4 font-serif text-stone-800 border-b border-stone-200 pb-2">Top Products</h2>
          <div className="bg-white p-5 rounded-xl border border-stone-200 shadow-sm h-[calc(100%-2.5rem)]">
            <div className="space-y-3">
              {metrics.topItems.map((item: any, i: number) => (
                <div key={i} className="flex items-center justify-between p-3 bg-stone-50 rounded-lg border border-stone-100">
                  <div className="flex items-center gap-3">
                    <div className="w-6 h-6 rounded-full bg-stone-200 flex items-center justify-center font-bold text-stone-600 text-xs">
                      {i + 1}
                    </div>
                    <span className="font-medium">{item.product_name}</span>
                  </div>
                  <div className="text-stone-500 text-sm font-medium">
                    {item.count} sold
                  </div>
                </div>
              ))}
              {metrics.topItems.length === 0 && (
                <div className="text-stone-500 text-center py-8 text-sm">No items sold yet today.</div>
              )}
            </div>
            <div className="text-xs text-stone-500 mt-4 text-center">Identifies core sales drivers for inventory.</div>
          </div>
        </div>
      </div>
    </div>
  );
}
