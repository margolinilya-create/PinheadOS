// redesign/v2 — feature flag loader
//
// Flags live in app_config.feature_flags (JSONB) on Supabase so we can
// flip them per-environment: main branch hits prod Supabase where all
// v2 flags are false, redesign/v2 hits v2 Supabase where they're true.
// No code change required to cut over — just flip the row.
//
// See CLAUDE.md "Feature flags" rule. Protected slices (catalogSlice)
// stay untouched; this loader is its own tiny store.

import { supabase } from './supabase';

export type FeatureFlag =
  | 'tech_card_builder'
  | 'workshop_board'
  | 'foreman_screen'
  | 'payroll_screen'
  | 'notifications_bell'
  | 'trash_screen'
  | 'orders_table_view'
  | 'workers_screen'
  | 'notifications_screen'
  | 'kpi_screen';

type FlagMap = Partial<Record<FeatureFlag, boolean>>;

// All flags default to false. New routes are dark until explicitly enabled.
const DEFAULT_FLAGS: FlagMap = {};

let cached: FlagMap | null = null;

export async function loadFeatureFlags(): Promise<FlagMap> {
  if (cached) return cached;

  // try/catch guards against supabase client contract breaks (test mocks
  // missing maybeSingle, network layers throwing instead of returning error).
  // Defensive: flags failing to load should degrade to all-off, not crash.
  try {
    const { data, error } = await supabase
      .from('app_config')
      .select('value')
      .eq('key', 'feature_flags')
      .maybeSingle();

    if (error || !data?.value) {
      cached = DEFAULT_FLAGS;
      return cached;
    }
    cached = data.value as FlagMap;
    return cached;
  } catch {
    cached = DEFAULT_FLAGS;
    return cached;
  }
}

export function getFeatureFlagSync(flag: FeatureFlag): boolean {
  return cached?.[flag] ?? false;
}

// Test/dev helper — force a flag value without hitting Supabase.
export function __setFeatureFlagsForTest(flags: FlagMap): void {
  cached = flags;
}

export function __resetFeatureFlagsCache(): void {
  cached = null;
}
