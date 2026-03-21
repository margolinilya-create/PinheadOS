import { createClient } from '@supabase/supabase-js';

const SUPA_URL = import.meta.env.VITE_SUPABASE_URL || 'https://pulzirakjqehsulmjhdj.supabase.co';
const SUPA_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_OhLaDHyG14xrHMfSW4xzpw_BieCf9gC';

export const supabase = createClient(SUPA_URL, SUPA_KEY);
