import { useState, useEffect } from 'react';
import { Download, TrendingUp, ShoppingBag, Coffee, Clock, AlertTriangle, Percent, Layers, Activity } from 'lucide-react';

export default function Owner() {
  const [metrics, setMetrics] = useState<any>(null);

  useEffect(() => {
    fetch('/api/metrics')
      .then(res => res.json())
      .then(data => setMetrics(data));
  }, []);

  if (!metrics) return <div className="p-8 text-center text-stone-500">Loading dashboard...</div>;

  return (
    <div className="max-w-6xl mx-auto pb-12">
      <div className="flex justify-between items-end mb-8">
        <div>
          <h1 className="text-3xl font-bold font-serif text-stone-900">Owner Dashboard</h1>
          <p className="text-stone-500 mt-1">End of day pulse check. Instantly understand today's performance.</p>
        </div>
        <a 
          href="/api/export" 
          download="orders.csv"
          className="flex items-center gap-2 bg-stone-900 text-white px-4 py-2 rounded-lg font-medium hover:bg-stone-800 transition-colors"
        >
          <Download className="w-4 h-4" />
          Export CSV
        </a>
      </div>

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
