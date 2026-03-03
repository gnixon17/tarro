import Database from 'better-sqlite3';

const db = new Database('orders.db');

db.exec(`
  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    status TEXT,
    customer_name TEXT,
    total_price REAL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS order_items (
    id TEXT PRIMARY KEY,
    order_id TEXT,
    item_id TEXT,
    name TEXT,
    quantity INTEGER,
    size TEXT,
    temperature TEXT,
    milk_type TEXT,
    sweetness_level TEXT,
    ice_level TEXT,
    syrups TEXT,
    espresso_shots INTEGER,
    price REAL,
    FOREIGN KEY(order_id) REFERENCES orders(id)
  );
`);

export default db;
