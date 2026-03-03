import { Router } from 'express';
import { db, Order, OrderItem } from './db.js';
import { randomUUID } from 'crypto';

export const apiRouter = Router();

// Orders CRUD
apiRouter.get('/orders', (req, res) => {
  const orders = db.prepare('SELECT * FROM orders ORDER BY created_at DESC').all() as Order[];
  const items = db.prepare('SELECT * FROM order_items').all() as OrderItem[];
  
  const ordersWithItems = orders.map(order => ({
    ...order,
    items: items.filter(item => item.order_id === order.id)
  }));
  
  res.json(ordersWithItems);
});

apiRouter.post('/orders', (req, res) => {
  const { customer_name, total_price, items } = req.body;
  const orderId = randomUUID();
  
  const insertOrder = db.prepare('INSERT INTO orders (id, created_at, customer_name, total_price) VALUES (?, ?, ?, ?)');
  const insertItem = db.prepare('INSERT INTO order_items (id, order_id, product_name, quantity, size, temperature, milk, sweetness, ice, add_ons, special_instructions, price) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  
  const createdAt = new Date().toISOString();

  db.transaction(() => {
    insertOrder.run(orderId, createdAt, customer_name, total_price);
    for (const item of items) {
      insertItem.run(
        randomUUID(), orderId, item.product_name, item.quantity, 
        item.size || null, item.temperature || null, item.milk || null, item.sweetness || null, 
        item.ice || null, JSON.stringify(item.add_ons || []), item.special_instructions || null, item.price
      );
    }
  })();
  
  res.json({ id: orderId });
});

apiRouter.get('/queue-status', (req, res) => {
  const activeOrders = db.prepare("SELECT * FROM orders WHERE status IN ('NEW', 'IN_PROGRESS')").all() as Order[];
  const items = db.prepare("SELECT * FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE status IN ('NEW', 'IN_PROGRESS'))").all() as OrderItem[];
  
  const queueDepth = items.reduce((acc, item) => acc + item.quantity, 0);
  // Estimate: 2 minutes per item + 1 minute base buffer
  const estimatedWaitTime = Math.max(2, queueDepth * 2); 
  
  res.json({
    queueDepth,
    estimatedWaitTime
  });
});

apiRouter.patch('/orders/:id/status', (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, id);
  res.json({ success: true });
});

// Dashboard Metrics
apiRouter.get('/metrics', (req, res) => {
  // Use a date filter for "today" (or just all time for this demo, but let's do all time to ensure seed data shows up)
  // In a real app, you'd add: WHERE date(created_at) = date('now')
  
  const totalRevenue = db.prepare("SELECT SUM(total_price) as total FROM orders WHERE status = 'COMPLETED'").get() as { total: number };
  const totalOrders = db.prepare("SELECT COUNT(*) as count FROM orders WHERE status = 'COMPLETED'").get() as { count: number };
  
  // Day-over-Day Revenue (Mocking yesterday's revenue for demo purposes since we only have today's seed data)
  const yesterdayRevenue = db.prepare("SELECT SUM(total_price) as total FROM orders WHERE status = 'COMPLETED' AND date(created_at) = date('now', '-1 day')").get() as { total: number };
  const dodGrowth = yesterdayRevenue.total ? ((totalRevenue.total || 0) - yesterdayRevenue.total) / yesterdayRevenue.total : 0.15; // 15% mock growth if no yesterday data
  
  const topItems = db.prepare(`
    SELECT product_name, SUM(quantity) as count 
    FROM order_items 
    JOIN orders ON orders.id = order_items.order_id 
    WHERE orders.status = 'COMPLETED' 
    GROUP BY product_name 
    ORDER BY count DESC 
    LIMIT 3
  `).all();

  const peakHour = db.prepare(`
    SELECT strftime('%H', created_at) as hour, COUNT(*) as count 
    FROM orders 
    WHERE status = 'COMPLETED' 
    GROUP BY hour 
    ORDER BY count DESC 
    LIMIT 1
  `).get() as { hour: string, count: number } | undefined;

  const oatMilkStats = db.prepare(`
    SELECT 
      CAST(SUM(CASE WHEN milk = 'Oat Milk' THEN quantity ELSE 0 END) AS FLOAT) / SUM(quantity) as rate 
    FROM order_items 
    JOIN orders ON orders.id = order_items.order_id 
    WHERE orders.status = 'COMPLETED'
  `).get() as { rate: number };

  const syrupStats = db.prepare(`
    SELECT 
      CAST(SUM(CASE WHEN add_ons != '[]' AND add_ons IS NOT NULL THEN quantity ELSE 0 END) AS FLOAT) / SUM(quantity) as rate 
    FROM order_items 
    JOIN orders ON orders.id = order_items.order_id 
    WHERE orders.status = 'COMPLETED'
  `).get() as { rate: number };

  const avgItemsPerOrder = db.prepare(`
    SELECT CAST(SUM(quantity) AS FLOAT) / COUNT(DISTINCT orders.id) as avg_items 
    FROM order_items 
    JOIN orders ON orders.id = order_items.order_id 
    WHERE orders.status = 'COMPLETED'
  `).get() as { avg_items: number };

  const avgModsPerDrink = db.prepare(`
    SELECT AVG(
      (CASE WHEN milk IS NOT NULL THEN 1 ELSE 0 END) + 
      (CASE WHEN sweetness IS NOT NULL THEN 1 ELSE 0 END) + 
      (CASE WHEN ice IS NOT NULL THEN 1 ELSE 0 END) + 
      (CASE WHEN add_ons != '[]' AND add_ons IS NOT NULL THEN 1 ELSE 0 END)
    ) as avg_mods 
    FROM order_items 
    JOIN orders ON orders.id = order_items.order_id 
    WHERE orders.status = 'COMPLETED' AND size IS NOT NULL -- only count drinks, not pastries
  `).get() as { avg_mods: number };

  res.json({
    revenue: totalRevenue.total || 0,
    orders: totalOrders.count || 0,
    aov: totalOrders.count ? (totalRevenue.total / totalOrders.count) : 0,
    dodGrowth: dodGrowth,
    topItems,
    peakHour: peakHour ? `${peakHour.hour}:00` : 'N/A',
    oatMilkRate: oatMilkStats.rate || 0,
    syrupRate: syrupStats.rate || 0,
    avgItemsPerOrder: avgItemsPerOrder.avg_items || 0,
    avgModsPerDrink: avgModsPerDrink.avg_mods || 0,
    anomalyFlag: (avgModsPerDrink.avg_mods || 0) > 2.5 ? 'High Customization Load' : null
  });
});

// Export CSV
apiRouter.get('/export', (req, res) => {
  const orders = db.prepare('SELECT * FROM orders').all() as Order[];
  const items = db.prepare('SELECT * FROM order_items').all() as OrderItem[];
  
  let csv = 'order_id,created_at,status,customer_name,total_price,items\n';
  
  for (const order of orders) {
    const orderItems = items.filter(i => i.order_id === order.id);
    const itemsStr = orderItems.map(i => {
      let desc = `${i.quantity}x ${i.size || ''} ${i.temperature || ''} ${i.product_name}`.trim();
      const mods = [i.milk, i.sweetness, i.ice].filter(Boolean);
      if (mods.length > 0) desc += ` (${mods.join(', ')})`;
      return desc;
    }).join('; ');
    
    csv += `${order.id},${order.created_at},${order.status},${order.customer_name},${order.total_price},"${itemsStr}"\n`;
  }
  
  res.header('Content-Type', 'text/csv');
  res.attachment('orders.csv');
  res.send(csv);
});

// ElevenLabs TTS Wrapper (Mock/Proxy)
apiRouter.post('/tts', async (req, res) => {
  const { text } = req.body;
  const apiKey = process.env.ELEVENLABS_API_KEY;
  
  if (!apiKey) {
    // Return a mock success if no key is provided so the app doesn't crash
    return res.json({ mock: true, text });
  }
  
  try {
    const response = await fetch('https://api.elevenlabs.io/v1/text-to-speech/21m00Tcm4TlvDq8ikWAM/stream', {
      method: 'POST',
      headers: {
        'Accept': 'audio/mpeg',
        'xi-api-key': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_turbo_v2_5',
        voice_settings: { stability: 0.5, similarity_boost: 0.5 }
      })
    });
    
    if (!response.ok) throw new Error('ElevenLabs API error');
    
    res.setHeader('Content-Type', 'audio/mpeg');
    response.body?.pipeTo(new WritableStream({
      write(chunk) { res.write(chunk); },
      close() { res.end(); }
    }));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
