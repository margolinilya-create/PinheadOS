/**
 * Листы PDF макета для кнопки «Скачать PDF макета» (веха 5а, задача 7):
 * проверка перед сборкой, текст вопроса, правила категории — и листы с именем
 * файла (`export/maketPages`). Грузится по клику (`maketExport.loadMaketTools`),
 * в чанк холста не входит (потолок 100 кБ gzip, README модуля).
 */
import type { CategoryRules, SkuItem } from '../../../../types/catalog';
import { getEffectiveRules } from '../../../../utils/skuRules';
import { allowedMethods, printMethodProfile, type MethodRules } from '../../../model/printMethods';
import type { SalesItem } from '../../../model/types';
import type { GarmentFlat } from '../../types';
import type { MaketPage } from '../../export/maketPages';
import { preflight, type PreflightIssue } from '../../export/preflight';

export { MaketPdfError, maketFileName, maketPages } from '../../export/maketPages';
export { saveBlob } from '../../../../utils/saveBlob';

const SHOWN_ISSUES = 4;

/** Правила категории модели — какие техники допустимы в зоне (как у холста) */
export function rulesOf(
  item: Pick<SalesItem, 'sku_code'>,
  skuCatalog: SkuItem[] | null | undefined,
  categoryRules: CategoryRules[] | null | undefined,
): MethodRules | null {
  const sku = (skuCatalog ?? []).find((s) => s.code === item.sku_code);
  return sku ? getEffectiveRules(sku, categoryRules ?? []) : null;
}

/** Замечания, о которых стоит спросить: серьёзные и предупреждения (подсказки — нет) */
export function issuesToAsk(pages: MaketPage[], flat: GarmentFlat, rules: MethodRules | null): PreflightIssue[] {
  const placements = pages.flatMap((p) => p.entries.map((e) => e.placement));
  return preflight({
    flat,
    placements,
    profileOf: printMethodProfile,
    methodAllowed: (area, method) => allowedMethods(area, rules).includes(method),
  }).filter((i) => i.level !== 'info');
}

/** Текст вопроса: сколько замечаний и первые из них (диалог проекта — одной строкой) */
export function preflightMessage(issues: PreflightIssue[]): string {
  const serious = issues.filter((i) => i.level === 'serious').length;
  const head = serious > 0 ? `Замечаний: ${issues.length}, из них серьёзных: ${serious}.` : `Замечаний: ${issues.length}.`;
  const shown = issues.slice(0, SHOWN_ISSUES).map((i) => i.message).join(' ');
  const more = issues.length > SHOWN_ISSUES ? ` И ещё ${issues.length - SHOWN_ISSUES}.` : '';
  return `${head} ${shown}${more} PDF можно скачать и с ними.`;
}
