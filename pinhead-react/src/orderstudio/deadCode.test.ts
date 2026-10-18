// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
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
  // Веха 5а, задача 1: действия зон визарда v3 — читателей нет (зоны правит строка нанесения)
  'store/slices/designSlice.ts',
  // Веха 8: шапка страниц и комментарии v3 — потребителей не осталось (задача 8);
  // глобальные CSS редакторов и панелей изделия уехали в модули (задачи 3, 4, 6)
  'components/shared/PageHeader.jsx',
  'store/useCommentsStore.ts',
  'styles/editors.css',
  'styles/express.css',
  'styles/garment.css',
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

/**
 * Документы — тоже носитель (веха 3, задача 8): `CLAUDE.md` обоих уровней
 * читается каждой сессией, и строка «`/` — WizardPage» или «hooks/ — useDraft»
 * отправит следующего исполнителя искать удалённый файл. Имя удалённого модуля
 * допустимо только в строке, которая говорит, что он убран.
 */
const CLAUDE_DOCS = [join(SRC_DIR, '..', '..', 'CLAUDE.md'), join(SRC_DIR, '..', 'CLAUDE.md')];

/** Строки документа, где имя живёт как настоящее, а не как история */
function liveMentions(text: string, name: string): string[] {
  const word = new RegExp(`(^|[^A-Za-z0-9_])${name}([^A-Za-z0-9_]|$)`);
  return text.split('\n').filter((line) => word.test(line) && !/убран|удал[её]н|удаля/i.test(line));
}

describe('документы не описывают удалённые модули как живые', () => {
  it.each(CLAUDE_DOCS)('%s', (path) => {
    const text = readFileSync(path, 'utf8');
    const live = REMOVED.flatMap((p) => liveMentions(text, moduleName(p)).map((l) => `${moduleName(p)}: ${l.trim()}`));
    expect(live, `CLAUDE.md называет удалённый модуль живым:\n${live.join('\n')}`).toEqual([]);
  });

  it('сторож отличает живое имя от истории (проверка на образцах)', () => {
    expect(liveMentions('| `/` | WizardPage |\n- hooks/ — useDraft.js', 'useDraft')).toHaveLength(1);
    expect(liveMentions('Убраны в вехе 3: StepGarment, useDraft', 'useDraft')).toEqual([]);
    expect(liveMentions('StepGarmentPanel живёт', 'StepGarment')).toEqual([]);
  });
});
