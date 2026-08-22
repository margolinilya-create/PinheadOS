/**
 * Сторож: приёмка материала пишет журнал ТОЙ ЖЕ транзакцией, что и статус.
 *
 * Отказ, ради которого он поставлен, нашёлся на боевой базе 22.08:
 *   · материалов со статусом `received`/`accepted_full` — 9
 *   · задач склада `material_receipt` закрыто — 6
 *   · строк в `erp_material_receipts` — 0
 *   · материалов с непустым `qty_received` — 0 из 19
 *
 * Журнал приходов, заведённый волной 3.3 как ЕДИНСТВЕННЫЙ писатель количества,
 * не получил ни одной записи за полтора месяца. Приёмка и приход были двумя
 * независимыми формами, и вторая работала без первой: заполняли ту, что
 * закрывает задачу.
 *
 * Ломалось при этом три вещи, и все молча: экран закупки показывал «принято: —»
 * у каждого принятого материала; «сколько осталось принять» считалось от нуля,
 * то есть частичная приёмка не работала вовсе; сортировка по «принято» падала
 * на дату. Производство не встало только потому, что материальный гейт цеха
 * смотрит `status` + `accept_status`, а не количество.
 *
 * ЧТО ИМЕННО ПРОВЕРЯЕТСЯ. Не наличие имён полей в тексте — этого мало, и проект
 * на таком уже ловился («ПРИНИМАТЬ — НЕ ЗНАЧИТ ЗАПИСАТЬ»: `erp_route_apply`
 * перечисляла все девять полей подрядного этапа, сторож был зелёным, а поля
 * доезжали со второго сохранения). Проверяется МЕХАНИЗМ: что у количества один
 * писатель, что клиент ходит через RPC и не пишет колонку сам, и что статус
 * приёмки нельзя объявить при пустом журнале.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  functionBody, latestDefining, latestMatching, withoutComments,
} from './migrations.testutil';

const ACCEPT_SQL = latestDefining('erp_material_accept');
const ROLLUP_SQL = latestDefining('erp_material_receipts_rollup');
const src = (p: string) => readFileSync(join(process.cwd(), 'src/erp', p), 'utf8');

/**
 * Исходник без комментариев JS.
 *
 * `withoutComments` из `migrations.testutil` снимает только SQL-строки `--`
 * и на JavaScript не действует. А проверки «этого здесь больше нет» ловятся
 * именно комментарием: объяснение, ПОЧЕМУ правила не стало, содержит те же
 * слова, что и само правило. На этом первая версия сторожа и упала — оба
 * падения были ложными.
 */
function withoutJsComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n');
}
const WAREHOUSE_SLICE = src('store/slices/warehouseSlice.ts');
const MATERIALS_SLICE = src('store/slices/materialsSlice.ts');
const RECEIPT_CARD = src('screens/warehouse/MaterialReceiptCard.jsx');
const MATERIAL_WAIT = src('screens/queue/MaterialWait.jsx');

describe('приёмка материала: журнал и статус одной транзакцией', () => {
  it('RPC пишет строку журнала и статус позиции', () => {
    const body = functionBody(ACCEPT_SQL, 'erp_material_accept');
    expect(body).toMatch(/insert into public\.erp_material_receipts/);
    expect(body).toMatch(/update public\.erp_materials/);
  });

  /**
   * Гейт, ради которого всё и делалось: «Принято полностью» невозможно при
   * нулевом приходе. `shortage`/`mismatch`/`rejected` под него не подпадают —
   * они как раз и означают, что пришло не то, не всё или не пришло вовсе.
   */
  it('приёмку нельзя объявить при пустом журнале', () => {
    const body = withoutComments(functionBody(ACCEPT_SQL, 'erp_material_accept'));
    expect(body).toMatch(/qty_received/);
    expect(body).toMatch(
      /p_accept_status in \('accepted_full', ?'accepted_partial'\)[\s\S]{0,80}<= 0/);
    expect(body).toMatch(/raise exception[\s\S]{0,120}укажите, сколько пришло/);
  });

  it('RPC замечает отказ RLS: «0 строк» — это не успех', () => {
    const body = withoutComments(functionBody(ACCEPT_SQL, 'erp_material_accept'));
    expect(body).toMatch(/get diagnostics .* = row_count/);
    expect(body).toMatch(/v_rows = 0[\s\S]{0,160}42501/);
  });

  /**
   * `security invoker` обязателен: «одним запросом» не значит «мимо RLS».
   * Право `material.receive` проверяет `erp_material_guard` от лица вызывающего,
   * и `definer` снял бы этот гейт целиком.
   */
  it('RPC исполняется от лица вызывающего', () => {
    expect(ACCEPT_SQL).toMatch(/create or replace function public\.erp_material_accept\([\s\S]{0,900}security invoker/);
    expect(ACCEPT_SQL).not.toMatch(/erp_material_accept\([\s\S]{0,900}security definer/);
  });

  /**
   * Повтор той же попытки не удваивает приход. Сумма журнала — это количество
   * материала на фабрике, и обрыв ответа при закоммиченной приёмке (обычное
   * дело на цеховом Wi-Fi) не должен превращаться во второй приход.
   *
   * Без этого нельзя делать и офлайн-очередь: она по определению повторяет
   * отправку и без идемпотентности лечила бы потерю связи удвоенным приходом.
   */
  it('повтор с тем же ключом не пишет вторую строку журнала', () => {
    const body = withoutComments(functionBody(ACCEPT_SQL, 'erp_material_accept'));
    expect(body).toMatch(/p_client_key is not null/);
    expect(body).toMatch(/where client_key = p_client_key/);
    // Вставка пропускается, а статус позиции всё равно приводится к запрошенному:
    // повтор обязан оставить систему в том же состоянии, а не в половинчатом
    expect(body).toMatch(/if p_qty is not null and not v_dup then/);
    expect(body).toMatch(/'duplicate'/);
  });

  it('ключ уникален на уровне схемы, а не только в коде функции', () => {
    const sql = latestMatching(
      /create unique index if not exists erp_material_receipts_client_key_idx/,
      'уникальный индекс client_key');
    // Частичный: у строк до 22.08 ключа нет, и NULL-ы не должны мешать друг другу
    expect(sql).toMatch(/where client_key is not null/);
  });

  /**
   * Прежняя сигнатура без ключа снимается тем же коммитом: оставленная рядом,
   * она стала бы вторым путём записи журнала — без идемпотентности.
   */
  it('сигнатуры без ключа не остаётся', () => {
    expect(ACCEPT_SQL).toMatch(
      /drop function if exists public\.erp_material_accept\([\s\S]{0,200}\)/);
  });

  it('перечень статусов в RPC совпадает с CHECK таблиц', () => {
    const body = functionBody(ACCEPT_SQL, 'erp_material_accept');
    for (const status of
      ['accepted_full', 'accepted_partial', 'shortage', 'mismatch', 'rejected']) {
      expect(body, `статус ${status} не назван в erp_material_accept`).toContain(`'${status}'`);
    }
  });
});

describe('у количества принятого ровно один писатель', () => {
  it('сумму журнала кладёт триггер, а не RPC', () => {
    expect(ROLLUP_SQL).toMatch(/set qty_received = \(\s*select sum\(r\.qty\)/);
    // RPC статус пишет, количество — нет: иначе приход затирал бы приход
    const body = functionBody(ACCEPT_SQL, 'erp_material_accept');
    const update = body.slice(body.indexOf('update public.erp_materials'));
    expect(update.slice(0, update.indexOf('where'))).not.toMatch(/qty_received\s*=/);
  });

  it('клиент qty_received не пишет вовсе', () => {
    for (const [name, text] of [
      ['warehouseSlice', WAREHOUSE_SLICE],
      ['materialsSlice', MATERIALS_SLICE],
      ['MaterialReceiptCard', RECEIPT_CARD],
      ['MaterialWait', MATERIAL_WAIT],
    ] as const) {
      expect(withoutJsComments(text), `${name} пишет qty_received напрямую`)
        .not.toMatch(/qty_received:\s/);
    }
  });

  /**
   * Второй писатель журнала — это та же развилка, из-за которой он и остался
   * пустым: одна форма закрывает задачу, другая пишет количество, и заполняют
   * первую. Вставка в `erp_material_receipts` живёт только в RPC.
   */
  it('клиент не вставляет строки журнала мимо RPC', () => {
    for (const [name, text] of [
      ['warehouseSlice', WAREHOUSE_SLICE],
      ['materialsSlice', MATERIALS_SLICE],
    ] as const) {
      expect(withoutJsComments(text), `${name} пишет журнал приходов в обход erp_material_accept`)
        .not.toMatch(/from\('erp_material_receipts'\)/);
    }
  });
});

describe('клиент ходит через RPC', () => {
  it('acceptMaterial зовёт erp_material_accept', () => {
    expect(WAREHOUSE_SLICE).toMatch(/supabase\.rpc\('erp_material_accept'/);
  });

  it('acceptMaterial не патчит материал мимо RPC', () => {
    const body = WAREHOUSE_SLICE.slice(
      WAREHOUSE_SLICE.indexOf('acceptMaterial:'),
      WAREHOUSE_SLICE.indexOf('submitWarehouseReport:'));
    expect(withoutJsComments(body)).not.toMatch(/updateMaterial\(/);
  });

  /**
   * Отказ сервера обязан отменять и продвижение задачи склада: закрытая задача
   * при непрошедшей приёмке — это зелёный экран поверх того, чего не было.
   */
  it('после отказа RPC приёмка прекращается', () => {
    const body = WAREHOUSE_SLICE.slice(
      WAREHOUSE_SLICE.indexOf('acceptMaterial:'),
      WAREHOUSE_SLICE.indexOf('submitWarehouseReport:'));
    expect(body).toMatch(/if \(error\)[\s\S]{0,140}return false;/);
  });

  /**
   * «Материал поступил» в очереди цеха оформляет приёмку полного плана. Раньше
   * туда уезжало `Number(m.qty_expected) || 0` — у позиции без плана приёмка
   * оформлялась на ноль единиц. Теперь путь закрыт до вызова.
   */
  it('отметка поступления в цехе требует планового количества', () => {
    expect(MATERIAL_WAIT).toMatch(/planned > 0/);
    expect(withoutJsComments(MATERIAL_WAIT)).not.toMatch(/Number\(m\.qty_expected\) \|\| 0/);
  });

  /**
   * Форма приёмки была одна на два действия со СВОИМ селектом статуса у каждого.
   * Второй такой селект — это снова «статус рядом с величиной, которую ведёт
   * журнал», то есть разрешение соврать.
   */
  it('в карточке приёмки один селект статуса и одна кнопка', () => {
    const card = withoutJsComments(RECEIPT_CARD);
    const selects = card.match(/MATERIAL_ACCEPT_LABELS\)\.map/g) ?? [];
    expect(selects, 'селектов статуса приёмки должно быть ровно один').toHaveLength(1);
    expect(card).not.toMatch(/Записать приход/);
  });
});
