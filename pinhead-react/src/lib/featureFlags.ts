// redesign/v2 — feature flag loader
//
// Flags live in app_config.feature_flags (JSONB) on Supabase so we can
// flip them per-environment: main branch hits prod Supabase where all
// v2 flags are false, redesign/v2 hits v2 Supabase where they're true.
// No code change required to cut over — just flip the row.
//
// See CLAUDE.md "Feature flags" rule. Protected slices (catalogSlice)
// stay untouched; this loader is its own tiny store.

import { loadAllCatalogs } from './catalogs';

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

  // Читаем из уже загруженных каталогов (loadAllCatalogs fetches all app_config
  // rows including feature_flags) — без лишнего round-trip к Supabase.
  try {
    const catalogs = await loadAllCatalogs();
    const flags = catalogs.feature_flags;
    cached = (flags && typeof flags === 'object') ? flags as FlagMap : DEFAULT_FLAGS;
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
