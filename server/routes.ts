import { Router } from 'express';
import { db, Order, OrderItem } from './db.js';
import { randomUUID } from 'crypto';

export const apiRouter = Router();

// Customer Management
apiRouter.post('/customers', (req, res) => {
  const { name, voice_fingerprint, regular_order } = req.body;
  const id = randomUUID();
  
  db.prepare('INSERT INTO customers (id, name, voice_fingerprint, regular_order) VALUES (?, ?, ?, ?)').run(
    id, name, JSON.stringify(voice_fingerprint), JSON.stringify(regular_order)
  );
  
  res.json({ id });
});

apiRouter.get('/customers', (req, res) => {
  const customers = db.prepare('SELECT * FROM customers ORDER BY created_at DESC').all();
  res.json(customers);
});

apiRouter.post('/identify-voice', (req, res) => {
  const { fingerprint } = req.body; // Array of numbers (FFT data)
  
  if (!fingerprint || !Array.isArray(fingerprint)) {
    return res.status(400).json({ error: "Invalid fingerprint data" });
  }

  const customers = db.prepare('SELECT * FROM customers').all() as any[];
  let bestMatch = null;
  let minDistance = Infinity;

  // Simple Euclidean distance comparison
  for (const customer of customers) {
    const storedPrint = JSON.parse(customer.voice_fingerprint);
    
    // Ensure dimensions match (truncate to shorter length)
    const len = Math.min(fingerprint.length, storedPrint.length);
    let sumSqDiff = 0;
    
    for (let i = 0; i < len; i++) {
      sumSqDiff += Math.pow(fingerprint[i] - storedPrint[i], 2);
    }
    
    const distance = Math.sqrt(sumSqDiff);
    
    // Threshold for "match" (heuristic value, needs tuning)
    // For normalized FFT data (0-255), a distance of < 500 might be a match depending on vector length
    if (distance < minDistance) {
      minDistance = distance;
      bestMatch = customer;
    }
  }

  // Threshold: If the closest match is still very far, it's not a match.
  // Let's say max distance is 2000 for a vector of length 128 (approx 15 diff per bin on avg)
  if (bestMatch && minDistance < 2000) {
    res.json({ 
      match: true, 
      customer: { 
        name: bestMatch.name, 
        regular_order: JSON.parse(bestMatch.regular_order) 
      },
      confidence: 1 - (minDistance / 2000)
    });
  } else {
    res.json({ match: false });
  }
});

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
