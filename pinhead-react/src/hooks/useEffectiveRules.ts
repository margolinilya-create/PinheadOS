import { useStore } from '../store/useStore';
import { useShallow } from 'zustand/react/shallow';
import { getEffectiveRules } from '../utils/skuRules';
import type { ResolvedRules } from '../utils/skuRules';
import type { SkuItem } from '../types/catalog';

/**
 * Returns resolved rules for the currently selected SKU in the wizard.
 * Merges category-level rules with per-SKU overrides.
 * Returns null if no SKU is selected.
 */
export function useEffectiveRules(): ResolvedRules | null {
  const { sku, categoryRules } = useStore(
    useShallow(s => ({ sku: s.sku as SkuItem | null, categoryRules: s.categoryRules }))
  );
  if (!sku) return null;
  return getEffectiveRules(sku, categoryRules || []);
}
