import { useState, useEffect } from 'react';
import { formatDistanceToNow, differenceInMinutes } from 'date-fns';
import { motion, AnimatePresence } from 'motion/react';
import { AlertTriangle, RotateCcw, Clock, Layers, Coffee } from 'lucide-react';

interface OrderItem {
  id: string;
  product_name: string;
  quantity: number;
  size: string | null;
  temperature: string | null;
  milk: string | null;
  sweetness: string | null;
  ice: string | null;
  add_ons: string;
}

interface Order {
  id: string;
  created_at: string;
  status: 'NEW' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  customer_name: string;
  items: OrderItem[];
}

export default function Barista() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [lastCompletedId, setLastCompletedId] = useState<string | null>(null);

  const fetchOrders = async () => {
    try {
      const res = await fetch('/api/orders');
      if (res.ok) {
        const data = await res.json();
        setOrders(data);
      }
    } catch (e) {
      console.error("Failed to fetch orders", e);
    }
  };

  useEffect(() => {
    fetchOrders();
    const interval = setInterval(fetchOrders, 3000); // Poll every 3s
    return () => clearInterval(interval);
  }, []);

  const updateStatus = async (id: string, status: string) => {
    // Optimistic update
    setOrders(prev => prev.map(o => o.id === id ? { ...o, status: status as any } : o));
    
    if (status === 'COMPLETED') {
      setLastCompletedId(id);
    }

    await fetch(`/api/orders/${id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });
  };

  const undoLastCompletion = async () => {
    if (!lastCompletedId) return;
    await updateStatus(lastCompletedId, 'IN_PROGRESS');
    setLastCompletedId(null);
  };

  // 2. Batching Logic
  const getBatchedItems = () => {
    const activeOrders = orders.filter(o => o.status === 'NEW' || o.status === 'IN_PROGRESS');
    const itemMap = new Map<string, number>();

    activeOrders.forEach(order => {
      order.items.forEach(item => {
        const key = `${item.size || ''} ${item.temperature || ''} ${item.product_name}`;
        itemMap.set(key, (itemMap.get(key) || 0) + item.quantity);
      });
    });

    return Array.from(itemMap.entries())
      .sort((a, b) => b[1] - a[1]) // Sort by count desc
      .slice(0, 5); // Top 5 batched items
  };

  // 4. Low Stock Logic (Mock: Count "Oat Milk" in last hour)
  const getLowStockAlert = () => {
    const oatMilkCount = orders
      .filter(o => differenceInMinutes(new Date(), new Date(o.created_at)) < 60)
      .flatMap(o => o.items)
      .filter(i => i.milk === 'Oat Milk')
      .reduce((acc, i) => acc + i.quantity, 0);

    if (oatMilkCount >= 20) return "Check Oat Milk Stock";
    return null;
  };

  const lowStockAlert = getLowStockAlert();
  const batchedItems = getBatchedItems();

  // 3. Visual Urgency Logic
  const getUrgencyClass = (createdAt: string) => {
    const minutes = differenceInMinutes(new Date(), new Date(createdAt));
    if (minutes > 7) return "border-red-500 bg-red-50 animate-pulse";
    if (minutes > 3) return "border-amber-400 bg-amber-50";
    return "border-stone-200 bg-white";
  };

  const columns = [
    { id: 'NEW', title: 'New Orders', color: 'bg-stone-100 text-stone-800' },
    { id: 'IN_PROGRESS', title: 'In Progress', color: 'bg-blue-50 text-blue-800' },
    { id: 'COMPLETED', title: 'Completed', color: 'bg-emerald-50 text-emerald-800' }
  ];

  return (
    <div className="h-[85vh] flex gap-6">
      {/* Sidebar: Batching & Alerts */}
      <div className="w-64 flex flex-col gap-6 shrink-0">
        <div className="bg-stone-900 text-white p-4 rounded-xl shadow-lg">
          <h2 className="font-bold text-lg mb-4 flex items-center gap-2">
            <Layers className="w-5 h-5" />
            Batch Queue
          </h2>
          <div className="space-y-3">
            {batchedItems.length === 0 && <div className="text-stone-400 text-sm italic">No active orders</div>}
            {batchedItems.map(([name, count]) => (
              <div key={name} className="flex justify-between items-center bg-stone-800 p-2 rounded-lg">
                <span className="text-sm font-medium truncate mr-2">{name}</span>
                <span className="bg-amber-500 text-stone-900 font-bold px-2 py-0.5 rounded text-xs">{count}x</span>
              </div>
            ))}
          </div>
        </div>

        {lowStockAlert && (
          <div className="bg-red-100 border-l-4 border-red-500 text-red-700 p-4 rounded-r shadow-sm flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 shrink-0" />
            <div>
              <p className="font-bold text-sm">Low Stock Alert</p>
              <p className="text-xs mt-1">{lowStockAlert}</p>
            </div>
          </div>
        )}

        {lastCompletedId && (
          <button 
            onClick={undoLastCompletion}
            className="flex items-center justify-center gap-2 bg-stone-200 hover:bg-stone-300 text-stone-700 p-3 rounded-xl font-medium transition-colors"
          >
            <RotateCcw className="w-4 h-4" />
            Undo Complete
          </button>
        )}
      </div>

      {/* Main KDS Grid */}
      <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-4 overflow-hidden">
        {columns.map(col => (
          <div key={col.id} className={`flex flex-col rounded-xl border border-stone-200 overflow-hidden bg-stone-50/50`}>
            <div className={`p-3 font-bold border-b border-stone-200 ${col.color} flex justify-between items-center`}>
              <span>{col.title}</span>
              <span className="bg-white/50 px-2 py-0.5 rounded text-sm">
                {orders.filter(o => o.status === col.id).length}
              </span>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-3">
              <AnimatePresence>
                {orders.filter(o => o.status === col.id).map(order => (
                  <motion.div 
                    layoutId={order.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    key={order.id} 
                    className={`p-4 rounded-lg shadow-sm border-2 cursor-pointer hover:shadow-md transition-all ${getUrgencyClass(order.created_at)}`}
                    onClick={() => {
                      if (order.status === 'NEW') updateStatus(order.id, 'IN_PROGRESS');
                      else if (order.status === 'IN_PROGRESS') updateStatus(order.id, 'COMPLETED');
                    }}
                  >
                    <div className="flex justify-between items-start mb-3">
                      <h3 className="font-bold text-lg">{order.customer_name}</h3>
                      <div className="flex items-center gap-1 text-xs font-mono bg-white/80 px-1.5 py-0.5 rounded border border-stone-100">
                        <Clock className="w-3 h-3" />
                        {formatDistanceToNow(new Date(order.created_at))}
                      </div>
                    </div>
                    <ul className="space-y-3">
                      {order.items.map(item => {
                        const mods = [item.milk, item.sweetness, item.ice, ...(JSON.parse(item.add_ons || '[]'))].filter(Boolean);
                        return (
                          <li key={item.id} className="text-sm">
                            <div className="font-medium flex items-start gap-2">
                              <span className="bg-stone-200 px-1.5 rounded text-xs font-bold mt-0.5">{item.quantity}x</span>
                              <span>{item.size} {item.temperature} {item.product_name}</span>
                            </div>
                            {mods.length > 0 && (
                              <div className="text-stone-500 text-xs mt-1 pl-7">
                                {mods.join(', ')}
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
