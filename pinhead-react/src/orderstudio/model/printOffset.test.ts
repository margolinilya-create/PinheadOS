import { describe, it, expect } from 'vitest';
import { offsetNote, offsetText } from './printOffset';
import type { SalesPrint } from './types';

type Off = Pick<SalesPrint, 'offset_mm' | 'offset_from' | 'offset_dir'>;
const p = (offset_mm: number | null, offset_from: Off['offset_from'], offset_dir: Off['offset_dir']): Off =>
  ({ offset_mm, offset_from, offset_dir });

/**
 * Паритет с тремя прежними копиями (`maketPages.ts:81`, `canvasText.ts:40`,
 * `PrintRow.jsx:27`). Где копии сходились — вывод тот же. Где расходились,
 * выбрано (задача 2 вехи 6+7):
 *  - вниз от опоры — «от» (холст и строка нанесения; образец ТЗ «10 см от шва
 *    горловины»), а не «ниже» легенды макета;
 *  - `part_seam` — «шва детали» (макет), а не «шва»: в ТЗ рукав и деталь различимы;
 *  - `center` и левее/правее — как у макета (холст и строка опору «центр» молчали).
 */
describe('offsetText — паритет прежних копий', () => {
  it('где три копии сходились — тот же текст', () => {
    expect(offsetText(p(80, 'neck_seam', 'down'))).toBe('80 мм от шва горловины');
    expect(offsetText(p(80, 'neck_seam', ''))).toBe('80 мм от шва горловины');
    expect(offsetText(p(5, 'neck_seam', 'up'))).toBe('5 мм выше шва горловины');
    expect(offsetText(p(12, 'top_edge', 'down'))).toBe('12 мм от верхнего края');
    expect(offsetText(p(30, 'top_edge', 'up'))).toBe('30 мм выше верхнего края');
  });

  it('без мм, без опоры и с опорой «другое» — пусто', () => {
    expect(offsetText(p(null, 'neck_seam', 'down'))).toBe('');
    expect(offsetText(p(80, '', 'down'))).toBe('');
    expect(offsetText(p(80, 'other', 'up'))).toBe('');
  });

  it('расхождения копий: шов детали, центр, левее/правее', () => {
    expect(offsetText(p(20, 'part_seam', 'up'))).toBe('20 мм выше шва детали');
    expect(offsetText(p(15, 'center', 'left'))).toBe('15 мм левее центра');
    expect(offsetText(p(15, 'center', 'right'))).toBe('15 мм правее центра');
    expect(offsetText(p(0, 'neck_seam', 'down'))).toBe('0 мм от шва горловины');
  });
});

describe('offsetNote — отступ с холста и ручная заметка (ТЗ и мост в ERP)', () => {
  const n = (offset_mm: number | null, offset_note: string | null) =>
    ({ offset_mm, offset_from: 'neck_seam' as const, offset_dir: 'down' as const, offset_note: offset_note as string });
  it('мм с холста без заметки — текст отступа', () => {
    expect(offsetNote(n(70, ''))).toBe('70 мм от шва горловины');
  });
  it('мм и заметка — через «; », отступ первым', () => {
    expect(offsetNote(n(70, '  по центру кармана '))).toBe('70 мм от шва горловины; по центру кармана');
  });
  it('без мм — ровно ручная заметка, без разделителя в начале', () => {
    expect(offsetNote(n(null, 'по центру кармана'))).toBe('по центру кармана');
  });
  it('ничего нет — пусто, и null в заметке не падает', () => {
    expect(offsetNote(n(null, null))).toBe('');
  });
});
