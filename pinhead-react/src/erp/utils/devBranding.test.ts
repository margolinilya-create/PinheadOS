import { describe, expect, it } from 'vitest';
import { functionBody, latestDefining, withoutComments } from './migrations.testutil';
import {
  DEV_BRANDING_CHOICES,
  DEV_BRANDING_DEPT_CODE,
  DEV_BRANDING_TASK_TYPES,
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
  it('документ называет ровно четыре вида для выбора', () => {
    // «В списке должны быть Шелкография, DTF, Вышивка и DTG»
    expect([...DEV_BRANDING_CHOICES]).toEqual(['silkscreen', 'dtf', 'embroidery', 'dtg']);
  });

  /**
   * Автопереход учитывает ВСЕ нанесения, а не только предлагаемые четыре:
   * задача сублимации, заведённая руками через «Добавить задачу», иначе
   * повисла бы незамеченной, и карточка не вышла бы из «Нанесений» никогда.
   */
  it('автопереход считает больше типов, чем предлагает выбор', () => {
    for (const type of DEV_BRANDING_CHOICES) {
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
  it('у каждого предлагаемого вида есть участок', () => {
    for (const type of DEV_BRANDING_CHOICES) {
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
