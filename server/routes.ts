import { Router } from 'express';
import { supabase, Order, OrderItem, isSupabaseConfigured } from './db.ts';

export const apiRouter = Router();

// Configuration Status Check
apiRouter.get('/config-status', (req, res) => {
  res.json({
    supabase: isSupabaseConfigured,
    elevenLabs: !!process.env.ELEVENLABS_API_KEY
  });
});

// Customer Management
apiRouter.post('/customers', async (req, res) => {
  console.log('[POST /customers] Saving new customer...');
  const { name, voice_fingerprint, regular_order } = req.body;
  
  try {
    const { data, error } = await supabase
      .from('customers')
      .insert({
        name,
        voice_fingerprint, // Supabase handles JSON automatically
        regular_order      // Supabase handles JSON automatically
      })
      .select('id')
      .single();

    if (error) throw error;
    
    console.log(`[POST /customers] Saved customer: ${name} (${data.id})`);
    res.json({ id: data.id });
  } catch (err) {
    console.error('[POST /customers] Error:', err);
    res.status(500).json({ error: 'Failed to save customer' });
  }
});

apiRouter.get('/customers', async (req, res) => {
  const { data, error } = await supabase
    .from('customers')
    .select('*')
    .order('created_at', { ascending: false });
    
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

apiRouter.delete('/customers', async (req, res) => {
  // Delete all customers
  const { error } = await supabase
    .from('customers')
    .delete()
    .neq('id', '00000000-0000-0000-0000-000000000000'); // Hack to delete all rows
    
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

apiRouter.delete('/customers/:id', async (req, res) => {
  const { id } = req.params;
  
  // Basic UUID validation
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(id)) {
    return res.status(400).json({ error: "Invalid UUID format" });
  }

  console.log(`[DELETE /customers/${id}] Attempting to delete customer...`);
  
  const { error } = await supabase
    .from('customers')
    .delete()
    .eq('id', id);
    
  if (error) {
    console.error(`[DELETE /customers/${id}] Error:`, error);
    return res.status(500).json({ error: error.message });
  }
  
  console.log(`[DELETE /customers/${id}] Successfully deleted customer.`);
  res.json({ success: true });
});

apiRouter.post('/identify-voice', async (req, res) => {
  const { fingerprint, threshold, returnAllScores } = req.body; // Array of numbers (FFT data)
  
  if (!fingerprint || !Array.isArray(fingerprint)) {
    return res.status(400).json({ error: "Invalid fingerprint data" });
  }

  // Fetch all customers to compare in memory
  const { data: customers, error } = await supabase.from('customers').select('*');
  
  if (error) return res.status(500).json({ error: error.message });

  let bestMatch = null;
  let bestMatchScore = -1;
  const allScores: any[] = [];

  console.log(`[POST /identify-voice] Comparing against ${customers?.length || 0} customers...`);

  if (customers) {
    for (const customer of customers) {
      // Supabase returns JSON columns as objects/arrays automatically
      let storedPrint = customer.voice_fingerprint;
      
      // Handle potential string format (though Supabase should return object)
      if (typeof storedPrint === 'string') {
        try {
          storedPrint = JSON.parse(storedPrint);
        } catch (e) {
          console.error(`[POST /identify-voice] Failed to parse fingerprint for ${customer.name}`);
          continue;
        }
      }
      
      if (!Array.isArray(storedPrint)) {
        console.warn(`[POST /identify-voice] Invalid fingerprint format for ${customer.name}`);
        continue;
      }

      const len = Math.min(fingerprint.length, storedPrint.length);
      
      // Cosine Similarity
      let dotProduct = 0;
      let normA = 0;
      let normB = 0;
      
      for (let i = 0; i < len; i++) {
        dotProduct += fingerprint[i] * storedPrint[i];
        normA += fingerprint[i] * fingerprint[i];
        normB += storedPrint[i] * storedPrint[i];
      }
      
      const similarity = (normA === 0 || normB === 0) ? 0 : dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
      
      console.log(` - Similarity to ${customer.name}: ${similarity.toFixed(4)}`);
      
      allScores.push({ name: customer.name, score: similarity });

      // We want the HIGHEST similarity
      if (similarity > bestMatchScore) {
        bestMatchScore = similarity;
        bestMatch = customer;
      }
    }
  }

  // Threshold for Cosine Similarity (0 to 1). 
  const SIMILARITY_THRESHOLD = threshold !== undefined ? threshold : 0.96;

  if (returnAllScores) {
    return res.json({
      match: bestMatchScore >= SIMILARITY_THRESHOLD,
      bestScore: bestMatchScore,
      bestMatchName: bestMatch?.name,
      allScores: allScores.sort((a, b) => b.score - a.score)
    });
  }

  if (bestMatch && bestMatchScore >= SIMILARITY_THRESHOLD) {
    console.log(`[POST /identify-voice] MATCH FOUND: ${bestMatch.name} (Score: ${bestMatchScore.toFixed(4)})`);
    res.json({ 
      match: true, 
      customer: { 
        name: bestMatch.name, 
        regular_order: bestMatch.regular_order 
      },
      confidence: bestMatchScore
    });
  } else {
    console.log(`[POST /identify-voice] No match found. Best was ${bestMatch?.name} at ${bestMatchScore.toFixed(4)}`);
    res.json({ match: false, bestScore: bestMatchScore, bestMatchName: bestMatch?.name });
  }
});

// Orders CRUD
apiRouter.get('/orders', async (req, res) => {
  try {
    // Fetch orders with their items using Supabase foreign key relation
    const { data, error } = await supabase
      .from('orders')
      .select('*, items:order_items(*)')
      .order('created_at', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  } catch (err: any) {
    console.error('[GET /orders] Error:', err);
    res.status(500).json({ error: err.message || 'Failed to fetch orders' });
  }
});

apiRouter.post('/orders', async (req, res) => {
  const { customer_name, total_price, items } = req.body;
  
  try {
    // Use the RPC function we created to handle the transaction
    const { data, error } = await supabase.rpc('create_order_with_items', {
      p_customer_name: customer_name,
      p_total_price: total_price,
      p_items: items
    });

    if (error) throw error;
    
    res.json({ id: data });
  } catch (err: any) {
    console.error('Order creation failed:', err);
    res.status(500).json({ error: err.message });
  }
});

apiRouter.get('/queue-status', async (req, res) => {
  try {
    // Get all active items to calculate wait time
    // We need to join orders to filter by status
    const { data: activeItems, error } = await supabase
      .from('order_items')
      .select('quantity, orders!inner(status)')
      .in('orders.status', ['NEW', 'IN_PROGRESS']);

    if (error) return res.status(500).json({ error: error.message });

    const queueDepth = activeItems?.reduce((acc, item) => acc + item.quantity, 0) || 0;
    const estimatedWaitTime = Math.max(2, queueDepth * 2); 
    
    res.json({
      queueDepth,
      estimatedWaitTime
    });
  } catch (err: any) {
    console.error('[GET /queue-status] Error:', err);
    res.status(500).json({ error: err.message || 'Failed to fetch queue status' });
  }
});

apiRouter.patch('/orders/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    
    // Basic UUID validation
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) {
      return res.status(400).json({ error: "Invalid UUID format" });
    }
    
    const { error } = await supabase
      .from('orders')
      .update({ status })
      .eq('id', id);

    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  } catch (err: any) {
    console.error('[PATCH /orders/:id/status] Error:', err);
    res.status(500).json({ error: err.message || 'Failed to update order status' });
  }
});

// Dashboard Metrics
apiRouter.get('/metrics', async (req, res) => {
  try {
    // Fetch all completed orders and items to aggregate in memory
    // This is safer than complex SQL without views
    const { data: orders, error } = await supabase
      .from('orders')
      .select('*, items:order_items(*)')
      .eq('status', 'COMPLETED');

    if (error) return res.status(500).json({ error: error.message });

    if (!orders || orders.length === 0) {
      return res.json({
        revenue: 0, orders: 0, aov: 0, dodGrowth: 0, topItems: [],
        peakHour: 'N/A', oatMilkRate: 0, syrupRate: 0, avgItemsPerOrder: 0,
        avgModsPerDrink: 0, anomalyFlag: null
      });
    }

    // 1. Revenue & Counts
    const totalRevenue = orders.reduce((sum, o) => sum + (o.total_price || 0), 0);
    const totalOrders = orders.length;
    const aov = totalRevenue / totalOrders;

    // 2. Top Items
    const itemCounts: Record<string, number> = {};
    let totalItems = 0;
    let totalDrinks = 0;
    let oatMilkCount = 0;
    let syrupCount = 0;
    let totalMods = 0;

    orders.forEach(order => {
      order.items.forEach((item: any) => {
        // Top Items
        itemCounts[item.product_name] = (itemCounts[item.product_name] || 0) + item.quantity;
        totalItems += item.quantity;

        // Modifiers Stats
        if (item.size) { // It's a drink
          totalDrinks += item.quantity;
          if (item.milk === 'Oat Milk') oatMilkCount += item.quantity;
          
          // Check add_ons (JSON or string)
          const hasAddOns = Array.isArray(item.add_ons) ? item.add_ons.length > 0 : false;
          if (hasAddOns) syrupCount += item.quantity;

          // Count mods
          let mods = 0;
          if (item.milk) mods++;
          if (item.sweetness) mods++;
          if (item.ice) mods++;
          if (hasAddOns) mods++;
          totalMods += (mods * item.quantity);
        }
      });
    });

    const topItems = Object.entries(itemCounts)
      .map(([product_name, count]) => ({ product_name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 3);

    // 3. Peak Hour
    const hourCounts: Record<string, number> = {};
    orders.forEach(order => {
      const hour = new Date(order.created_at).getHours();
      hourCounts[hour] = (hourCounts[hour] || 0) + 1;
    });
    
    const peakHourInt = Object.entries(hourCounts).sort((a, b) => b[1] - a[1])[0]?.[0];
    const peakHour = peakHourInt ? `${peakHourInt.padStart(2, '0')}:00` : 'N/A';

    // 4. Rates
    const oatMilkRate = totalDrinks ? oatMilkCount / totalDrinks : 0;
    const syrupRate = totalDrinks ? syrupCount / totalDrinks : 0;
    const avgItemsPerOrder = totalItems / totalOrders;
    const avgModsPerDrink = totalDrinks ? totalMods / totalDrinks : 0;

    res.json({
      revenue: totalRevenue,
      orders: totalOrders,
      aov,
      dodGrowth: 0.15, // Mocked for now
      topItems,
      peakHour,
      oatMilkRate,
      syrupRate,
      avgItemsPerOrder,
      avgModsPerDrink,
      anomalyFlag: avgModsPerDrink > 2.5 ? 'High Customization Load' : null
    });
  } catch (err: any) {
    console.error('[GET /metrics] Error:', err);
    res.status(500).json({ error: err.message || 'Failed to fetch metrics' });
  }
});

// Export CSV
apiRouter.get('/export', async (req, res) => {
  try {
    const { data: orders, error } = await supabase
      .from('orders')
      .select('*, items:order_items(*)')
      .order('created_at', { ascending: false });

    if (error) return res.status(500).send('Error fetching data');

    let csv = 'order_id,created_at,status,customer_name,total_price,items\n';
    
    if (orders) {
      for (const order of orders) {
        const itemsStr = order.items.map((i: any) => {
          let desc = `${i.quantity}x ${i.size || ''} ${i.temperature || ''} ${i.product_name}`.trim();
          const mods = [i.milk, i.sweetness, i.ice].filter(Boolean);
          if (mods.length > 0) desc += ` (${mods.join(', ')})`;
          return desc;
        }).join('; ');
        
        csv += `${order.id},${order.created_at},${order.status},${order.customer_name},${order.total_price},"${itemsStr}"\n`;
      }
    }
    
    res.header('Content-Type', 'text/csv');
    res.attachment('orders.csv');
    res.send(csv);
  } catch (err: any) {
    console.error('[GET /export] Error:', err);
    res.status(500).send('Failed to export data');
  }
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
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    res.end(buffer);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
