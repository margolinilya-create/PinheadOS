/**
 * Логика кнопки «Скачать PDF макета» (веха 5а, задача 7) без React: проверка
 * перед сборкой, текст вопроса и загрузчик движка PDF. Отдельным модулем —
 * файл компонента экспортирует только компонент (быстрое обновление Vite).
 */
import { handlePossibleUpdate } from '../../../../lib/appUpdate';
import { toast } from '../../../../store/useToastStore';
import type { CategoryRules, SkuItem } from '../../../../types/catalog';
import { getEffectiveRules } from '../../../../utils/skuRules';
import { allowedMethods, printMethodProfile, type MethodRules } from '../../../model/printMethods';
import type { SalesItem } from '../../../model/types';
import type { GarmentFlat } from '../../types';
import type { MaketPage } from '../../export/maketPages';
import { preflight, type PreflightIssue } from '../../export/preflight';

export const MSG_ENGINE = 'Сборка PDF не загрузилась — обновите страницу и повторите';
const SHOWN_ISSUES = 4;

/** Загрузчик движка PDF — единственный `import()` модуля; в тестах подменяется (сбой чанка) */
export const pdfEngine = { load: () => import('../../export/exportPdf') };

/** Движок PDF по требованию; не загрузился — `null` (диалог «Вышло обновление» или тост уже показаны) */
export async function loadPdfEngine(): Promise<typeof import('../../export/exportPdf') | null> {
  try {
    return await pdfEngine.load();
  } catch (e) {
    console.error('ExportPdfButton: движок PDF', e);
    if (!handlePossibleUpdate(e)) toast.error(MSG_ENGINE);
    return null;
  }
}

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
