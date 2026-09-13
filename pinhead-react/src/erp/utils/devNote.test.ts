import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isBrandingDept, stageBrandingNote } from './devNote';
import { devNotePrompt } from './devBoardMove';

/**
 * ПРАВКА ЗАКАЗЧИКА 13.09, П. 10: результат этапа проработки.
 *
 * «Для перехода в „Шелкография", „DTF" или „Вышивка" показывать небольшое поле
 * „Комментарий по проработке" перед завершением/переносом этапа. Поле
 * необязательное… Если комментарий заполнен, сохранить его в карточке
 * разработки как результат этапа проработки и показывать дальше в задаче
 * выбранного участка нанесения».
 */
describe('Комментарий по проработке: вопрос при переносе', () => {
  it('спрашивается при ходе ВПЕРЁД в «Нанесения» и необязателен', () => {
    const prompt = devNotePrompt('cutting', 'branding', {});
    expect(prompt).not.toBeNull();
    expect(prompt?.field).toBe('branding_note');
    expect(prompt?.label).toBe('Комментарий по проработке');
  });

  it('уже записанное подставляется, а не набирается заново', () => {
    expect(devNotePrompt('cutting', 'branding', { branding_note: 'мерить по лекалу' })
      ?.initialValue).toBe('мерить по лекалу');
  });

  it('на других переходах и при возврате назад не спрашивается', () => {
    expect(devNotePrompt('cutting', 'sewing', {})).toBeNull();
    expect(devNotePrompt('patterns', 'cutting', {})).toBeNull();
    // Назад карточку двигают, когда работу переделывают: результат там
    // записывать не о чем
    expect(devNotePrompt('sewing', 'branding', {})).toBeNull();
  });

  it('поле НЕ обязательное — иначе это блокировка, которую документ запрещает', () => {
    const src = readFileSync(
      join(process.cwd(), 'src/erp/hooks/useDevStageMove.js'), 'utf8',
    );
    const call = src.slice(src.indexOf('const note = devNotePrompt('));
    const body = call.slice(0, call.indexOf('\n    }\n'));
    expect(body).toContain('required: false');
    /**
     * И пишется ДО колонки — тем же порядком, что название лекал: обратный
     * оставил бы карточку в «Нанесениях» с незаписанным результатом
     * покидаемого этапа.
     */
    expect(src.indexOf('const note = devNotePrompt('))
      .toBeLessThan(src.indexOf("board_stage: 'branding'"));
  });
});

describe('Комментарий по проработке: кому он виден', () => {
  const order = {
    developments: [
      { id: 'd1', item_id: 'it-1', outcome: null, handed_to_warehouse_at: null, branding_note: 'нитка тон в тон' },
      { id: 'd2', item_id: 'it-2', outcome: null, handed_to_warehouse_at: null, branding_note: null },
    ],
  };

  it('участки нанесения узнаются из карты методов, а не списком по месту', () => {
    expect(isBrandingDept({ code: 'silkscreen' })).toBe(true);
    expect(isBrandingDept({ code: 'dtf' })).toBe(true);
    expect(isBrandingDept({ code: 'embroidery' })).toBe(true);
    expect(isBrandingDept({ code: 'cutting' })).toBe(false);
    expect(isBrandingDept(null)).toBe(false);
  });

  it('цех нанесения видит комментарий своей позиции', () => {
    expect(stageBrandingNote(order, { item_id: 'it-1' }, { code: 'embroidery' }))
      .toBe('нитка тон в тон');
  });

  it('чужая позиция, пустой комментарий и НЕ-нанесение молчат', () => {
    expect(stageBrandingNote(order, { item_id: 'it-2' }, { code: 'dtf' })).toBeNull();
    expect(stageBrandingNote(order, { item_id: 'it-9' }, { code: 'dtf' })).toBeNull();
    // В закрое этот текст отвечал бы на вопрос, которого там не задают
    expect(stageBrandingNote(order, { item_id: 'it-1' }, { code: 'cutting' })).toBeNull();
    // Заказ без разработок — обычная серия, комментария нет по построению
    expect(stageBrandingNote({}, { item_id: 'it-1' }, { code: 'dtf' })).toBeNull();
  });

  it('колонка едет эмбедом ОБЕИХ выборок заказа', () => {
    /**
     * Колонка, не попавшая в `ORDER_LIST_SELECT`, приезжает `undefined` МОЛЧА,
     * без единой ошибки — на этом в проекте уже ловились с `executor`.
     * А строка очереди цеха, где комментарий и нужен, читает именно списочную.
     */
    const src = readFileSync(
      join(process.cwd(), 'src/erp/store/orderHelpers.ts'), 'utf8',
    );
    const embeds = src.match(/developments:erp_experimental[^\n]*/g) ?? [];
    expect(embeds).toHaveLength(2);
    for (const e of embeds) expect(e).toContain('branding_note');
  });
});
