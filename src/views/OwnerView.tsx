import { useState, useEffect } from 'react';
import { Download, TrendingUp, ShoppingBag, DollarSign } from 'lucide-react';

export default function OwnerView() {
  const [orders, setOrders] = useState<any[]>([]);

  useEffect(() => {
    fetch('/api/orders')
      .then(res => res.json())
      .then(data => setOrders(data))
      .catch(err => console.error(err));
  }, []);

  const totalRevenue = orders.reduce((sum, order) => sum + order.total_price, 0);
  const totalOrders = orders.length;
  const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

  // Calculate top items
  const itemCounts: Record<string, number> = {};
  orders.forEach(order => {
    order.items.forEach((item: any) => {
      itemCounts[item.name] = (itemCounts[item.name] || 0) + item.quantity;
    });
  });

  const topItems = Object.entries(itemCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const handleExport = () => {
    window.open('/api/export', '_blank');
  };

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-8 flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-serif font-bold tracking-tight">Owner Dashboard</h1>
          <p className="text-stone-500 mt-1">Today's performance metrics</p>
        </div>
        <button
          onClick={handleExport}
          className="bg-stone-900 text-white px-5 py-2.5 rounded-xl text-sm font-medium hover:bg-stone-800 transition-colors flex items-center gap-2 shadow-sm"
        >
          <Download className="w-4 h-4" />
          Export CSV
        </button>
      </div>

      <div className="grid grid-cols-3 gap-6 mb-8">
        <div className="bg-white p-6 rounded-2xl border border-stone-200 shadow-sm">
          <div className="flex items-center gap-3 text-stone-500 mb-4">
            <div className="bg-emerald-50 text-emerald-600 p-2 rounded-lg">
              <DollarSign className="w-5 h-5" />
            </div>
            <span className="font-medium">Total Revenue</span>
          </div>
          <div className="text-4xl font-serif font-bold">${totalRevenue.toFixed(2)}</div>
        </div>
        
        <div className="bg-white p-6 rounded-2xl border border-stone-200 shadow-sm">
          <div className="flex items-center gap-3 text-stone-500 mb-4">
            <div className="bg-blue-50 text-blue-600 p-2 rounded-lg">
              <ShoppingBag className="w-5 h-5" />
            </div>
            <span className="font-medium">Total Orders</span>
          </div>
          <div className="text-4xl font-serif font-bold">{totalOrders}</div>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-stone-200 shadow-sm">
          <div className="flex items-center gap-3 text-stone-500 mb-4">
            <div className="bg-purple-50 text-purple-600 p-2 rounded-lg">
              <TrendingUp className="w-5 h-5" />
            </div>
            <span className="font-medium">Avg Order Value</span>
          </div>
          <div className="text-4xl font-serif font-bold">${avgOrderValue.toFixed(2)}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-2xl border border-stone-200 shadow-sm">
          <h3 className="font-serif font-bold text-lg mb-6">Top Selling Items</h3>
          <div className="space-y-4">
            {topItems.map(([name, count], idx) => (
              <div key={name} className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-stone-400 font-mono text-sm">0{idx + 1}</span>
                  <span className="font-medium">{name}</span>
                </div>
                <span className="bg-stone-100 text-stone-600 px-3 py-1 rounded-full text-sm font-medium">
                  {count} sold
                </span>
              </div>
            ))}
            {topItems.length === 0 && (
              <div className="text-stone-400 text-sm text-center py-4">No sales data yet</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
