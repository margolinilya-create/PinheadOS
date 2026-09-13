import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildItemRoute } from './routes';
import { draftFromRoute, draftFromStages, linearize, stepPayload } from './routeDraft';
import { itemProgress } from './progress';
import { latestMatching, withoutComments } from './migrations.testutil';

/**
 * РЕЗУЛЬТАТ ЭТАПА «РАЗРАБОТКА ПРОГРАММЫ ВЫШИВКИ» — ФАЙЛ
 * (правка заказчика 12.09, вторая порция, баг 02).
 *
 * Сторожится не «есть ли колонка», а ПУТЬ величины: расчёт → черновик →
 * payload → база → обратно в черновик. Разрыв в любом звене тихий: форма
 * снова спросит «Вышито, шт», и узнает об этом вышивальщица.
 */

const item = {
  productionType: 'sewing' as const,
  brandingMethods: ['embroidery' as const],
  brandingOn: 'cut' as const,
};

function programStage(route: ReturnType<typeof buildItemRoute>) {
  return route.find((r) => r.resultKind === 'embroidery_program') ?? null;
}

describe('расчёт маршрута помечает этап разработки программы', () => {
  it('у заказа с вышивкой такой этап один', () => {
    const route = buildItemRoute(item);
    const marked = route.filter((r) => r.resultKind === 'embroidery_program');
    expect(marked).toHaveLength(1);
    // Он же standalone: программу пишут параллельно, крой её не ждёт
    expect(marked[0].standalone).toBe(true);
    expect(marked[0].cycle).toBe(0);
  });

  it('САМА вышивка признака не получает — у неё штуки и брак', () => {
    const route = buildItemRoute(item);
    const real = route.filter(
      (r) => r.departmentCode === 'embroidery' && r.resultKind === undefined);
    expect(real).toHaveLength(1);
    expect(real[0].cycle).toBe(1);
  });

  it('без вышивки признака нет ни у кого', () => {
    const route = buildItemRoute({ ...item, brandingMethods: ['silkscreen'] });
    expect(programStage(route)).toBeNull();
  });
});

describe('признак доезжает до сервера и обратно', () => {
  it('черновик из расчёта несёт его', () => {
    const draft = draftFromRoute(buildItemRoute(item));
    const steps = draft.flat();
    expect(steps.filter((s) => s.resultKind === 'embroidery_program')).toHaveLength(1);
  });

  it('payload шага отдаёт его колонкой', () => {
    const draft = draftFromRoute(buildItemRoute(item));
    const program = draft.flat().find((s) => s.resultKind === 'embroidery_program')!;
    expect(stepPayload(program).result_kind).toBe('embroidery_program');
    const plain = draft.flat().find((s) => s.resultKind === '')!;
    // Пусто — это `null`, а не пустая строка: «не задано» и «задано пустым»
    // в базе разные, и CHECK принял бы только первое
    expect(stepPayload(plain).result_kind).toBeNull();
  });

  it('linearize его не теряет', () => {
    const steps = linearize(draftFromRoute(buildItemRoute(item)));
    const program = steps.find((s) => s.step.resultKind === 'embroidery_program');
    expect(program).toBeTruthy();
    // Вне цепочки: не ждёт никого и никого не держит
    expect(program!.dependsOn).toEqual([]);
  });

  /**
   * ОБРАТНЫЙ ПУТЬ — САМОЕ ТИХОЕ МЕСТО. `standalone` из существующего этапа
   * НЕ выводится (связи уже записаны в `depends_on`), и признак результата
   * напрашивалось обнулить рядом с ним. Потеряй мы его — открытие
   * конструктора маршрута и сохранение без единой правки вернуло бы
   * разработке программы поля «Вышито» и «Брак».
   */
  it('черновик из существующих этапов читает его из колонки', () => {
    const draft = draftFromStages(
      [
        {
          id: 's1', department_id: 'd-emb', sort_order: 10, status: 'waiting',
          qty_done: 0, qty_rework: 0, started_at: null, depends_on: [],
          cycle: 0, operation: 'Разработка программы вышивки',
          result_kind: 'embroidery_program',
        },
      ] as never,
      new Map([['d-emb', 'embroidery']]),
    );
    expect(draft.flat()[0].resultKind).toBe('embroidery_program');
  });
});

describe('в прогресс позиции этап не входит', () => {
  it('«0 из 100» не тянет позицию вниз всю дорогу', () => {
    const stages = [
      { status: 'done', qty_done: 100 },
      { status: 'waiting', qty_done: 0, result_kind: 'embroidery_program' },
    ] as never;
    // Считается ОДИН этап из двух: у разработки программы штук нет вовсе
    expect(itemProgress({ qty: 100, stages })).toEqual({ done: 100, total: 100, pct: 100 });
  });
});

describe('вид вложения заведён в обоих местах', () => {
  /**
   * Виды `print`/`label`/`note` 22.08 завели ТОЛЬКО в типе: unit-набор был
   * зелёным, а первая попытка приложить файл отвечала 23514 и роняла
   * создание заказа целиком — вложения вставляет та же транзакция.
   */
  it('вид есть в действующем CHECK', () => {
    // Равенство «союз типа ↔ CHECK» целиком сторожит `attachmentKinds.test.ts`;
    // здесь довольно того, что новый вид до CHECK доехал
    const sql = withoutComments(
      latestMatching(/add constraint erp_order_attachments_kind_check/, 'CHECK видов вложения'),
    );
    expect(sql).toContain("'stage_result'");
  });

  it('файл привязан к ЭТАПУ, а не к позиции', () => {
    const src = readFileSync(
      resolve(__dirname, '../screens/queue/StageResultFile.jsx'), 'utf8');
    expect(src).toContain('stageId: stage.id');
    expect(src).toContain("kind: 'stage_result'");
  });
});
