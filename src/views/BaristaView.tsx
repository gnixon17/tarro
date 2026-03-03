import { useState, useEffect } from 'react';
import { Clock, CheckCircle2, ChevronRight } from 'lucide-react';
import { clsx } from 'clsx';

export default function BaristaView() {
  const [orders, setOrders] = useState<any[]>([]);

  const fetchOrders = async () => {
    try {
      const res = await fetch('/api/orders');
      const data = await res.json();
      setOrders(data);
    } catch (error) {
      console.error('Failed to fetch orders:', error);
    }
  };

  useEffect(() => {
    fetchOrders();
    const interval = setInterval(fetchOrders, 3000); // Poll every 3s
    return () => clearInterval(interval);
  }, []);

  const updateStatus = async (id: string, newStatus: string) => {
    try {
      await fetch(`/api/orders/${id}/status`, {
        method: 'PATCH', // Changed to PATCH to match routes.ts
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus })
      });
      fetchOrders(); // Optimistic update could be added here
    } catch (error) {
      console.error('Failed to update status:', error);
    }
  };

  const columns = [
    { id: 'NEW', title: 'New Orders', color: 'bg-red-50 text-red-900 border-red-200', nextStatus: 'IN_PROGRESS' },
    { id: 'IN_PROGRESS', title: 'In Progress', color: 'bg-amber-50 text-amber-900 border-amber-200', nextStatus: 'COMPLETED' },
    { id: 'COMPLETED', title: 'Completed', color: 'bg-emerald-50 text-emerald-900 border-emerald-200', nextStatus: null }
  ];

  return (
    <div className="h-[85vh] flex flex-col">
      <div className="mb-6 flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-serif font-bold tracking-tight">Kitchen Display</h1>
          <p className="text-stone-500 mt-1">Live order queue</p>
        </div>
      </div>

      <div className="flex-1 grid grid-cols-3 gap-6 overflow-hidden">
        {columns.map(col => (
          <div key={col.id} className="flex flex-col bg-stone-100 rounded-2xl overflow-hidden border border-stone-200">
            <div className={clsx("px-5 py-4 border-b font-semibold flex justify-between items-center", col.color)}>
              <span>{col.title}</span>
              <span className="bg-white/50 px-2 py-0.5 rounded-full text-sm">
                {orders.filter(o => o.status === col.id).length}
              </span>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {orders.filter(o => o.status === col.id).map(order => (
                <div key={order.id} className="bg-white rounded-xl p-5 shadow-sm border border-stone-200 relative group">
                  <div className="flex justify-between items-start mb-3">
                    <div>
                      <div className="font-bold text-lg">{order.customer_name}</div>
                      <div className="text-xs text-stone-400 font-mono mt-0.5">#{order.id.split('-')[0]}</div>
                    </div>
                    <div className="flex items-center text-xs text-stone-500 gap-1 bg-stone-100 px-2 py-1 rounded-md">
                      <Clock className="w-3 h-3" />
                      {new Date(order.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>

                  <div className="space-y-3 mb-4">
                    {order.items.map((item: any) => (
                      <div key={item.id} className="text-sm">
                        <div className="font-medium flex gap-2">
                          <span className="text-stone-400">{item.quantity}x</span>
                          <span>{item.size} {item.temperature} {item.product_name}</span>
                        </div>
                        <div className="pl-6 text-xs text-stone-500 mt-1 space-y-0.5">
                          {item.milk && <div>• {item.milk}</div>}
                          {item.add_ons && Array.isArray(item.add_ons) && item.add_ons.length > 0 && (
                            <div>• {item.add_ons.join(', ')}</div>
                          )}
                          {item.sweetness && <div>• {item.sweetness} Sweet</div>}
                          {item.ice && <div>• {item.ice}</div>}
                          {item.special_instructions && <div className="text-amber-600 italic">• Note: {item.special_instructions}</div>}
                        </div>
                      </div>
                    ))}
                  </div>

                  {col.nextStatus && (
                    <button
                      onClick={() => updateStatus(order.id, col.nextStatus!)}
                      className="w-full py-2.5 bg-stone-900 text-white rounded-lg text-sm font-medium hover:bg-stone-800 transition-colors flex items-center justify-center gap-2"
                    >
                      {col.nextStatus === 'IN_PROGRESS' ? 'Start Making' : 'Mark Complete'}
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  )}
                  {!col.nextStatus && (
                    <div className="w-full py-2.5 bg-emerald-50 text-emerald-700 rounded-lg text-sm font-medium flex items-center justify-center gap-2 border border-emerald-200">
                      <CheckCircle2 className="w-4 h-4" />
                      Done
                    </div>
                  )}
                </div>
              ))}
              {orders.filter(o => o.status === col.id).length === 0 && (
                <div className="text-center text-stone-400 text-sm py-10">
                  No orders in this queue
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
