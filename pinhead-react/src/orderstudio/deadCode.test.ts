// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { SRC_DIR, readSource, sourceFiles } from '../testutil/sourceFiles';

/**
 * Старый путь оформления заказа убран (веха 3, задача 6): визард v3 на `/`,
 * перенос «Оформить как заказ v4», мастер позиции `/sales/:id/item/:key`,
 * автосохранение `pinhead_draft`. Сторож держит два обещания:
 * - файлов нет (никто не вернёт их копированием из истории молча);
 * - никто — ни код, ни тест — не импортирует их по имени модуля.
 *
 * Имя ищется как цель импорта (`/Name'`, `/Name.jsx'`), а не как слово:
 * упоминание в комментарии («прежний StepSummary») не импорт.
 */
const REMOVED = [
  'components/steps/StepGarment.jsx',
  'components/steps/StepDesign.jsx',
  'components/steps/StepItems.jsx',
  'components/steps/StepDetails.jsx',
  'components/steps/StepSummary.jsx',
  'components/steps/LabelConfigurator.jsx',
  'components/steps/ZoneTechBlock.jsx',
  'components/steps/ZoneMockup.jsx',
  'components/layout/ProgressBar.jsx',
  'components/shared/PriceBreakdown.jsx',
  'hooks/useDraft.js',
  'orderstudio/screens/ItemWizard.jsx',
  'orderstudio/wizard/itemSession.ts',
  'orderstudio/wizard/transferToSales.ts',
  'orderstudio/wizard/wizardOrderToSales.ts',
  // Задача 5: карточка заказа уступила рабочему месту `/sales/:id`
  'orderstudio/screens/SalesCard.jsx',
  'orderstudio/screens/ItemEditor.jsx',
  'orderstudio/screens/GridEditor.jsx',
];

const moduleName = (path: string) => path.split('/').pop()!.replace(/\.(jsx?|tsx?)$/, '');

/** Импорт, реэкспорт, `vi.mock` или `import()` модуля с этим именем */
function importsModule(text: string, name: string): boolean {
  const target = `/${name}(?:\\.(?:jsx?|tsx?))?`;
  const re = new RegExp(`(?:from\\s+|import\\s*\\(\\s*|vi\\.mock\\(\\s*|import\\s+)(['"])[^'"]*${target}\\1`);
  return re.test(text);
}

describe('мёртвый код старого пути заказа', () => {
  it.each(REMOVED)('%s удалён', (path) => {
    expect(existsSync(join(SRC_DIR, path))).toBe(false);
  });

  it('никто не импортирует удалённые модули (код и тесты)', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC_DIR, { tests: true })) {
      if (file.endsWith('deadCode.test.ts')) continue;
      const text = readSource(file);
      for (const path of REMOVED) {
        if (importsModule(text, moduleName(path))) offenders.push(`${relative(SRC_DIR, file)} → ${path}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('сторож ловит все формы импорта (проверка на образцах)', () => {
    expect(importsModule("import X from '../components/steps/StepGarment'", 'StepGarment')).toBe(true);
    expect(importsModule("const S = lazy(() => import('../components/steps/StepDesign'));", 'StepDesign')).toBe(true);
    expect(importsModule("vi.mock('../../hooks/useDraft', () => ({}))", 'useDraft')).toBe(true);
    expect(importsModule('export { x } from "./itemSession.ts"', 'itemSession')).toBe(true);
    expect(importsModule('// прежний StepSummary переносил заказ', 'StepSummary')).toBe(false);
    expect(importsModule("import X from './StepGarmentPanel'", 'StepGarment')).toBe(false);
  });
});
