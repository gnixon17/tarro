import { useState, useEffect } from 'react';
import { Users, Fingerprint, Coffee, Trash2 } from 'lucide-react';

export default function Regulars() {
  const [regulars, setRegulars] = useState<any[]>([]);

  useEffect(() => {
    fetch('/api/customers')
      .then(res => res.json())
      .then(setRegulars);
  }, []);

  const handleDelete = async (id: string, name: string) => {
    try {
      const res = await fetch(`/api/customers/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setRegulars(regulars.filter(c => c.id !== id));
      } else {
        console.error("Failed to delete profile.");
      }
    } catch (e) {
      console.error("Error deleting profile:", e);
    }
  };

  return (
    <div className="max-w-6xl mx-auto pb-12">
      <div className="flex justify-between items-end mb-8">
        <div>
          <h1 className="text-3xl font-bold font-serif text-stone-900">Regulars</h1>
          <p className="text-stone-500 mt-1">Manage enrolled customers and their voice profiles.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {regulars.map((customer) => {
          // Supabase returns JSON columns as objects/arrays, so no need to parse if they are already objects
          const order = typeof customer.regular_order === 'string' 
            ? JSON.parse(customer.regular_order) 
            : customer.regular_order;
            
          const fingerprint = typeof customer.voice_fingerprint === 'string'
            ? JSON.parse(customer.voice_fingerprint)
            : customer.voice_fingerprint;
          
          if (!Array.isArray(order) || !Array.isArray(fingerprint)) return null;

          return (
            <div key={customer.id} className="bg-white border border-stone-200 rounded-xl p-6 shadow-sm hover:shadow-md transition-shadow relative group">
              <button 
                onClick={() => handleDelete(customer.id, customer.name)}
                className="absolute top-4 right-4 p-2 text-stone-400 hover:text-red-500 hover:bg-red-50 rounded-lg opacity-0 group-hover:opacity-100 transition-all"
                title="Delete Profile"
              >
                <Trash2 className="w-4 h-4" />
              </button>
              
              <div className="flex items-center justify-between mb-4 pr-8">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-amber-100 rounded-full flex items-center justify-center text-amber-800 font-bold">
                    {customer.name.charAt(0)}
                  </div>
                  <div>
                    <h3 className="font-bold text-stone-900">{customer.name}</h3>
                    <div className="flex items-center gap-1 text-xs text-stone-500">
                      <Fingerprint className="w-3 h-3" />
                      Voice ID Active
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-stone-50 rounded-lg p-3 border border-stone-100">
                <div className="flex items-center gap-2 text-xs font-bold text-stone-500 uppercase tracking-wider mb-2">
                  <Coffee className="w-3 h-3" />
                  The Regular
                </div>
                <div className="space-y-2">
                  {order.map((item: any, i: number) => (
                    <div key={i} className="text-sm">
                      <span className="font-medium text-stone-800">{item.quantity}x {item.size} {item.product_name}</span>
                      <div className="text-stone-500 text-xs">
                        {[item.milk, item.sweetness, item.ice, ...(item.add_ons || [])].filter(Boolean).join(', ')}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-4 pt-4 border-t border-stone-100">
                <div className="text-xs text-stone-400 font-mono flex justify-between">
                  <span>FFT Vector Size</span>
                  <span>{fingerprint.length} bins</span>
                </div>
                <div className="text-xs text-stone-400 font-mono flex justify-between mt-1">
                  <span>Enrolled</span>
                  <span>{new Date(customer.created_at).toLocaleDateString()}</span>
                </div>
              </div>
            </div>
          );
        })}

        {regulars.length === 0 && (
          <div className="col-span-full text-center py-12 bg-stone-50 rounded-xl border border-dashed border-stone-300">
            <Users className="w-12 h-12 text-stone-300 mx-auto mb-3" />
            <h3 className="text-stone-500 font-medium">No regulars enrolled yet.</h3>
            <p className="text-stone-400 text-sm mt-1">Customers can enroll after placing an order at the kiosk.</p>
          </div>
        )}
      </div>
    </div>
  );
}
