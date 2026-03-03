-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- Customers Table
create table if not exists customers (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  voice_fingerprint jsonb not null, -- Storing array as JSONB
  regular_order jsonb not null,     -- Storing order object as JSONB
  created_at timestamptz default now()
);

-- Orders Table
create table if not exists orders (
  id uuid primary key default uuid_generate_v4(),
  created_at timestamptz default now(),
  status text check (status in ('NEW', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')) default 'NEW',
  customer_name text not null,
  total_price numeric not null
);

-- Order Items Table
create table if not exists order_items (
  id uuid primary key default uuid_generate_v4(),
  order_id uuid references orders(id) on delete cascade not null,
  product_name text not null,
  quantity integer default 1,
  size text,
  temperature text,
  milk text,
  sweetness text,
  ice text,
  add_ons jsonb, -- Storing array as JSONB
  special_instructions text,
  price numeric not null
);

-- Function to create an order with items transactionally
create or replace function create_order_with_items(
  p_customer_name text,
  p_total_price numeric,
  p_items jsonb
) returns uuid as $$
declare
  v_order_id uuid;
  v_item jsonb;
begin
  -- Insert Order
  insert into orders (customer_name, total_price)
  values (p_customer_name, p_total_price)
  returning id into v_order_id;

  -- Insert Items
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    insert into order_items (
      order_id, product_name, quantity, size, temperature, 
      milk, sweetness, ice, add_ons, special_instructions, price
    ) values (
      v_order_id,
      v_item->>'product_name',
      (v_item->>'quantity')::int,
      v_item->>'size',
      v_item->>'temperature',
      v_item->>'milk',
      v_item->>'sweetness',
      v_item->>'ice',
      v_item->'add_ons',
      v_item->>'special_instructions',
      (v_item->>'price')::numeric
    );
  end loop;

  return v_order_id;
end;
$$ language plpgsql;
