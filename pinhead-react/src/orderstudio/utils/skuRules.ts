// ═══════════════════════════════════════════
// SKU Rules — resolve category rules + per-SKU overrides
// ═══════════════════════════════════════════
import type { CategoryRules, CategoryRulesOverrides, SkuItem, ZoneDefinition } from '../../types/catalog';
import { ZONE_LABELS } from '../../data/constants';

/** Fully resolved rules for a given SKU (no undefined = sensible defaults) */
export interface ResolvedRules {
  categoryId: string;
  allowedTechs: string[] | null;        // null = all
  allowedZoneTechs: Record<string, string[]> | null; // null = no zone restrictions
  allowedColors: string[] | null;       // null = all
  defaultExtras: string[];
  moq: number;
  availableSizes: string[] | null;      // null = all
  labelPresets: Record<string, unknown> | null;
}

const EMPTY_RULES: Omit<ResolvedRules, 'categoryId'> = {
  allowedTechs: null,
  allowedZoneTechs: null,
  allowedColors: null,
  defaultExtras: [],
  moq: 1,
  availableSizes: null,
  labelPresets: null,
};

/**
 * Resolve effective rules for a SKU by merging:
 *   1. Category-level rules (from categoryRules[])
 *   2. Per-SKU overrides (from sku.overrides)
 *
 * Principle: undefined/missing = "no restriction" (current behavior).
 * Per-SKU overrides take precedence over category rules.
 */
export function getEffectiveRules(
  sku: Pick<SkuItem, 'category' | 'overrides'>,
  categoryRules: CategoryRules[],
): ResolvedRules {
  const catRule = categoryRules.find(r => r.categoryId === sku.category);
  const base = catRule ?? { categoryId: sku.category };
  const overrides: CategoryRulesOverrides = sku.overrides ?? {};

  return {
    categoryId: sku.category,
    allowedTechs: overrides.allowedTechs !== undefined
      ? overrides.allowedTechs
      : base.allowedTechs ?? EMPTY_RULES.allowedTechs,
    allowedZoneTechs: mergeZoneTechs(
      base.allowedZoneTechs,
      overrides.allowedZoneTechs,
    ),
    allowedColors: overrides.allowedColors !== undefined
      ? overrides.allowedColors
      : base.allowedColors ?? EMPTY_RULES.allowedColors,
    defaultExtras: overrides.defaultExtras !== undefined
      ? overrides.defaultExtras
      : base.defaultExtras ?? EMPTY_RULES.defaultExtras,
    moq: overrides.moq !== undefined
      ? overrides.moq
      : base.moq ?? EMPTY_RULES.moq,
    availableSizes: overrides.availableSizes !== undefined
      ? overrides.availableSizes
      : base.availableSizes ?? EMPTY_RULES.availableSizes,
    labelPresets: overrides.labelPresets !== undefined
      ? overrides.labelPresets
      : base.labelPresets ?? EMPTY_RULES.labelPresets,
  };
}

/** Merge zone-level tech restrictions: override replaces category per-zone */
function mergeZoneTechs(
  catZones: Record<string, string[]> | null | undefined,
  overrideZones: Record<string, string[]> | null | undefined,
): Record<string, string[]> | null {
  if (overrideZones !== undefined) return overrideZones ?? null;
  return catZones ?? null;
}

/**
 * Check if a specific tech is allowed for a zone.
 * Returns true if no restrictions exist (permissive by default).
 */
export function isTechAllowed(
  rules: ResolvedRules,
  tech: string,
  zone?: string,
): boolean {
  // Check global tech restrictions
  if (rules.allowedTechs && !rules.allowedTechs.includes(tech)) {
    return false;
  }
  // Check zone-level tech restrictions
  if (zone && rules.allowedZoneTechs?.[zone]) {
    return rules.allowedZoneTechs[zone].includes(tech);
  }
  return true;
}

/**
 * Check if a size is available.
 * Returns true if no restrictions exist (permissive by default).
 */
export function isSizeAvailable(rules: ResolvedRules, size: string): boolean {
  if (!rules.availableSizes) return true;
  return rules.availableSizes.includes(size);
}

/** Build default (empty) category rules for a given category ID */
export function buildDefaultCategoryRules(categoryId: string): CategoryRules {
  return { categoryId };
}

/**
 * Get zones available for a given SKU category from the dynamic zones catalog.
 * Filters by zone.forCategories (null = available for all categories).
 */
export function getAvailableZonesForSku(
  zonesCatalog: ZoneDefinition[],
  skuCategory: string,
): ZoneDefinition[] {
  return zonesCatalog
    .filter(z => !z.forCategories || z.forCategories.includes(skuCategory))
    .sort((a, b) => (a.sortOrder ?? 99) - (b.sortOrder ?? 99));
}

/**
 * Resolve zone display name: first from dynamic catalog, fallback to ZONE_LABELS constant.
 */
export function getZoneName(zoneId: string, zonesCatalog: ZoneDefinition[]): string {
  const found = zonesCatalog.find(z => z.id === zoneId);
  if (found) return found.name;
  return (ZONE_LABELS as Record<string, string>)[zoneId] || zoneId;
}
