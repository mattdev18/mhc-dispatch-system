-- Initial Schema Migration for MHC Dispatch & Queuing System (Supabase PostgreSQL)

-- 1. TRUCKS TABLE
CREATE TABLE IF NOT EXISTS public.trucks (
    id BIGSERIAL PRIMARY KEY,
    queue TEXT NOT NULL,
    date TEXT NOT NULL,
    truck_number TEXT NOT NULL,
    driver_name TEXT NOT NULL,
    company TEXT,
    contact TEXT,
    load_type TEXT NOT NULL,
    destination TEXT NOT NULL,
    reference TEXT,
    priority TEXT DEFAULT 'Standard',
    loading_door INTEGER,
    arrival_time TEXT,
    arrival_timestamp TIMESTAMPTZ,
    called_time TEXT,
    called_timestamp TIMESTAMPTZ,
    loading_time TEXT,
    loading_timestamp TIMESTAMPTZ,
    completed_time TEXT,
    completed_timestamp TIMESTAMPTZ,
    doc_transfer_to_sap TEXT,
    doc_received_from_warehouse TEXT,
    sap_analyst TEXT,
    sap_doc_start TEXT,
    sap_doc_end TEXT,
    remarks TEXT,
    doc_transfer_to_warehouse TEXT,
    doc_runner_dispatched TEXT,
    doc_runner_received TEXT,
    warehouse_recorder TEXT,
    departed_time TEXT,
    departed_timestamp TIMESTAMPTZ,
    cancelled_time TEXT,
    cancelled_timestamp TIMESTAMPTZ,
    cancellation_reason TEXT,
    call_count INTEGER DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'Waiting',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. USERS TABLE
CREATE TABLE IF NOT EXISTS public.users (
    id BIGSERIAL PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. SETTINGS TABLE
CREATE TABLE IF NOT EXISTS public.settings (
    key TEXT PRIMARY KEY,
    value TEXT
);

-- Default Settings Seed
INSERT INTO public.settings (key, value)
VALUES ('plant_name', 'MAY HARVEST CORPORATION')
ON CONFLICT (key) DO NOTHING;

-- Enable RLS and create permissive read/write policies for authenticated / anon API
ALTER TABLE public.trucks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;

-- Allow anon key to read trucks and settings
CREATE POLICY "Allow anon read trucks" ON public.trucks FOR SELECT USING (true);
CREATE POLICY "Allow anon insert trucks" ON public.trucks FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow anon update trucks" ON public.trucks FOR UPDATE USING (true);

CREATE POLICY "Allow anon read settings" ON public.settings FOR SELECT USING (true);
CREATE POLICY "Allow anon read users" ON public.users FOR SELECT USING (true);
