// redesign/v2 — React hook for feature flags
//
// Loads flags once per session, caches in module state. Returns false
// during the initial load tick — every call site must treat that as
// "flag is off" (render nothing / show default path). Don't gate core
// UI on a flag — flags are for NEW dark-launched routes.

import { useEffect, useState } from 'react';
import { loadFeatureFlags, type FeatureFlag } from '../lib/featureFlags';

export function useFeatureFlag(flag: FeatureFlag): boolean {
  const [enabled, setEnabled] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    loadFeatureFlags().then((flags) => {
      if (!alive) return;
      setEnabled(flags[flag] ?? false);
      setLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, [flag]);

  return loaded && enabled;
}
