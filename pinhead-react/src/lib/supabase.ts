import { createClient, SupabaseClient } from '@supabase/supabase-js';

const SUPA_URL: string = import.meta.env.VITE_SUPABASE_URL;
const SUPA_KEY: string = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!SUPA_URL || !SUPA_KEY) {
  throw new Error(
    'Missing Supabase credentials. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env'
  );
}

export const supabase: SupabaseClient = createClient(SUPA_URL, SUPA_KEY);
