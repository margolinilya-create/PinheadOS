// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { latestMatching, withoutComments, withoutJsComments } from './migrations.testutil';
import { columnsOf, nullableOf } from '../../types/schema.testutil';

/**
 * РАЗРАБОТКА БЕЗ СДЕЛКИ (правка 14.09, расхождение №4).
 *
 * Требование документа: разработку можно вести «на полку» и привязать
 * к заказу позже, а её переписка после привязки видна из чата сделки
 * БЕЗ КОПИРОВАНИЯ сообщений.
 *
 * ЧТО ЗДЕСЬ СТОРОЖИТСЯ И ПОЧЕМУ ИМЕННО ЭТО.
 *
 * Снять `NOT NULL` — одна строка, и она себя не сторожит: колонку легко
 * вернуть обратно «за компанию» при следующей правке схемы. Но дороже другое —
 * ТРИ вещи, без любой из которых требование исполняется наполовину и молча:
 *
 *   1. `erp_order_attachments.order_id` тоже обязан быть обнуляемым. Иначе
 *      разработка «на полку» не удержит собственный техпакет — лекала,
 *      техпаспорт и фото образца, то есть ровно то, ради чего она и ведётся,
 *      и то, что автопубликация копирует в карточку модели;
 *   2. у вложения обязан остаться ЯКОРЬ. Строка без заказа И без разработки —
 *      файл, которого не покажет ни один экран и который уборка `storage-gc`
 *      сочтёт ЖИВЫМ (ключ в строке есть): платный объект, невидимый
 *      и неудаляемый;
 *   3. привязка обязана быть ОТДЕЛЬНЫМ действием со своим гейтом, а не
 *      правкой колонки через общую UPDATE-политику.
 *
 * Поведение проверено на ЖИВОЙ базе (15.09, транзакция с откатом): заведение
 * без сделки, файл без заказа, отказ файлу без якоря, отказ позиции чужой
 * сделки, привязка, отказ повторной привязке и то, что чат сделки после
 * привязки отдаёт тред разработки.
 */

const SRC = join(process.cwd(), 'src');
const SQL = withoutComments(latestMatching(
  /alter column order_id drop not null/,
  'снятие NOT NULL с order_id разработки',
));

describe('разработка без сделки', () => {
  it('order_id разработки обнуляем и в схеме, и в ручном типе', () => {
    /**
     * Обнуляемость — ТРЕТИЙ вопрос сверки типов (записанное правило): «поле
     * есть» и «лишнего нет» на него не отвечают. Колонка, которая в БД бывает
     * NULL, а в типе объявлена простым `string`, проходит обе проверки — и это
     * худший случай: код считает поле заполненным, `tsc` подтверждает,
     * а в проде приезжает null.
     */
    expect(nullableOf('erp_experimental').get('order_id')).toBe(true);

    const types = withoutJsComments(readFileSync(join(SRC, 'erp/types.ts'), 'utf8'));
    const block = types.slice(types.indexOf('export interface ErpExperimental {'));
    expect(
      block.slice(0, block.indexOf('}')),
      'ErpExperimental.order_id объявлен без null — тип врёт о данных',
    ).toMatch(/order_id:\s*string\s*\|\s*null/);
  });

  it('вложение может жить без заказа — иначе техпакета у разработки не будет', () => {
    expect(columnsOf('erp_order_attachments')).toContain('order_id');
    expect(nullableOf('erp_order_attachments').get('order_id')).toBe(true);
  });

  it('у вложения остаётся якорь: заказ либо разработка', () => {
    // Строка без единого якоря — файл, невидимый экранам и «живой» для уборки
    expect(SQL).toMatch(/erp_order_attachments_anchor_check/);
    expect(SQL).toMatch(/order_id is not null or experimental_id is not null/);
  });

  it('привязка — отдельное действие со своим правом', () => {
    expect(SQL).toMatch(/create or replace function public\.erp_experimental_attach_order/);
    expect(SQL).toMatch(/erp_has_permission\('experimental\.manage'\)/);
  });

  /**
   * ПОВТОРНАЯ ПРИВЯЗКА ЗАПРЕЩЕНА. Перенос разработки между сделками — другой
   * вопрос: у неё уже могут быть этапы цехов, задача склада и переписка,
   * и «просто сменить order_id» оставило бы их у прежнего заказа. Отказать
   * честнее, чем сделать половину.
   */
  it('повторная привязка отвергается, а не переносит разработку молча', () => {
    expect(SQL).toMatch(/v_dev\.order_id is not null[\s\S]{0,160}raise exception/);
  });

  /**
   * ПОЗИЦИЯ ПРОВЕРЯЕТСЯ НА ПРИНАДЛЕЖНОСТЬ СДЕЛКЕ: иначе разработку можно
   * привязать к заказу A, указав позицию заказа B, и `erp_experimental_task_send`
   * завёл бы этап в ЧУЖОМ заказе. Тот же довод, по которому `erp_chat_send`
   * проверяет принадлежность контекста.
   */
  it('позиция чужой сделки отвергается', () => {
    expect(SQL).toMatch(/i\.id = p_item and i\.order_id = p_order/);
  });

  /**
   * ФАЙЛЫ НЕ ПЕРЕПРИВЯЗЫВАЮТСЯ — записанное правило проекта: лекала
   * и техпаспорт описывают МОДЕЛЬ, а не тот заказ, из которого она вышла.
   * Привязка, которая заодно тащит файлы в сделку, нарушила бы его молча.
   */
  it('привязка не трогает вложения', () => {
    const body = SQL.slice(SQL.indexOf('erp_experimental_attach_order'));
    expect(body).not.toMatch(/update public\.erp_order_attachments/);
  });

  it('форма заведения разработки существует и не требует сделки', () => {
    /**
     * До 15.09 входа не было ВОВСЕ: разработка рождалась только побочным
     * действием создания заказа с позицией-образцом. Снятие NOT NULL
     * в одиночку не дало бы ни одной разработки «на полку» — требование
     * упиралось не в колонку, а в отсутствие формы.
     */
    const modal = withoutJsComments(
      readFileSync(join(SRC, 'erp/screens/experimental/DevCreateModal.jsx'), 'utf8'),
    );
    expect(modal).toMatch(/create\(form\.orderId \|\| null/);

    const screen = withoutJsComments(
      readFileSync(join(SRC, 'erp/screens/Experimental.jsx'), 'utf8'),
    );
    expect(screen, 'кнопки «Завести разработку» нет на экране ЭКС').toMatch(/DevCreateModal/);
  });

  it('файл разработки без заказа не уезжает в общую папку бакета', () => {
    /**
     * `attachmentFilePath(orderId, …)` при пустом заказе дал бы ключ
     * `att/null/…` — путь валидный, и файлы ВСЕХ беззаказных разработок легли
     * бы в одну папку с чужими. Владелец этих файлов — сама разработка,
     * её id и становится папкой.
     */
    const slice = withoutJsComments(
      readFileSync(join(SRC, 'erp/store/slices/experimentalSlice.ts'), 'utf8'),
    );
    expect(slice).toMatch(/attachmentFilePath\(orderId \|\| devId/);
    expect(slice, 'order_id вложения уходит пустой строкой вместо null').toMatch(/order_id: orderId \|\| null/);
  });
});
