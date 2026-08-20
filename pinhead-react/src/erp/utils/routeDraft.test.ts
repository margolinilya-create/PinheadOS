import { describe, it, expect } from 'vitest';
import {
  addParallel,
  draftFromRoute,
  draftFromStages,
  emptyStep,
  formItemRoute,
  insertGroup,
  isStepLocked,
  linearize,
  moveGroup,
  patchStep,
  removeStep,
  removedStageIds,
  routeIssues,
  stepPayload,
} from './routeDraft';
import { buildItemRoute } from './routes';
import type { BrandingMethod, BrandingOn, ProductionType, StageStatus } from '../types';

/**
 * ГЛАВНАЯ ПРОВЕРКА ЭТОГО ФАЙЛА — инвариант тождества.
 *
 * Конструктор открывается на расчётном маршруте. Если черновик, который никто
 * не трогал, при сохранении даёт ДРУГОЙ маршрут, то одно открытие карточки
 * молча переписывает производственный план заказа — и заметить это можно только
 * по тому, что заказ поехал не туда.
 */
describe('черновик не переписывает расчётный маршрут', () => {
  const TYPES: ProductionType[] = [
    'no_product', 'ready_garment', 'cut', 'sewing', 'samples', 'outsource',
  ];
  const METHOD_SETS: BrandingMethod[][] = [
    [],
    ['dtf'],
    ['dtf', 'embroidery'],
    ['silkscreen', 'embroidery', 'other'],
    ['heat_transfer', 'dtf'],
  ];
  const ON: BrandingOn[] = ['cut', 'finished'];
  const SOURCES = [null, 'pinhead', 'contractor'] as const;

  for (const productionType of TYPES) {
    for (const brandingMethods of METHOD_SETS) {
      for (const brandingOn of ON) {
        for (const materialSource of SOURCES) {
          const label = `${productionType} · [${brandingMethods.join(',') || '—'}] · ${brandingOn} · ${materialSource ?? 'нет'}`;
          it(`совпадает с buildItemRoute: ${label}`, () => {
            const route = buildItemRoute({
              productionType, brandingMethods, brandingOn, materialSource,
            });
            const linear = linearize(draftFromRoute(route));

            // Тот же набор этапов в том же порядке
            expect(linear.map((l) => l.step.departmentCode))
              .toEqual(route.map((r) => r.departmentCode));

            // Те же зависимости — по кодам цехов, а не по индексам:
            // индексы у графа и у черновика свои, сравнивать надо смысл
            const codeAt = (i: number) => linear[i].step.departmentCode;
            linear.forEach((l, i) => {
              const got = [...l.dependsOn.map(codeAt)].sort();
              const want = [...route[i].dependsOnCodes].sort();
              expect(got, `зависимости этапа ${codeAt(i)}`).toEqual(want);
            });
          });
        }
      }
    }
  }
});

describe('параллельные ветки — один шаг маршрута', () => {
  it('ветки нанесения попадают в ОДНУ группу, а не в разные шаги', () => {
    const route = buildItemRoute({
      productionType: 'sewing',
      brandingMethods: ['dtf', 'embroidery'],
      brandingOn: 'cut',
    });
    const draft = draftFromRoute(route);
    const branchGroup = draft.find((g) => g.length > 1);
    expect(branchGroup).toBeDefined();
    expect(branchGroup!.map((s) => s.departmentCode).sort()).toEqual(['dtf', 'embroidery']);
  });

  it('у параллельных этапов ОДИНАКОВЫЙ порядок — иначе они перестанут быть ветками', () => {
    const draft = [[emptyStep('cutting')], [emptyStep('dtf'), emptyStep('embroidery')], [emptyStep('sewing')]];
    const linear = linearize(draft);
    const [dtf, emb] = linear.filter((l) => ['dtf', 'embroidery'].includes(l.step.departmentCode));
    expect(dtf.sortOrder).toBe(emb.sortOrder);
  });

  it('следующий шаг ждёт ВСЕ ветки предыдущего', () => {
    const draft = [[emptyStep('cutting')], [emptyStep('dtf'), emptyStep('embroidery')], [emptyStep('sewing')]];
    const linear = linearize(draft);
    const sewing = linear.find((l) => l.step.departmentCode === 'sewing')!;
    expect(sewing.dependsOn).toHaveLength(2);
    expect(sewing.dependsOn.map((i) => linear[i].step.departmentCode).sort())
      .toEqual(['dtf', 'embroidery']);
  });
});

describe('правки маршрута', () => {
  const base = () => [[emptyStep('supply')], [emptyStep('cutting')], [emptyStep('sewing')]];

  it('перестановка перевязывает зависимости, не оставляя сирот', () => {
    const moved = moveGroup(base(), 1, 1);
    expect(moved.map((g) => g[0].departmentCode)).toEqual(['supply', 'sewing', 'cutting']);
    const linear = linearize(moved);
    // Каждый этап зависит только от того, кто стоит перед ним
    expect(linear[1].dependsOn.map((i) => linear[i].step.departmentCode)).toEqual(['supply']);
    expect(linear[2].dependsOn.map((i) => linear[i].step.departmentCode)).toEqual(['sewing']);
  });

  it('удаление среднего шага смыкает соседей', () => {
    const cut = removeStep(base(), 1, 0);
    expect(cut.map((g) => g[0].departmentCode)).toEqual(['supply', 'sewing']);
    const linear = linearize(cut);
    expect(linear[1].dependsOn.map((i) => linear[i].step.departmentCode)).toEqual(['supply']);
  });

  it('вставка подрядного этапа между нашими — сценарий из документа', () => {
    // «Наш крой → Подрядная печать → Наш пошив»
    const step = { ...emptyStep('dtf'), executor: 'contractor' as const, contractor: 'ИП Иванов' };
    const withPrint = insertGroup(base(), 1, step);
    expect(withPrint.map((g) => g[0].departmentCode)).toEqual(['supply', 'cutting', 'dtf', 'sewing']);
    const linear = linearize(withPrint);
    const sewing = linear.find((l) => l.step.departmentCode === 'sewing')!;
    expect(linear[sewing.dependsOn[0]].step.departmentCode).toBe('dtf');
  });

  it('параллельная ветка добавляется в существующий шаг', () => {
    const withBranch = addParallel(base(), 1, emptyStep('embroidery'));
    expect(withBranch[1].map((s) => s.departmentCode)).toEqual(['cutting', 'embroidery']);
  });

  it('пустая группа исчезает целиком, а не остаётся дырой', () => {
    const gone = removeStep([[emptyStep('cutting')], [emptyStep('sewing')]], 0, 0);
    expect(gone).toHaveLength(1);
  });
});

/**
 * Этап, в котором уже работали, из маршрута не выбрасывается: его работа
 * учтена в прогрессе, в журнале и в плане. Для него есть «Пропустить» —
 * с обязательной причиной и своей веткой в страже.
 */
describe('этап с фактом защищён', () => {
  const stage = (patch: Record<string, unknown> = {}) => ({
    id: 's1', department_id: 'd1', sort_order: 10, status: 'waiting' as StageStatus,
    qty_done: 0, qty_rework: 0, started_at: null as string | null, ...patch,
  });

  it('чистый этап двигается и удаляется', () => {
    expect(isStepLocked(stage())).toBe(false);
    expect(isStepLocked(stage({ status: 'ready' }))).toBe(false);
  });

  it('сделанное количество, переделка, начало работы и любой другой статус — замок', () => {
    expect(isStepLocked(stage({ qty_done: 5 }))).toBe(true);
    expect(isStepLocked(stage({ qty_rework: 2 }))).toBe(true);
    expect(isStepLocked(stage({ started_at: '2026-08-16T10:00:00Z' }))).toBe(true);
    expect(isStepLocked(stage({ status: 'in_progress' }))).toBe(true);
    expect(isStepLocked(stage({ status: 'done' }))).toBe(true);
    expect(isStepLocked(stage({ status: 'blocked' }))).toBe(true);
  });

  it('заблокированный шаг не переставить и не удалить', () => {
    const locked = [[{ ...emptyStep('cutting'), locked: true }], [emptyStep('sewing')]];
    expect(moveGroup(locked, 0, 1)).toBe(locked);
    expect(moveGroup(locked, 1, -1)).toBe(locked);
    expect(removeStep(locked, 0, 0)).toBe(locked);
  });
});

describe('черновик из существующих этапов', () => {
  const codes = new Map([['d1', 'cutting'], ['d2', 'dtf'], ['d3', 'sewing']]);
  const stages = [
    { id: 'a', department_id: 'd1', sort_order: 10, status: 'done' as StageStatus, qty_done: 10, qty_rework: 0, started_at: 'x' },
    { id: 'b', department_id: 'd2', sort_order: 20, status: 'waiting' as StageStatus, qty_done: 0, qty_rework: 0, started_at: null, executor: 'contractor', contractor: 'ИП Иванов', operation: 'Сублимация' },
    { id: 'c', department_id: 'd3', sort_order: 30, status: 'waiting' as StageStatus, qty_done: 0, qty_rework: 0, started_at: null },
  ];

  it('поднимает исполнителя, подрядчика и операцию', () => {
    const draft = draftFromStages(stages, codes);
    expect(draft[1][0].executor).toBe('contractor');
    expect(draft[1][0].contractor).toBe('ИП Иванов');
    expect(draft[1][0].operation).toBe('Сублимация');
  });

  it('этап без колонки исполнителя читается как НАШ', () => {
    expect(draftFromStages(stages, codes)[0][0].executor).toBe('internal');
  });

  it('завершённый этап приходит с замком', () => {
    expect(draftFromStages(stages, codes)[0][0].locked).toBe(true);
  });

  it('пропущенные этапы в конструктор не попадают — они уже выведены из маршрута', () => {
    const withSkip = [...stages, {
      id: 'd', department_id: 'd3', sort_order: 40, status: 'skipped' as StageStatus,
      qty_done: 0, qty_rework: 0, started_at: null,
    }];
    expect(draftFromStages(withSkip, codes).flat()).toHaveLength(3);
  });

  it('…и при сохранении НЕ удаляются: иначе стёрлась бы история пропуска', () => {
    const withSkip = [...stages, {
      id: 'd', department_id: 'd3', sort_order: 40, status: 'skipped' as StageStatus,
      qty_done: 0, qty_rework: 0, started_at: null,
    }];
    const draft = draftFromStages(withSkip, codes);
    expect(removedStageIds(withSkip, draft)).toEqual([]);
  });

  it('этап, убранный из черновика, попадает в удаление', () => {
    const draft = draftFromStages(stages, codes);
    const without = removeStep(draft, 2, 0);
    expect(removedStageIds(stages, without)).toEqual(['c']);
  });

  it('подрядные поля поднимаются из карточки подрядчика', () => {
    // Иначе конструктор предложил бы завести заново то, что уже заполнено:
    // человек открыл маршрут поправить порядок — и стёр сроки передачи
    const subs = new Map([['b', {
      qty: 150,
      send_plan_date: '2026-08-25',
      planned_date: '2026-08-28',
      responsible: 'Иванов',
      materials_note: 'сшитые худи',
      comment: 'Stone Wash',
    }]]);
    const step = draftFromStages(stages, codes, subs)[1][0];
    expect(step.qty).toBe('150');
    expect(step.sendPlan).toBe('2026-08-25');
    expect(step.returnPlan).toBe('2026-08-28');
    expect(step.responsible).toBe('Иванов');
    expect(step.handover).toBe('сшитые худи');
    expect(step.comment).toBe('Stone Wash');
  });

  it('без карточки подрядчика поля пустые, а не undefined', () => {
    // Реестр подряда ленивый: до его загрузки конструктор обязан открываться,
    // а поле формы — оставаться контролируемым
    const step = draftFromStages(stages, codes)[1][0];
    expect(step.qty).toBe('');
    expect(step.responsible).toBe('');
  });
});

describe('шаг черновика → payload сервера', () => {
  const contractorStep = {
    ...emptyStep('dtf'),
    executor: 'contractor' as const,
    contractor: '  ИП Иванов  ',
    operation: ' Варка ',
    qty: '150',
    sendPlan: '2026-08-25',
    returnPlan: '2026-08-28',
    responsible: 'Иванов',
    handover: 'сшитые худи',
    comment: 'Stone Wash',
  };

  it('подрядные поля уезжают целиком, пробелы срезаются', () => {
    expect(stepPayload(contractorStep)).toEqual({
      executor: 'contractor',
      contractor: 'ИП Иванов',
      operation: 'Варка',
      qty: 150,
      send_plan_date: '2026-08-25',
      planned_date: '2026-08-28',
      responsible: 'Иванов',
      materials_note: 'сшитые худи',
      comment: 'Stone Wash',
    });
  });

  it('у НАШЕГО этапа подрядных полей нет вовсе', () => {
    // Спутника у него не существует, и присланное значение молча пропало бы —
    // это хуже, чем не отправленное: форма показала бы сохранённым не то
    const mine = { ...contractorStep, executor: 'internal' as const };
    const payload = stepPayload(mine);
    expect(payload.contractor).toBeNull();
    expect(payload.qty).toBeNull();
    expect(payload.planned_date).toBeNull();
    expect(payload.responsible).toBeNull();
    // Операция у нашего этапа остаётся: «упаковку принимает склад»
    expect(payload.operation).toBe('Варка');
  });

  it('пустое поле — null, а не пустая строка', () => {
    const bare = { ...emptyStep('dtf'), executor: 'contractor' as const, contractor: 'ИП' };
    const payload = stepPayload(bare);
    expect(payload.qty).toBeNull();
    expect(payload.send_plan_date).toBeNull();
    expect(payload.comment).toBeNull();
  });

  it('количество 0 и мусор не уезжают числом', () => {
    expect(stepPayload({ ...contractorStep, qty: '0' }).qty).toBeNull();
    expect(stepPayload({ ...contractorStep, qty: 'abc' }).qty).toBeNull();
  });
});

describe('валидация маршрута', () => {
  it('пустой маршрут — ошибка', () => {
    expect(routeIssues([])).toContainEqual({ group: null, text: 'В маршруте нет ни одного этапа' });
  });

  it('подрядный этап без подрядчика не сохраняется', () => {
    // Иначе в разделе «Подряд» такой этап не отличить от нашего, а «где заказ
    // сейчас» — главный вопрос, ради которого раздел существует
    const draft = [[{ ...emptyStep('dtf'), executor: 'contractor' as const }]];
    expect(routeIssues(draft).some((i) => /не указан подрядчик/.test(i.text))).toBe(true);
  });

  it('подрядный этап без ОПЕРАЦИИ не сохраняется', () => {
    // Документ 20.08 строит на операции весь раздел: отдельных вкладок под
    // варку и сублимацию не заводится именно потому, что различает их это поле.
    // Без него строка подписывается именем ЦЕХА — «Цех ДТФ» там, где человек
    // ищет «Сублимацию»
    const draft = [[{
      ...emptyStep('dtf'), executor: 'contractor' as const, contractor: 'ИП Иванов',
    }]];
    expect(routeIssues(draft).some((i) => /не указана операция/.test(i.text))).toBe(true);
  });

  it('подрядный этап С подрядчиком и операцией проходит', () => {
    const draft = [[{
      ...emptyStep('dtf'),
      executor: 'contractor' as const,
      contractor: 'ИП Иванов',
      operation: 'Сублимация',
    }]];
    expect(routeIssues(draft)).toEqual([]);
  });

  it('операция обязательна только у подряда — наш этап называет цех', () => {
    expect(routeIssues([[emptyStep('dtf')]])).toEqual([]);
  });

  it('один участок дважды в шаге — почти всегда промах руки', () => {
    const draft = [[emptyStep('dtf'), emptyStep('dtf')]];
    expect(routeIssues(draft).some((i) => /дважды/.test(i.text))).toBe(true);
  });

  it('два ПОДРЯДНЫХ этапа одного цеха в шаге допустимы — это разные подрядчики', () => {
    const draft = [[
      {
        ...emptyStep('sewing'),
        executor: 'contractor' as const,
        contractor: 'ИП Иванов',
        operation: 'Пошив',
      },
      {
        ...emptyStep('sewing'),
        executor: 'contractor' as const,
        contractor: 'Цех Саша',
        operation: 'Пошив',
      },
    ]];
    expect(routeIssues(draft)).toEqual([]);
  });
});

describe('patchStep', () => {
  it('меняет только указанный этап', () => {
    const draft = [[emptyStep('dtf'), emptyStep('embroidery')]];
    const next = patchStep(draft, 0, 1, { executor: 'contractor', contractor: 'ИП' });
    expect(next[0][0].executor).toBe('internal');
    expect(next[0][1].contractor).toBe('ИП');
  });
});

/**
 * `formItemRoute` — единственное место, где решается «правка человека или расчёт»
 * И собираются аргументы расчёта. Читателей трое: превью ТЗ в форме, сам
 * конструктор и сборка payload в `createOrder`. Разойдись они — заказ создастся
 * не по тому маршруту, по которому считался гейт ТЗ, причём обе стороны будут
 * «работать».
 */
describe('formItemRoute', () => {
  it('без правки отдаёт расчётный маршрут', () => {
    const it = { production_type: 'sewing', branding_on: 'cut', has_branding: false };
    expect(formItemRoute(it)).toEqual(draftFromRoute(buildItemRoute({
      productionType: 'sewing', brandingMethods: [], brandingOn: 'cut', materialSource: null,
    })));
  });

  it('правка человека побеждает расчёт', () => {
    const route = [[{ ...emptyStep('sewing'), executor: 'contractor' as const, contractor: 'ИП' }]];
    expect(formItemRoute({ production_type: 'sewing', route })).toBe(route);
  });

  /**
   * Пустой массив — это не «маршрута нет», а состояние, из которого человек
   * не вышел. Принять его буквально значило бы создать заказ без единого этапа,
   * то есть невидимый для всех цехов сразу.
   */
  it('пустая правка читается как «не трогали»', () => {
    expect(formItemRoute({ production_type: 'sewing', route: [] }).length).toBeGreaterThan(0);
  });

  /**
   * Техники приходят в ДВУХ видах: в форме это блоки нанесений под флагом
   * `has_branding`, в payload заказа — готовый `branding_methods`. Понимать
   * надо оба, иначе по разные стороны одного сабмита получится разный маршрут:
   * в форме с печатью, в сторе без неё — и заказ уедет мимо участков нанесения.
   */
  it('техники нанесения читаются и из формы, и из payload одинаково', () => {
    const fromForm = formItemRoute({
      production_type: 'sewing', branding_on: 'cut', has_branding: true,
      prints: [{ method: 'dtf' }, { method: 'dtf' }, { method: 'embroidery' }],
    });
    const fromPayload = formItemRoute({
      production_type: 'sewing', branding_on: 'cut',
      branding_methods: ['dtf', 'embroidery'],
    });
    expect(fromForm).toEqual(fromPayload);
    expect(fromForm.flat().map((s) => s.departmentCode)).toContain('dtf');
  });

  /**
   * Контекст ЗАКАЗА доезжает до расчёта (правки 20.08).
   *
   * Правило «правка человека или расчёт» — это `formItemRoute` ЦЕЛИКОМ,
   * включая сборку аргументов `buildItemRoute`: читателей трое (превью ТЗ
   * в форме, конструктор маршрута и `createOrder`), и разойтись они могут
   * не только правилом, но и подставленным значением. Забытый `needsPurchase`
   * означал бы заказ, созданный НЕ ПО ТОМУ маршруту, по которому человеку
   * показали превью.
   */
  it('отметка «Закупка не требуется» доезжает до расчёта маршрута', () => {
    const it = { production_type: 'sewing', branding_on: 'cut', has_branding: false };
    const codes = (draft: ReturnType<typeof formItemRoute>) =>
      draft.flat().map((s) => s.departmentCode);

    expect(codes(formItemRoute(it, { needsPurchase: false }))).not.toContain('supply');
    // Без контекста — как раньше: закупка нужна
    expect(codes(formItemRoute(it))).toContain('supply');
    expect(codes(formItemRoute(it, { needsPurchase: true }))).toContain('supply');
  });

  it('снятый флаг брендирования выбрасывает нанесения из маршрута', () => {
    const codes = formItemRoute({
      production_type: 'sewing', branding_on: 'cut', has_branding: false,
      prints: [{ method: 'dtf' }],
    }).flat().map((s) => s.departmentCode);
    expect(codes).not.toContain('dtf');
  });

  /**
   * `materialSource` подставляется ТОЛЬКО при подряде — иначе он вырезал бы
   * из маршрута закупку у обычного заказа. Именно такое расхождение между двумя
   * сборками аргументов и было бы самым тихим.
   */
  it('источник материалов учитывается только у подряда', () => {
    const sewing = formItemRoute({ production_type: 'sewing', material_source: 'contractor' })
      .flat().map((s) => s.departmentCode);
    const outsource = formItemRoute({ production_type: 'outsource', material_source: 'contractor' })
      .flat().map((s) => s.departmentCode);
    expect(sewing).toContain('supply');
    expect(outsource).not.toContain('supply');
  });
});
