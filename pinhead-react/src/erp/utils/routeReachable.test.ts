import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { buildItemRoute } from './routes';
import { ROUTE_EXTRA_DEPT_CODES } from './routeDraft';
import { isProductionDept } from '../data/departments';
import type { BrandingMethod, BrandingOn, ProductionType } from '../types';

/**
 * Сторож против дефекта 12.08: этап маршрута, до которого нельзя добраться.
 *
 * ЧТО СЛУЧИЛОСЬ. Заказ с маршрутом «Закупка → Закрой → ДТФ → Швейка → ВТО»
 * не появлялся в разделе закупки, закупка не могла начать работу, и весь
 * маршрут стоял. Причина не в закупке как таковой: участок `supply` —
 * непроизводственный (`is_production = false`), а ВСЕ общие поверхности
 * приложения фильтруют цеха именно этим признаком — сайдбар, канбан, вкладки
 * очереди, план, дашборд. Непроизводственный цех виден только на своём экране,
 * и миграция `20260727210000` прямо это и написала: «Закупка, логистика,
 * склады и экспериментальный цех живут своими экранами».
 *
 * Написала — и никто не проверил. Экран закупки был реестром строк
 * `erp_materials` и об этапах не знал вовсе, поэтому заказ, у которого этап
 * закупки есть, а материалов ещё нет, не показывался НИГДЕ. На боевой базе так
 * стояли 33 заказа.
 *
 * ЧТО СТОРОЖИМ. Каждый цех, который может оказаться в маршруте, обязан иметь
 * поверхность, где человек увидит его ОТКРЫТЫЙ ЭТАП: производственный —
 * общую очередь, непроизводственный — свой экран, и этот экран обязан строить
 * строки из этапов, а не из чего-то соседнего.
 *
 * ГРАНИЦА ЧЕСТНОСТИ. `is_production` правится в админке, и тест про это знать
 * не может — он читает сид миграций. Если участок переведут в непроизводственные
 * прямо в базе, здесь будет зелено, а в приложении он исчезнет. Поэтому сид
 * и сверяется: перевод цеха миграцией сторож увидит.
 */

const SRC = join(process.cwd(), 'src');
const MIGRATIONS = join(process.cwd(), '../supabase/migrations');

/** Все цеха, которые вообще могут оказаться в маршруте позиции */
function routeDeptCodes(): Set<string> {
  const TYPES: ProductionType[] = [
    'no_product', 'ready_garment', 'cut', 'sewing', 'samples', 'outsource',
  ];
  const METHODS: BrandingMethod[] = [
    'embroidery', 'silkscreen', 'dtf', 'heat_transfer', 'other',
  ];
  // Значений ровно два — так же, как в CHECK `erp_order_items_branding_on_check`
const ON: BrandingOn[] = ['cut', 'finished'];
  const codes = new Set<string>();
  for (const productionType of TYPES) {
    for (const brandingOn of ON) {
      // По одному методу и все сразу: ветки нанесения дают разные вставки
      for (const methods of [[], ...METHODS.map((m) => [m]), METHODS]) {
        for (const materialSource of [null, 'contractor', 'pinhead']) {
          for (const st of buildItemRoute({
            productionType, brandingMethods: methods as BrandingMethod[],
            brandingOn, materialSource,
          })) {
            codes.add(st.departmentCode);
          }
        }
      }
    }
  }
  return codes;
}

/**
 * Производственные цеха по сиду миграций — последний `is_production = true`.
 * Читаем по СМЫСЛУ (по тексту UPDATE), а не по имени файла: файл устаревает
 * тише, чем содержимое.
 */
function seededProductionCodes(): Set<string> {
  const files = readdirSync(MIGRATIONS).filter((n) => n.endsWith('.sql')).sort();
  let last: string[] | null = null;
  for (const name of files) {
    const sql = readFileSync(join(MIGRATIONS, name), 'utf8');
    for (const m of sql.matchAll(
      /set\s+is_production\s*=\s*true\s+where\s+code\s+in\s*\(([^)]*)\)/gi)) {
      last = [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
    }
  }
  return new Set(last ?? []);
}

/**
 * Непроизводственный цех маршрута → экран, который показывает его открытые
 * этапы. Список ведётся руками намеренно: добавить сюда строку — значит
 * сознательно ответить на вопрос «а где человек это увидит».
 */
const OWN_SCREEN: Record<string, string> = {
  supply: 'erp/screens/purchasing/SupplyQueue.jsx',
  // Участок «Подряд» (правки 21.08): задача видна только во вкладке «Подряд»,
  // и раздел строит строки ИЗ ЭТАПОВ (`outsourcedStages`), а не из реестра —
  // именно из-за реестра раздел когда-то и был тупиком
  outsource: 'erp/screens/Subcontracting.jsx',
};

describe('до каждого этапа маршрута можно добраться', () => {
  const ROUTE = routeDeptCodes();
  const PRODUCTION = seededProductionCodes();

  it('маршруты вообще строятся — сторож не сторожит пустоту', () => {
    expect(ROUTE.size).toBeGreaterThanOrEqual(7);
    expect(ROUTE.has('supply')).toBe(true);
    expect(PRODUCTION.size).toBeGreaterThanOrEqual(6);
  });

  it.each([...routeDeptCodes()])(
    'цех %s виден или в общей очереди, или на своём экране',
    (code) => {
      if (PRODUCTION.has(code)) return; // общие поверхности покажут его сами
      const screen = OWN_SCREEN[code];
      expect(
        screen,
        `цех ${code} непроизводственный и стоит в маршруте, но экрана у него нет — `
        + 'этап будет не виден нигде, ровно как «Закупка» до 12.08',
      ).toBeTruthy();
      expect(existsSync(join(SRC, screen)), `${screen} не найден`).toBe(true);
    },
  );

  it('экран непроизводственного цеха строит строки ИЗ ЭТАПОВ, а не из соседних данных', () => {
    /**
     * Именно здесь и был дефект: экран существовал, назывался «Закупка»
     * и показывал закупочные строки — то есть выглядел рабочим, а этапа
     * не видел вовсе. Проверка «экран есть» его бы не поймала.
     */
    for (const [code, screen] of Object.entries(OWN_SCREEN)) {
      if (PRODUCTION.has(code)) continue;
      const src = readFileSync(join(SRC, screen), 'utf8');
      expect(
        /openSupplyStages|buildQueueEntries|outsourcedStages/.test(src),
        `${screen} не читает этапы — заказ без сопутствующих данных снова пропадёт`,
      ).toBe(true);
    }
  });

  /**
   * Конструктор маршрута предлагает участки, которых расчёт не выдаёт вовсе:
   * человек может поставить в маршрут закупку или «Подряд» руками. Тот же
   * вопрос, что и выше, — «где человек увидит этот этап», — обязан быть решён
   * и для них, иначе заказ снова станет невидимым, только теперь по воле
   * менеджера, а не расчёта.
   */
  it('участок, предлагаемый конструктором помимо производственных, имеет свой экран', () => {
    expect(ROUTE_EXTRA_DEPT_CODES.length).toBeGreaterThan(0);
    for (const code of ROUTE_EXTRA_DEPT_CODES) {
      if (PRODUCTION.has(code)) continue;
      const screen = OWN_SCREEN[code];
      expect(
        screen,
        `конструктор предлагает участок ${code}, но экрана с его этапами нет`,
      ).toBeTruthy();
      expect(existsSync(join(SRC, screen)), `${screen} не найден`).toBe(true);
    }
  });

  /**
   * Участок «Подряд» обязан остаться НЕпроизводственным: документ просит,
   * чтобы задача была видна только во вкладке «Подряд». Стань он
   * производственным — попадёт в очередь цеха, на канбан, в план и в загрузку,
   * то есть рабочий увидит в своих заданиях работу, которую делает подрядчик.
   */
  it('«Подряд» не заведён производственным участком', () => {
    expect(PRODUCTION.has('outsource')).toBe(false);
    expect(isProductionDept({ code: 'outsource' })).toBe(false);
  });

  it('закупка вырезается из маршрута только у подряда с материалом подрядчика', () => {
    // Единственное место, где первый этап маршрута законно исчезает
    const withSupply = buildItemRoute({
      productionType: 'outsource', brandingMethods: [], brandingOn: 'finished',
      materialSource: 'pinhead',
    });
    const withoutSupply = buildItemRoute({
      productionType: 'outsource', brandingMethods: [], brandingOn: 'finished',
      materialSource: 'contractor',
    });
    expect(withSupply.map((s) => s.departmentCode)).toContain('supply');
    expect(withoutSupply.map((s) => s.departmentCode)).not.toContain('supply');
  });

  it('первый этап маршрута ни от чего не зависит — иначе он не запустится никогда', () => {
    for (const productionType of
      ['ready_garment', 'cut', 'sewing', 'samples', 'outsource'] as ProductionType[]) {
      for (const brandingOn of ['cut', 'finished'] as BrandingOn[]) {
        const route = buildItemRoute({
          productionType, brandingMethods: ['dtf'], brandingOn, materialSource: 'pinhead',
        });
        if (route.length === 0) continue;
        const first = route[0];
        expect(
          first.dependsOnCodes,
          `${productionType}/${brandingOn}: первый этап ${first.departmentCode} кого-то ждёт`,
        ).toEqual([]);
      }
    }
  });

  it('каждая зависимость указывает на этап ИЗ ЭТОГО ЖЕ маршрута', () => {
    // Осиротевшая зависимость означает этап, который не откроется никогда:
    // `isStageReady` ждёт предшественника, которого в позиции нет
    for (const productionType of
      ['ready_garment', 'cut', 'sewing', 'samples', 'outsource'] as ProductionType[]) {
      for (const brandingOn of ['cut', 'finished'] as BrandingOn[]) {
        for (const materialSource of ['pinhead', 'contractor']) {
          const route = buildItemRoute({
            productionType, brandingMethods: ['dtf', 'embroidery'],
            brandingOn, materialSource,
          });
          const codes = new Set(route.map((s) => s.departmentCode));
          for (const st of route) {
            for (const dep of st.dependsOnCodes) {
              expect(
                codes.has(dep),
                `${productionType}/${brandingOn}/${materialSource}: `
                + `${st.departmentCode} ждёт ${dep}, которого в маршруте нет`,
              ).toBe(true);
            }
          }
        }
      }
    }
  });
});
