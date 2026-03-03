import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';

// Initialize SQLite database (in-memory or file-based)
// We use a file-based DB to persist across reloads as requested.
export const db = new Database('coffee_shop.db');

// Enable foreign keys
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Schema Migration
db.exec(`
  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    status TEXT CHECK(status IN ('NEW', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')) DEFAULT 'NEW',
    customer_name TEXT NOT NULL,
    total_price REAL NOT NULL
  );

  CREATE TABLE IF NOT EXISTS order_items (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL,
    product_name TEXT NOT NULL,
    quantity INTEGER DEFAULT 1,
    size TEXT,
    temperature TEXT,
    milk TEXT,
    sweetness TEXT,
    ice TEXT,
    add_ons TEXT, -- JSON array
    special_instructions TEXT,
    price REAL NOT NULL,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS customers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    voice_fingerprint TEXT NOT NULL, -- JSON array of frequency data
    regular_order TEXT NOT NULL, -- JSON object of the order items
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Seed Data (only if empty)
const count = db.prepare('SELECT COUNT(*) as count FROM orders').get() as { count: number };
if (count.count === 0) {
  const insertOrder = db.prepare('INSERT INTO orders (id, created_at, status, customer_name, total_price) VALUES (?, ?, ?, ?, ?)');
  const insertItem = db.prepare('INSERT INTO order_items (id, order_id, product_name, quantity, size, temperature, milk, sweetness, ice, add_ons, special_instructions, price) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');

  const seedOrders = [
    { id: randomUUID(), status: 'COMPLETED', name: 'Alice', total: 5.25, items: [{ name: 'Latte', qty: 1, size: 'Medium', temp: 'ICED', milk: 'Oat Milk', sweet: '50%', ice: 'Regular Ice', price: 5.25 }] },
    { id: randomUUID(), status: 'COMPLETED', name: 'Bob', total: 3.50, items: [{ name: 'Butter Croissant', qty: 1, size: null, temp: null, milk: null, sweet: null, ice: null, price: 3.50 }] },
    { id: randomUUID(), status: 'IN_PROGRESS', name: 'Charlie', total: 6.00, items: [{ name: 'Frappuccino', qty: 1, size: 'Large', temp: 'ICED', milk: 'Whole Milk', sweet: '100%', ice: 'Extra Ice', add_ons: '["Caramel Syrup"]', price: 6.00 }] },
    { id: randomUUID(), status: 'NEW', name: 'Diana', total: 8.50, items: [
      { name: 'Americano', qty: 1, size: 'Small', temp: 'HOT', milk: null, sweet: null, ice: null, price: 3.50 },
      { name: 'Matcha Latte', qty: 1, size: 'Medium', temp: 'HOT', milk: 'Almond Milk', sweet: '100%', ice: null, price: 5.00 }
    ]},
    { id: randomUUID(), status: 'NEW', name: 'Evan', total: 4.00, items: [{ name: 'Cold Brew', qty: 1, size: 'Medium', temp: 'ICED', milk: null, sweet: null, ice: 'Light Ice', price: 4.00 }] }
  ];

  const insertMany = db.transaction((orders) => {
    for (const order of orders) {
      insertOrder.run(order.id, new Date().toISOString(), order.status, order.name, order.total);
      for (const item of order.items) {
        insertItem.run(randomUUID(), order.id, item.name, item.qty, item.size || null, item.temp || null, item.milk || null, item.sweet || null, item.ice || null, item.add_ons || '[]', null, item.price);
      }
    }
  });
  insertMany(seedOrders);
}

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
