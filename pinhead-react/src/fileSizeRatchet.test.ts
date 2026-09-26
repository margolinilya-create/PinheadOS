import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * РАТЧЕТ РАЗМЕРА ФАЙЛОВ (обзор 24.09, п. 11; сессия 68).
 *
 * Крупные файлы растут обратно, и растут молча: `CreateOrderModal.jsx` резали
 * в июле до 711 строк, к 24.09 в нём снова 1643; `ItemBlock.jsx` — 941 строка
 * без единого теста. Запись в `PROJECT.md` «God-компоненты (>500 строк): 0»
 * при этом так и стояла — число, которое никто не пересчитывал.
 *
 * Правило то же, что у ратчета предупреждений линтера (`lintRatchet.test.ts`):
 *   · новый модуль — не длиннее `DEFAULT_CAP` строк;
 *   · файл, уже превысивший его, записан в `CEILINGS` со своим размером
 *     на 24.09 и расти не может;
 *   · похудел — опустите его потолок (иначе он отрастёт обратно до старого
 *     числа незаметно); ушёл под `DEFAULT_CAP` — уберите из списка.
 *
 * ПОТОЛОК ТОЛЬКО ОПУСКАЕТСЯ. Правка, которой не хватает места, — повод
 * вынести соседний кусок в свой модуль («резка по касанию»), а не поднять
 * число. Подъём — решение вслух: число меняется с причиной в комментарии.
 *
 * Считаются строки, как их считает `wc -l`, — вместе с комментариями:
 * длинный файл трудно читать независимо от того, чем он длинен, а объяснения
 * в этом проекте живут в коде, и выносить их ради счётчика никто не станет.
 */

const DEFAULT_CAP = 500;

/** Не код, а контракт: растут вместе со схемой, резать их по размеру бессмысленно */
const EXEMPT: Record<string, string> = {
  'types/database.generated.ts': 'генерируется из схемы Supabase',
  'erp/types.ts': 'зеркало таблиц erp_* — растёт со схемой',
  'erp/store/types.ts': 'контракт стора: сигнатуры действий всех слайсов',
};

/** Размеры на 24.09 — только вниз */
const CEILINGS: Record<string, number> = {
  'erp/screens/orders/CreateOrderModal.jsx': 1643,
  'erp/store/slices/stagesSlice.ts': 988,
  'erp/screens/FabricPurchasing.jsx': 982,
  'erp/screens/orders/create/ItemBlock.jsx': 941,
  'erp/utils/orderForm.ts': 855,
  'erp/utils/experimentalBoard.ts': 821,
  'erp/screens/OrdersScreen.jsx': 806,
  'erp/screens/experimental/DevCard.jsx': 790,
  'erp/screens/Experimental.jsx': 734,
  'erp/screens/PlanScreen.jsx': 722,
  'erp/screens/warehouse/MaterialReceiptCard.jsx': 683,
  'erp/store/slices/orderWriteSlice.ts': 681,
  'erp/screens/DepartmentQueue.jsx': 653,
  'components/editors/sku/SkuDetailModal.jsx': 631,
  'erp/utils/routeDraft.ts': 624,
  'erp/utils/routes.ts': 618,
  'erp/store/slices/realtimeSlice.ts': 607,
  'store/useAuthStore.ts': 586,
  'components/editors/sku/PricingTabContent.jsx': 576,
  'erp/screens/ErpDashboard.jsx': 560,
  'erp/screens/queue/StageActionsPanel.jsx': 558,
  'erp/store/slices/chatSlice.ts': 530,
  'erp/components/StageReportForm.jsx': 525,
  'components/analytics/Dashboard.jsx': 523,
  'erp/screens/Warehouse.jsx': 510,
};

const SRC = join(process.cwd(), 'src');

/** Модули приложения: код, без тестов, тестовых утилит и объявлений типов */
function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sourceFiles(p, acc);
    else if (/\.(ts|tsx|js|jsx)$/.test(name) && !/\.test\.|\.testutil\.|\.d\.ts$/.test(name)) {
      acc.push(p);
    }
  }
  return acc;
}

/** Строки так, как их считает `wc -l` */
function lineCount(file: string): number {
  const text = readFileSync(file, 'utf8');
  const lines = text.split('\n').length;
  return text.endsWith('\n') ? lines - 1 : lines;
}

const sizes = new Map(sourceFiles(SRC).map((f) => [relative(SRC, f), lineCount(f)]));

describe('ратчет размера файлов', () => {
  it('обход видит приложение (иначе проверять нечего)', () => {
    expect(sizes.size).toBeGreaterThan(300);
  });

  it(`новый модуль не длиннее ${DEFAULT_CAP} строк`, () => {
    const over = [...sizes]
      .filter(([f, n]) => n > DEFAULT_CAP && !(f in CEILINGS) && !(f in EXEMPT))
      .map(([f, n]) => `${f}: ${n}`);
    expect(over, `вынесите часть в отдельный модуль: ${over.join(', ')}`).toEqual([]);
  });

  it('крупный файл не растёт выше своего потолка', () => {
    const grown = Object.entries(CEILINGS)
      .filter(([f, max]) => (sizes.get(f) ?? 0) > max)
      .map(([f, max]) => `${f}: ${sizes.get(f)} при потолке ${max}`);
    expect(grown, `вынесите соседний кусок в свой модуль, а не поднимайте число: ${grown.join('; ')}`)
      .toEqual([]);
  });

  it('похудевший файл опускает свой потолок — иначе отрастёт обратно', () => {
    const stale = Object.entries(CEILINGS)
      .filter(([f]) => sizes.has(f))
      .filter(([f, max]) => (sizes.get(f) ?? 0) < max)
      .map(([f]) => {
        const n = sizes.get(f) ?? 0;
        return n <= DEFAULT_CAP ? `${f}: уберите из CEILINGS (${n} строк)` : `${f}: ${n}`;
      });
    expect(stale, `обновите CEILINGS: ${stale.join('; ')}`).toEqual([]);
  });

  it('в списках нет файлов, которых больше нет', () => {
    const gone = [...Object.keys(CEILINGS), ...Object.keys(EXEMPT)].filter((f) => !sizes.has(f));
    expect(gone, 'уберите из CEILINGS/EXEMPT').toEqual([]);
  });
});
