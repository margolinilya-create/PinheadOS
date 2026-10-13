// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { functionBody, latestDefining, withoutComments, withoutJsComments } from './migrations.testutil';

/**
 * ОДНО ПРАВИЛО «МАТЕРИАЛ НА МЕСТЕ» — И НА КЛИЕНТЕ, И НА СЕРВЕРЕ.
 *
 * Правило существовало в двух копиях, и это не теория: гейт ЗАПУСКА цеха
 * (`routes.isMaterialPending`) с 22.07 спрашивает вердикт приёмки, а гейт
 * ЗАВЕРШЕНИЯ этапа (`supply.isMaterialSettled` + серверное зеркало
 * `erp_stage_completion_block`) спрашивал одну колонку `status`. Приёмка
 * (`erp_material_accept`) ставит `received` при ЛЮБОМ исходе — включая
 * недостачу, пересорт и прямой отказ.
 *
 * На боевой базе 04.09: шесть позиций `received` без годной приёмки (в их
 * числе «Кулирка 100хб 250гр», принятая с недостачей 40 из 42), у всех шести
 * закупка закрыта автозакрытием, а на заказе 60448 закрой закрыт целиком
 * (75/75, 50/50, 75/75) при трёх непринятых позициях. То есть этап, который
 * цех не смог бы ВЗЯТЬ в работу, он смог ЗАКРЫТЬ.
 *
 * Поведение обеих функций проверяют `supply.test.ts` и `routes.test.ts`.
 * Здесь сторожатся две вещи, которых поведением не поймать:
 *   · клиент не завёл вторую формулу заново (её легко «вернуть как было»);
 *   · серверное зеркало умеет то же самое (клиентский гейт без серверного —
 *     дыра через REST, правило проекта).
 */

const SRC = (rel: string) => readFileSync(join(process.cwd(), 'src/erp', rel), 'utf8');

describe('«материал на месте» — одна формула', () => {
  it('клиент выводит `isMaterialSettled` из гейта запуска, а не считает сам', () => {
    const supply = withoutJsComments(SRC('utils/supply.ts'));
    expect(supply).toMatch(/isMaterialSettled[^)]*\)[^{]*\{\s*return !isMaterialPending\(m\);/);
    /**
     * Прежняя формула — перечисление трёх статусов подряд. Ищется именно она,
     * а не слово `received`: оно законно стоит в `arrived` и `inTransit`,
     * которые отвечают на другой вопрос («сколько пришло»), а не на «годен ли».
     */
    expect(supply).not.toMatch(
      /'received'\s*\|\|[^;]*'reserved'\s*\|\|[^;]*'not_needed'/);
  });

  it('серверное зеркало спрашивает вердикт приёмки, а не только статус', () => {
    const sql = withoutComments(
      functionBody(latestDefining('erp_stage_completion_block'), 'erp_stage_completion_block'));
    // «Со склада» и «не требуется» годны без приёмки — они и остаются в списке
    expect(sql).toMatch(/not in \('reserved', 'not_needed'\)/);
    // Пришедшее закупочное — только после приёмки
    expect(sql).toMatch(/accept_status[\s\S]*?not in \('accepted_full', 'accepted_partial'\)/);
    // Прежнее условие по одной колонке снято целиком
    expect(sql).not.toMatch(/not in \('received', 'reserved', 'not_needed'\)/);
  });

  /**
   * Слова отказа обязаны совпадать: человек читает один список — и в кнопке,
   * и в ответе сервера. «Придут ИЛИ будут взяты со склада» описывало половину
   * условия, и тому, у кого материал ПРИШЁЛ, читалось как ошибка системы.
   */
  it('сервер и клиент отказывают одними словами', () => {
    const tail = 'Этап можно закрыть, когда материалы придут и склад их примет.';
    expect(withoutJsComments(SRC('utils/stageDone.ts'))).toContain(tail);
    expect(latestDefining('erp_stage_completion_block')).toContain(tail);
  });
});

/**
 * АВТОЗАКРЫТИЕ ЗАКУПКИ — НА СЕРВЕРЕ, ПОД МЕТКОЙ (правка заказчика 27.09, п. 9).
 *
 * Клиентское автозакрытие при приёмке шло от лица кладовщика, и страж
 * отвечал 42501: заказ 65004 стоял «В работе» при всех принятых материалах.
 * Теперь этап закрывает триггер в транзакции приёмки, а правило «полностью
 * поступил» живёт в двух копиях — здесь сторожится, что они совпадают
 * и что пропуск стража узкий.
 */
describe('автозакрытие закупки (27.09, п. 9)', () => {
  const fully = withoutComments(
    functionBody(latestDefining('erp_material_fully_received'), 'erp_material_fully_received'));

  it('сервер требует accepted_full И количество не меньше плана', () => {
    expect(fully).toMatch(/in \('reserved', 'not_needed'\)/);
    expect(fully).toMatch(/accept_status, ''\) = 'accepted_full'/);
    expect(fully).toMatch(/qty_received, 0\) >= m\.qty_expected/);
    expect(fully).toMatch(/qty_expected, 0\) > 0/);
    // Частичная приёмка закупку не закрывает — в отличие от гейтов цеха
    expect(fully).not.toContain('accepted_partial');
  });

  it('клиентское зеркало спрашивает то же самое', () => {
    const supply = withoutJsComments(SRC('utils/supply.ts'));
    const body = /isMaterialFullyReceived\([\s\S]*?\n\}/.exec(supply)?.[0] ?? '';
    expect(body).toContain("status === 'reserved' || status === 'not_needed'");
    expect(body).toContain("m.accept_status !== 'accepted_full'");
    expect(body).toMatch(/need > 0 && got >= need/);
    expect(body).not.toContain('accepted_partial');
  });

  it('триггер стоит на материалах и ловит приход, вердикт и план', () => {
    const sql = latestDefining('erp_supply_autoclose');
    expect(sql).toMatch(
      /create trigger erp_supply_autoclose\s+after insert or update of status, accept_status, qty_received, qty_expected\s+on public\.erp_materials/);
    // Закрытие идёт под меткой транзакции и пишет событие только при переходе
    expect(sql).toContain("set_config('erp.supply_autoclose', 'on', true)");
    expect(sql).toContain("set_config('erp.supply_autoclose', 'off', true)");
    expect(sql).toMatch(/if found then\s+insert into public\.erp_stage_events/);
    // Пустой список готовым не считается — то же правило, что у клиента
    expect(withoutComments(functionBody(sql, 'erp_supply_autoclose')))
      .toMatch(/if not exists \(select 1 from public\.erp_materials m where m\.order_id = v_order\)/);
  });

  it('страж пропускает метку только у этапа закупки и только на статус', () => {
    const guard = withoutComments(functionBody(latestDefining('erp_stage_guard'), 'erp_stage_guard'));
    const at = guard.indexOf("current_setting('erp.supply_autoclose', true)");
    expect(at).toBeGreaterThan(0);
    const branch = guard.slice(at, guard.indexOf('return new;', at));
    expect(branch).toContain("new.status = 'done' and old.status is distinct from 'done'");
    expect(branch).toContain("d.code = 'supply'");
    expect(branch).toMatch(/to_jsonb\(new\) - array\['updated_at', 'status', 'finished_at'\]/);
    expect(branch).toMatch(/to_jsonb\(old\) - array\['updated_at', 'status', 'finished_at'\]/);
  });

  /**
   * Клиент этап закупки больше не пишет: второй писатель дал бы два закрытия
   * наперегонки и двойное событие в истории. Мутация — вернуть
   * `setStageStatus(st.id, 'done'` в `maybeCloseSupply` — тест красный.
   */
  it('клиент только перечитывает заказ — этап закупки пишет сервер', () => {
    const slice = withoutJsComments(SRC('store/slices/materialsSlice.ts'));
    const body = /maybeCloseSupply: async[\s\S]*?\n {2}\},/.exec(slice)?.[0] ?? '';
    expect(body).not.toContain("setStageStatus(");
    expect(body).toContain('loadOne(orderId)');
    expect(body).toContain('allFullyReceived');
    const wh = withoutJsComments(SRC('store/slices/warehouseSlice.ts'));
    expect(wh).not.toContain('maybeCloseSupply(');
  });
});
