import { describe, expect, it } from 'vitest';
import { readdirSync } from 'node:fs';
import {
  MIGRATIONS_DIR, functionBody, latestDefining, migration, withoutComments,
} from './migrations.testutil';
import { ORDER_STATUS_LABELS, type ErpOrderStatus } from '../types';

/**
 * Сторож: заказ без срока сдачи не объявляется сданным ВОВРЕМЯ.
 *
 * ЧТО БЫЛО (аудит 02.09.2026). `erp_ship_order` при полной отгрузке считал
 * запас до срока и склеивал две разные величины в одну ветку:
 *
 *     when v_left is null or v_left = 0 then 'done_on_time'
 *
 * Слева — «срока не было вовсе», справа — «сдали ровно в срок». Первое это
 * НЕИЗВЕСТНО, и утвердительного ответа на него быть не может. На проде так
 * были помечены ШЕСТЬ из десяти закрытых заказов: отчётность о соблюдении
 * сроков больше чем наполовину состояла из заказов, у которых сравнивать
 * было не с чем, и ни один экран этого не показывал — статус выглядел обычным.
 *
 * Это тот же дефект, от которого в `utils/format.percentOf` стоит `null` при
 * нуле в знаменателе («ноль в знаменателе — это „неизвестно", а не „готово"»),
 * только на сервере и в статусе заказа, где он заметен ещё меньше.
 *
 * ПОЧЕМУ СТОРОЖ НУЖЕН. Ошибка выражается ОДНИМ оператором `or`, переживает
 * любой рефакторинг незамеченной и не роняет ничего: заказ закрывается,
 * склад работает, врёт только отчёт. Ни один существующий тест её не видел —
 * ни unit (функция серверная), ни e2e (мок не считает статусы).
 *
 * Читается ДЕЙСТВУЮЩЕЕ определение (`latestDefining`), а не файл конкретной
 * миграции: функции пересоздаются целиком, и привязка к имени файла сделала бы
 * сторожа зелёным на следующей же правке тела.
 */

describe('erp_ship_order: отсутствие срока — своя ветка', () => {
  const SQL = latestDefining('erp_ship_order');
  const body = withoutComments(functionBody(SQL, 'erp_ship_order'));

  it('заказ без срока закрывается статусом done', () => {
    expect(body).toMatch(/when\s+v_left\s+is\s+null\s+then\s+'done'/i);
  });

  it('«срока нет» больше не склеено с «ровно в срок» через or', () => {
    /**
     * Ровно та строка, которой дефект и выражался. Проверяем ОТСУТСТВИЕ
     * конструкции, а не только наличие правильной: обе могут сосуществовать,
     * и тогда первая по порядку ветка решала бы всё.
     */
    expect(
      body,
      'Ветка «срока нет» снова склеена с «ровно в срок» — заказ без срока '
      + 'опять объявляется сданным вовремя',
    ).not.toMatch(/v_left\s+is\s+null\s+or\s+v_left\s*=\s*0/i);
  });

  it('«ровно в срок» осталось отдельной веткой и даёт done_on_time', () => {
    // Иначе починка первой ветки могла бы забрать вместе с ней и вторую,
    // и заказ, сданный день в день, перестал бы считаться сданным вовремя
    expect(body).toMatch(/when\s+v_left\s*=\s*0\s+then\s+'done_on_time'/i);
  });

  it('порядок веток: «срока нет» проверяется первой', () => {
    // `case` в SQL выбирает ПЕРВУЮ истинную ветку. Стой `v_left = 0` выше,
    // при v_left is null она бы не сработала (NULL = 0 не истина), и порядок
    // ничего бы не решал — но полагаться на это нельзя: следующая правка
    // может сравнивать через coalesce, и тогда порядок станет решающим.
    const noDue = body.search(/when\s+v_left\s+is\s+null/i);
    const onTime = body.search(/when\s+v_left\s*=\s*0/i);
    expect(noDue).toBeGreaterThanOrEqual(0);
    expect(onTime).toBeGreaterThan(noDue);
  });
});

describe('статус done заведён во всех местах, где перечисляются статусы', () => {
  /**
   * Значение статуса живёт в ТРЁХ местах: CHECK базы, тип `ErpOrderStatus`
   * и таблица подписей. Пропуск последнего ничего не роняет — он молча
   * оставляет заказ без подписи (`undefined` в интерфейсе), ровно как
   * это уже случалось с видами справочников и состояниями разработки.
   */
  it('CHECK базы принимает done', () => {
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
    const constraints = files
      .map((f) => withoutComments(migration(f)))
      .filter((sql) => sql.includes('erp_orders_status_check'));

    const last = constraints[constraints.length - 1];
    expect(last, 'ни одна миграция не заводит erp_orders_status_check').toBeTruthy();
    expect(last).toMatch(/'done'/);
    // Прежние значения не потерялись вместе с добавлением нового
    for (const kept of ['active', 'done_on_time', 'done_late', 'done_early', 'cancelled']) {
      expect(last, `CHECK потерял значение ${kept}`).toMatch(new RegExp(`'${kept}'`));
    }
  });

  it('у done есть подпись, и она не обещает «вовремя»', () => {
    const label = ORDER_STATUS_LABELS['done' as ErpOrderStatus];
    expect(label).toBeTruthy();
    expect(
      label.toLowerCase(),
      'Подпись обязана признавать, что сравнивать было не с чем, а не выбирать сторону',
    ).not.toMatch(/вовремя|в срок|заранее|опоздан/);
  });
});
