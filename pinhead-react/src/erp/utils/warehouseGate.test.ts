import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  functionBody, latestDefining, withoutComments, withoutJsComments,
} from './migrations.testutil';

/**
 * Гейт упаковки читает ФАЗУ подряда, а не строку статуса.
 *
 * До волны 3.5 условие звучало `sc.status <> 'received_at_pinhead'`. Статус
 * подряда переехал в `phase`, и это сравнение продолжило бы «работать» —
 * всегда истинным, потому что такого значения у живых строк больше нет.
 * Упаковка начала бы создаваться ДО приёмки подряда, и заметили бы это на
 * отгрузке непринятого: ошибка не падает, она просто однажды отгружает не то.
 *
 * Тест сторожит именно этот класс: сравнение со строковым значением, которое
 * молча перестало существовать.
 */

const DERIVE = withoutComments(
  functionBody(latestDefining('erp_warehouse_task_derive'), 'erp_warehouse_task_derive'),
);
const FG_ACCEPTED = withoutComments(
  functionBody(latestDefining('erp_warehouse_fg_accepted'), 'erp_warehouse_fg_accepted'),
);
const CAN_PACK = withoutComments(
  latestDefining('erp_can_pack_ship'),
);
/**
 * Задачи готовой продукции переехали из `erp_warehouse_task_derive` в общую
 * функцию (правки 02.09, п. 2): у них появился ВТОРОЙ повод завестись —
 * закрытие разработки образца, — а derive висит на смене статуса ЭТАПА
 * и такого события не видит. Проверки, стоявшие на `DERIVE`, переехали сюда
 * вместе с кодом; у самого derive осталось утверждение «делегирует,
 * а не повторяет».
 */
const FINISH = withoutComments(
  functionBody(
    latestDefining('erp_ensure_order_finish_tasks'), 'erp_ensure_order_finish_tasks',
  ),
);
const GATE_RELEASE = withoutComments(
  latestDefining('erp_dev_warehouse_gate_release'),
);

describe('гейт складской упаковки', () => {
  it('смотрит на фазу подряда (через общее условие)', () => {
    expect(CAN_PACK).toMatch(/sc\.phase not in \('accepted', 'closed'\)/);
  });

  it('не сравнивается с уехавшим статусом подряда', () => {
    // Значение переехало в phase='accepted'; сравнение с ним было бы мёртвым
    expect(DERIVE).not.toMatch(/sc\.status/);
    expect(DERIVE).not.toMatch(/received_at_pinhead/);
  });

  it('упаковка по-прежнему ждёт закрытия ВСЕХ этапов заказа', () => {
    expect(FINISH).toMatch(/s\.status not in \('done','skipped'\)/);
  });

  it('derive ДЕЛЕГИРУЕТ задачи готовой продукции, а не повторяет их', () => {
    // Копия условия у второго писателя разошлась бы молча: у каждого свой
    // повод сработать, и заметить расхождение можно только на заказе,
    // попавшем ровно в разницу
    expect(DERIVE).toMatch(/erp_ensure_order_finish_tasks\(/);
    expect(DERIVE).not.toMatch(/'fg_receipt'/);
    expect(DERIVE).not.toMatch(/'pack_ship'/);
  });

  it('приёмка материалов и маркировка остались на своих триггерах', () => {
    expect(DERIVE).toMatch(/v_code = 'supply' and new\.status in \('in_progress', 'done'\)/);
    expect(DERIVE).toMatch(/v_code = 'sewing' and new\.status = 'in_progress'/);
  });

  /**
   * Б5 обхода 04.09. Приёмка материалов заводилась ТОЛЬКО при закрытии
   * закупки, а материалы приходят по частям: весь период поставок кладовщику
   * некуда было записать приход — единственный путь лежал через чужой экран
   * «Материал поступил» в очереди цеха. На живой базе так стояло пять
   * активных заказов.
   *
   * `done` из условия НЕ убран: закупка закрывается и минуя `in_progress`
   * (досрочно с причиной, автозакрытием по материалам «со склада»), и такой
   * заказ остался бы без задачи вовсе. Дубль сторожит `not exists`.
   */
  it('приёмка материалов заводится с началом закупки, а не только с её концом', () => {
    const cond = /v_code = 'supply' and new\.status in \('in_progress', 'done'\)/;
    expect(DERIVE).toMatch(cond);
    const branch = DERIVE.slice(DERIVE.search(cond));
    expect(branch).toMatch(/insert into erp_warehouse_tasks[\s\S]{0,200}'material_receipt'/);
    expect(branch).toMatch(/where not exists \(/);
  });

  /**
   * Третье предусловие упаковки: склад ПРИНЯЛ готовую продукцию. Без него
   * упаковывают то, чего никто не пересчитал, и недостача всплывает у клиента.
   */
  it('требует принятой приёмки готовой продукции', () => {
    expect(CAN_PACK).toMatch(/t\.task_type = 'fg_receipt'[\s\S]{0,80}t\.status = 'accepted'/);
  });
});

/**
 * Закрытие приёмки ГП — СОБЫТИЕ, без которого упаковка не появилась бы никогда.
 *
 * Триггер `erp_warehouse_task_derive` срабатывает на смене статуса ЭТАПА.
 * Но к моменту, когда склад принимает продукцию, все этапы уже закрыты —
 * нового события от них не будет. Поэтому приёмка открывает упаковку сама,
 * своим триггером на складских задачах. Убери его — и заказы будут копиться
 * в «принято на склад» без единой задачи упаковки, и ничего не упадёт.
 */
describe('приёмка ГП открывает упаковку', () => {
  it('срабатывает только на переходе приёмки в accepted', () => {
    expect(FG_ACCEPTED).toMatch(/new\.status <> 'accepted'/);
    // Повторное сохранение уже принятой задачи не должно ничего делать заново
    expect(FG_ACCEPTED).toMatch(/old\.status = 'accepted'/);
    // Обе приёмки: готовой продукции и подряда
    expect(FG_ACCEPTED).toMatch(/'fg_receipt', 'subcontract_receipt'/);
  });

  it('спрашивает те же предусловия, что и основной триггер', () => {
    // Не «повторяет» — именно спрашивает: повтор и был причиной расхождения
    expect(FG_ACCEPTED).toMatch(/erp_can_pack_ship\(/);
    expect(FINISH).toMatch(/erp_can_pack_ship\(/);
  });

  it('создаёт упаковку идемпотентно — и БЕЗ on conflict', () => {
    /**
     * Идемпотентность держится на проверке существования, а не на
     * `ON CONFLICT`: уникальность задач стала частичной (приёмка подряда
     * уникальна по этапу, остальные — по заказу), а частичный индекс из голого
     * `ON CONFLICT (order_id, task_type)` Postgres не выведет — это 42P10
     * при каждом срабатывании триггера.
     */
    expect(FG_ACCEPTED).not.toMatch(/on conflict/);
    expect(FG_ACCEPTED).toMatch(/where not exists/);
    expect(FG_ACCEPTED).toMatch(/task_type = 'pack_ship'/);
  });
});

/**
 * Предусловия упаковки живут в ОДНОЙ функции.
 *
 * Копий было три — в двух триггерах и в клиенте, — и они разошлись ровно так,
 * как расходятся копии: у заказа С производственными этапами И подрядом
 * «готовое изделие» упаковка не создавалась ВООБЩЕ. Цепочка обрывалась трижды:
 * derive пропускал (подряд не принят), fg_accepted пропускал (подряд всё ещё
 * не принят), а на самом подряде триггера не было. Заказ оставался без задачи
 * упаковки навсегда, и ничего при этом не падало.
 */
describe('предусловия упаковки — одно выражение на всех', () => {
  it('оба триггера спрашивают общую функцию, а не свою копию', () => {
    expect(FINISH).toMatch(/erp_can_pack_ship\(/);
    expect(FG_ACCEPTED).toMatch(/erp_can_pack_ship\(/);
  });

  it('общая функция проверяет все три условия', () => {
    expect(CAN_PACK).toMatch(/s\.status not in \('done','skipped'\)/);
    expect(CAN_PACK).toMatch(/sc\.phase not in \('accepted', 'closed'\)/);
    expect(CAN_PACK).toMatch(/t\.task_type = 'fg_receipt'[\s\S]{0,80}t\.status = 'accepted'/);
  });

  /**
   * У подряда «под ключ» этапов нет вовсе, приёмке готовой продукции взяться
   * неоткуда, и требование «склад принял ГП» заперло бы такой заказ навсегда.
   */
  it('заказ без производственных этапов не требует приёмки ГП', () => {
    expect(CAN_PACK).toMatch(/or not exists \([\s\S]{0,200}erp_item_stages/);
  });

  it('приёмка подряда закрывает саму подрядную операцию', () => {
    // Раньше это делал клиент и получал 42501 у кладовщика: складскую задачу
    // он двигать вправе, а erp_subcontracting стоит под order.manage
    expect(FG_ACCEPTED).toMatch(/update erp_subcontracting/);
    expect(FG_ACCEPTED).toMatch(/subcontract_receipt/);
  });
});

/**
 * ПРИЁМКА ПОДРЯДА СКЛАДОМ — сквозной путь, а не одна дверь.
 *
 * Дефект, найденный проверкой прав ОТ ЛИЦА РОЛИ (21.08): RLS журнала
 * `erp_subcontract_moves` расширили до `warehouse.manage`, и на этом успокоились
 * — а дальше по цепочке стоит триггер `erp_subcontract_moves_rollup`, который
 * приращает `qty_done` подрядного этапа, и `erp_stage_guard` отклонял ВСЮ
 * транзакцию: у роли `storekeeper` нет НИ ОДНОГО права `stage.*`, поэтому
 * страж падал на самой первой проверке. Центральный сценарий документа
 * («склад принял → следующий этап открылся») не работал вовсе.
 *
 * Сторож проверяет МЕХАНИЗМ пропуска, а не наличие слов: метку ставит и
 * снимает сам rollup, страж принимает её только для подрядного этапа и только
 * у того, кто вправе писать журнал.
 */
describe('приёмка подряда складом проходит страж этапов', () => {
  const ROLLUP = latestDefining('erp_subcontract_moves_rollup');
  const GUARD = latestDefining('erp_stage_guard');

  it('rollup помечает свой update и снимает метку за собой', () => {
    expect(ROLLUP).toMatch(/set_config\('erp\.subcontract_rollup', 'on', true\)/);
    expect(ROLLUP).toMatch(/set_config\('erp\.subcontract_rollup', 'off', true\)/);
    // Метка стоит ВОКРУГ обновления этапа, а не в начале функции: окно
    // пропуска обязано быть не шире самого действия
    const on = ROLLUP.indexOf("set_config('erp.subcontract_rollup', 'on'");
    const upd = ROLLUP.indexOf('update public.erp_item_stages');
    const off = ROLLUP.indexOf("set_config('erp.subcontract_rollup', 'off'");
    expect(on).toBeLessThan(upd);
    expect(upd).toBeLessThan(off);
  });

  it('страж пропускает ТОЛЬКО подрядный этап и ТОЛЬКО с правом на журнал', () => {
    expect(GUARD).toMatch(
      /current_setting\('erp\.subcontract_rollup', true\)[\s\S]{0,400}erp_has_permission\('warehouse\.manage'\)/,
    );
    // Три условия сразу: метка, подрядный исполнитель, право писать журнал.
    // Пропуск, выданный «на всякий случай», однажды выдаётся не тому
    const branch = GUARD.slice(
      GUARD.indexOf("current_setting('erp.subcontract_rollup'"),
      GUARD.indexOf("v_take     := public.erp_has_permission('stage.take')"),
    );
    expect(branch).toMatch(/new\.executor, 'internal'\) = 'contractor'/);
    expect(branch).toMatch(/erp_has_permission\('order\.manage'\)/);
  });

  it('пропуск стоит ПОСЛЕ отсечки неохраняемых колонок, но ДО проверки прав', () => {
    // Выше — ранний выход `not v_guarded`, ниже — вычисление прав `stage.*`.
    // Поставить ветку ниже значило бы не починить ничего: страж падает
    // на `not v_any` раньше, чем доходит до счётчиков
    const guarded = GUARD.indexOf('if not v_guarded then');
    const bypass = GUARD.indexOf("current_setting('erp.subcontract_rollup'");
    const perms = GUARD.indexOf("v_take     := public.erp_has_permission('stage.take')");
    expect(guarded).toBeLessThan(bypass);
    expect(bypass).toBeLessThan(perms);
  });
});

/**
 * СТАРТОВЫЙ СТАТУС «Упаковки и отгрузки» (правка 23.08, п. 4).
 *
 * Писателей у задачи ТРИ: два серверных триггера и клиентский путь подряда
 * «под ключ» (`subcontractingSlice` — там производственных этапов нет вовсе,
 * и триггер не сработает никогда). Забытый писатель не роняет ничего: он
 * заводит задачу в статусе, которого интерфейс больше не знает, — карточка
 * выходит без единой кнопки, и заказ встаёт на складе молча.
 *
 * Сторож требует, чтобы КАЖДЫЙ писатель ставил `packing`, и чтобы снятые
 * статусы не вернулись ни в одного из них.
 */
describe('стартовый статус упаковки — один на всех писателей', () => {
  const SLICE = withoutJsComments(
    readFileSync(resolve(__dirname, '../store/slices/subcontractingSlice.ts'), 'utf8'),
  );

  it('оба серверных писателя заводят задачу «На упаковке»', () => {
    for (const [name, body] of [['finish', FINISH], ['fg_accepted', FG_ACCEPTED]] as const) {
      const at = body.indexOf("'pack_ship'");
      expect(at, `${name}: писателя pack_ship нет вовсе`).toBeGreaterThan(-1);
      expect(body.slice(at, at + 40), name).toMatch(/'pack_ship',\s*'packing'/);
    }
  });

  it('клиентский писатель (подряд «под ключ») ставит тот же статус', () => {
    expect(SLICE).toMatch(/'pack_ship',\s*'packing'/);
  });

  it('снятые статусы не вернулись ни к одному писателю', () => {
    // `awaiting_receipt` остаётся живым у subcontract_receipt — поэтому
    // проверяем его в СОСЕДСТВЕ с pack_ship, а не по всему тексту
    for (const body of [FINISH, FG_ACCEPTED, SLICE]) {
      expect(body).not.toMatch(/'pack_ship',\s*'(awaiting_receipt|accepted|packed)'/);
    }
  });
});


/**
 * СКЛАДСКАЯ ЦЕПОЧКА ОБРАЗЦА ЖДЁТ КНОПКУ «ЗАВЕРШИТЬ РАЗРАБОТКУ» (правки 02.09,
 * п. 2).
 *
 * До правки триггер про разработку не знал вовсе: закрылся последний этап —
 * завёл приёмку готовой продукции. На проде это видно дословно: заказ
 * «Тест экс цех 2» стоял `done` с принятой приёмкой ГП и отгруженной упаковкой,
 * а его разработка — в «Пошиве» с пустым исходом.
 *
 * ВТОРОЙ ПИСАТЕЛЬ ПРОВЕРЯЕТСЯ ОТДЕЛЬНО, и это главное здесь. Гейт снимается
 * закрытием РАЗРАБОТКИ, а derive висит на смене статуса ЭТАПА — к этому моменту
 * этапы закрыты, и событий от них больше не будет. Без триггера на
 * `erp_experimental` разработка, закрытая любым исходом кроме «готово к серии»,
 * оставила бы заказ без приёмки ГП НАВСЕГДА: гейт превратился бы из починки
 * в тупик. Та же причина, по которой 10.08 завели `erp_warehouse_fg_accepted`.
 */
describe('складские задачи образца ждут закрытия разработки', () => {
  it('задачи готовой продукции гейтятся общим предикатом', () => {
    expect(FINISH).toMatch(/erp_order_has_open_dev\(/);
  });

  it('гейт — РАННИЙ ВЫХОД, то есть накрывает и приёмку ГП, и упаковку', () => {
    const gate = FINISH.indexOf('erp_order_has_open_dev(');
    const fg = FINISH.indexOf("'fg_receipt'");
    const pack = FINISH.indexOf("'pack_ship'");
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(fg);
    expect(gate).toBeLessThan(pack);
  });

  it('приёмка материалов и маркировка гейтом НЕ накрыты', () => {
    // Приёмка закупленного идёт параллельно построению лекал — шаг 3
    // эталонного маршрута образца; маркировка к разработке отношения не имеет
    const supply = DERIVE.indexOf("v_code = 'supply'");
    const done = DERIVE.indexOf("if new.status = 'done' then");
    expect(supply).toBeGreaterThan(-1);
    expect(supply).toBeLessThan(done);
    expect(DERIVE).not.toMatch(/erp_order_has_open_dev/);
  });

  it('маркировка не заводится позиции-образцу', () => {
    expect(DERIVE).toMatch(/v_prod_type is distinct from 'samples'/);
  });

  it('второй писатель существует, ловит ЛЮБОЙ исход и висит AFTER', () => {
    expect(GATE_RELEASE).toMatch(/erp_ensure_order_finish_tasks\(/);
    // Любой исход, а не только «готово к серии»: иначе «Отменено» запирает заказ
    expect(GATE_RELEASE).toMatch(/old\.outcome is not null or new\.outcome is null/);
    expect(GATE_RELEASE).not.toMatch(/ready_for_serial/);
    // AFTER, а не BEFORE: в BEFORE `outcome` в таблице ещё старый, и предикат
    // счёл бы разработку открытой ровно в тот момент, ради которого снимается
    expect(GATE_RELEASE).toMatch(/after update of outcome on public\.erp_experimental/);
  });

  it('новая триггерная функция закрыта для REST', () => {
    expect(GATE_RELEASE).toMatch(
      /revoke execute on function public\.erp_dev_warehouse_gate_release\(\)\s*\n?\s*from public, anon, authenticated/,
    );
  });
});
