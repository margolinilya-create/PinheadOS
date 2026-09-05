import { describe, expect, it } from 'vitest';
import { functionBody, latestDefining, withoutComments } from './migrations.testutil';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  DEV_BRANDING_DEPT_CODE,
  DEV_BRANDING_TASK_TYPES,
  devBrandingFromPrints,
  devBrandingOpen,
} from './experimentalBoard';

/**
 * Шаг «Нанесения» на канбане ЭКС (правка заказчика 24.08, п. 4.3).
 *
 * Здесь сторожится ГРАНИЦА МЕЖДУ ДВУМЯ ПОЛОВИНАМИ. Выбор видов делает клиент,
 * а решение «все ли нанесения закрыты» принимает сервер: закрывает работу ЦЕХ,
 * а не технолог, и клиентский переход сработал бы только у того, у кого в этот
 * момент открыта доска.
 *
 * Разойдись перечни типов — отказ будет молчаливым и в обе стороны: карточка
 * либо застрянет в «Нанесениях» навсегда (сервер не считает тип нанесением),
 * либо уедет в «Пошив» с незакрытой работой.
 */

const TYPES = latestDefining('erp_dev_branding_task_types');
const ADVANCE = latestDefining('erp_dev_branding_advance');

describe('перечень видов нанесения', () => {
  /**
   * ВИДЫ БЕРУТСЯ ИЗ ЗАКАЗА (правка заказчика 30.08, п. 2). Прежний список
   * выбора (`DEV_BRANDING_CHOICES`) и диалог «Какие нанесения нужны образцу?»
   * сняты: менеджер уже указал нанесения в позиции, и второй ввод того же
   * решения терял исходные данные заказа.
   */
  it('порядок задач — порядок нанесений в заказе', () => {
    expect(devBrandingFromPrints([
      { method: 'dtf', seq: 2 },
      { method: 'embroidery', seq: 1 },
    ])).toEqual(['embroidery', 'dtf']);
  });

  it('термоперенос идёт в тот же цех, что и DTF, «прочее» — никуда', () => {
    // Карта та же, по которой строится производственный маршрут: своя копия
    // означала бы, что образец и серия однажды поедут разными цехами
    expect(devBrandingFromPrints([{ method: 'heat_transfer', seq: 1 }])).toEqual(['dtf']);
    expect(devBrandingFromPrints([{ method: 'other', seq: 1 }])).toEqual([]);
  });

  it('одинаковые методы не дублируют задачу цеху', () => {
    expect(devBrandingFromPrints([
      { method: 'dtf', seq: 1 }, { method: 'dtf', seq: 2 },
    ])).toEqual(['dtf']);
  });

  it('нанесений нет — пустой список (карточка уйдёт в «Пошив»)', () => {
    expect(devBrandingFromPrints([])).toEqual([]);
    expect(devBrandingFromPrints(null)).toEqual([]);
  });

  /**
   * Автопереход учитывает ВСЕ нанесения, а не только те, что приезжают
   * из заказа: задача сублимации, заведённая руками через «Добавить задачу»,
   * иначе повисла бы незамеченной, и карточка не вышла бы из «Нанесений»
   * никогда.
   */
  it('автопереход считает больше типов, чем приходит из заказа', () => {
    for (const type of devBrandingFromPrints([
      { method: 'silkscreen', seq: 1 }, { method: 'dtf', seq: 2 },
      { method: 'embroidery', seq: 3 }, { method: 'dtg', seq: 4 },
    ])) {
      expect(DEV_BRANDING_TASK_TYPES).toContain(type);
    }
    expect(DEV_BRANDING_TASK_TYPES).toContain('sublimation');
  });

  it('сервер знает ровно те же типы', () => {
    const body = functionBody(TYPES, 'erp_dev_branding_task_types');
    for (const type of DEV_BRANDING_TASK_TYPES) {
      expect(body, `сервер не считает «${type}» нанесением`).toContain(`'${type}'`);
    }
    // И ни одного лишнего: счёт кавычек в массиве совпадает с длиной перечня
    const quoted = [...body.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(new Set(quoted)).toEqual(new Set(DEV_BRANDING_TASK_TYPES));
  });

  /**
   * Соответствие «вид → участок» объявлено ЯВНО, хотя коды совпадают один
   * в один: молчаливое совпадение имён — не правило, и первое переименование
   * участка отправило бы задачу в никуда без единой ошибки.
   */
  it('у каждого вида, приходящего из заказа, есть участок', () => {
    for (const type of devBrandingFromPrints([
      { method: 'silkscreen', seq: 1 }, { method: 'dtf', seq: 2 },
      { method: 'embroidery', seq: 3 }, { method: 'dtg', seq: 4 },
      { method: 'heat_transfer', seq: 5 },
    ])) {
      expect(DEV_BRANDING_DEPT_CODE[type], type).toBeTruthy();
    }
    // Сублимации участка нет — её отправляют обычной формой, выбирая цех руками
    expect(DEV_BRANDING_DEPT_CODE.sublimation).toBeUndefined();
  });
});

describe('серверный переход «Нанесения» → «Пошив»', () => {
  const body = withoutComments(functionBody(ADVANCE, 'erp_dev_branding_advance'));

  it('срабатывает только на закрытии задачи', () => {
    expect(body).toMatch(/new\.status not in \('done', 'cancelled'\)/);
    // Повторный UPDATE тем же статусом переходом не считается
    expect(body).toMatch(/old\.status is not distinct from new\.status/);
  });

  /**
   * ПЕРЕХОД ТОЛЬКО ИЗ «НАНЕСЕНИЙ», и это не педантизм: запоздалая задача,
   * закрытая цехом после того, как технолог увёл карточку в «Финальный этап»,
   * утащила бы её назад — то есть отменила решение человека.
   */
  it('трогает только карточку, стоящую в «Нанесениях»', () => {
    expect(body).toMatch(/board_stage = 'branding'/);
    expect(body).toMatch(/board_stage = 'sewing'/);
  });

  it('ждёт закрытия ВСЕХ нанесений, а не последнего закрытого', () => {
    // «Этап считается завершённым только после закрытия всех выбранных работ»
    expect(body).toMatch(/not exists/);
    expect(body).toMatch(/t\.status not in \('done', 'cancelled'\)/);
  });

  it('закрытую разработку не двигает', () => {
    expect(body).toMatch(/e\.outcome is null/);
  });

  /**
   * SECURITY DEFINER обязателен: нанесения закрывает ЦЕХ, а RLS
   * `erp_experimental` требует `experimental.manage`, которого у рабочего нет.
   * С `invoker` переход падал бы 42501 ВНУТРИ чужой транзакции и ронял бы
   * цеху закрытие этапа.
   */
  it('исполняется от владельца — иначе уронит цеху закрытие этапа', () => {
    expect(ADVANCE).toMatch(/security definer/i);
  });

  it('закрыт для прямого вызова через REST', () => {
    // Правило проекта: у триггерной функции, заведённой позже общего обхода,
    // обязан быть свой отзыв, и отзывать нужно `from public, anon`
    expect(ADVANCE).toMatch(
      /revoke execute on function public\.erp_dev_branding_advance\(\) from public, anon/);
  });
});

/**
 * «ОБЩИЙ ЦЕХ ЕЩЁ НЕ ЗАКРЫЛ НАНЕСЕНИЯ» — ОДНА ФОРМУЛА НА ВСЕХ ЧИТАТЕЛЕЙ.
 *
 * Читателей три: доска (`Experimental.brandingOpenByDev`), страница разработки
 * и — через `devContext` — её карточка. До 05.09 формула была выражением
 * на месте у первых двух, и вторая копия успела разойтись: страница проверяла
 * только `!== 'done'` и считала ОТМЕНЁННУЮ задачу нанесения незакрытой.
 * Один и тот же образец на доске выпускался в «Пошив», а на своей странице —
 * нет; ни один тест этого не видел, потому что каждая половина «работала».
 */
describe('нанесения ещё открыты', () => {
  const task = (over: Record<string, unknown> = {}) => ({
    task_type: 'dtf', status: 'in_progress', ...over,
  });

  it('отменённая задача нанесения закрытой СЧИТАЕТСЯ', () => {
    // Ровно то, на чём разошлись копии: сервер пишет
    // `status not in ('done','cancelled')`, а страница знала только 'done'
    expect(devBrandingOpen([task({ status: 'cancelled' })])).toBe(false);
    expect(devBrandingOpen([task({ status: 'done' })])).toBe(false);
    expect(devBrandingOpen([task({ status: 'in_progress' })])).toBe(true);
  });

  it('чужие типы задач нанесением не считаются', () => {
    expect(devBrandingOpen([task({ task_type: 'patterns', status: 'todo' })])).toBe(false);
  });

  it('задач нет — держать нечего', () => {
    expect(devBrandingOpen([])).toBe(false);
    expect(devBrandingOpen(null)).toBe(false);
  });

  /**
   * СТОРОЖ НА ЧЕТВЁРТУЮ КОПИЮ. Свойство «формула одна» тестом поведения
   * не выражается: копия отвечает так же ровно до того дня, когда разойдётся.
   * Поэтому обход исходников — ни один экран не смеет строить это условие
   * из `DEV_BRANDING_TASK_TYPES` сам.
   */
  it('никто не собирает условие заново из перечня типов', () => {
    const ROOT = resolve(__dirname, '..');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) { walk(full); continue; }
        if (!/\.(jsx?|tsx?)$/.test(name) || /\.test\./.test(name)) continue;
        // Объявление и сама реализация — законные упоминания
        if (full.endsWith(join('utils', 'experimentalBoard.ts'))) continue;
        const src = withoutComments(readFileSync(full, 'utf8'));
        if (!src.includes('DEV_BRANDING_TASK_TYPES')) continue;
        // Признак самодельного условия: перечень рядом со сравнением статуса
        if (/DEV_BRANDING_TASK_TYPES[\s\S]{0,200}status/.test(src)) {
          offenders.push(full.slice(ROOT.length + 1));
        }
      }
    };
    walk(ROOT);
    expect(offenders).toEqual([]);
  });
});
