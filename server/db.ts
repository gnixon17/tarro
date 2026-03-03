import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.warn("WARNING: SUPABASE_URL or SUPABASE_KEY is missing. Database operations will fail.");
}

export const supabase = createClient(supabaseUrl || '', supabaseKey || '');

export interface Order {
  id: string;
  created_at: string;
  status: 'NEW' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  customer_name: string;
  total_price: number;
  items?: OrderItem[];
}

export interface OrderItem {
  id: string;
  order_id: string;
  product_name: string;
  quantity: number;
  size: string | null;
  temperature: string | null;
  milk: string | null;
  sweetness: string | null;
  ice: string | null;
  add_ons: string;
  special_instructions: string | null;
  price: number;
}
