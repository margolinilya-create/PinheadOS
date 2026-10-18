// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { mockAnswersForTest as mock, type MockExtras } from '../../../e2e/support/mockSupabase';

/**
 * Мок e2e `storage.list` (веха 5б, задача 7): «папки» `v<N>` из карты
 * `storageObjects`, как отвечает Storage (`id: null` у папки), и
 * `storageListHidden` — объект есть, а список его не видит (гонка в e2e 2б).
 * Без этого стартовая версия выпуска (`listFlatVersions`, К3) в e2e всегда
 * считалась бы по пустому бакету. Сквозной путь на настоящем supabase-js —
 * e2e `order-flats-admin.spec.ts` (2б′: занятый номер виден `list`).
 */
const body = (text: string) => ({ type: 'image/svg+xml', body: Buffer.from(text) });

function bucket(): MockExtras {
  return {
    storageObjects: {
      'garment-flats/flats/tee/v1/front.svg': body('<svg/>'),
      'garment-flats/flats/tee/v1/back.svg': body('<svg/>'),
      'garment-flats/flats/tee/v2/front.svg': body('<svg>чужой</svg>'),
      'garment-flats/flats/tee/v10/front.svg': body('<svg/>'),
      'garment-flats/flats/teeshirt/v7/front.svg': body('<svg/>'),
      'order-artworks/orders/x/logo/a.png': { type: 'image/png', body: Buffer.from('png') },
    },
  };
}

describe('мок e2e: storage.list по карте объектов', () => {
  it('папки версий под префиксом — id null, по алфавиту; соседний флэт с тем же началом имени не попадает', () => {
    const rows = mock.storageList('garment-flats', { prefix: 'flats/tee', limit: 100, offset: 0 }, bucket());
    expect(rows).toEqual([
      { name: 'v1', id: null, metadata: null },
      { name: 'v10', id: null, metadata: null },
      { name: 'v2', id: null, metadata: null },
    ]);
  });

  it('файлы в папке — с id и размером; страница offset/limit', () => {
    const ex = bucket();
    const files = mock.storageList('garment-flats', { prefix: 'flats/tee/v1/' }, ex);
    expect(files.map((r) => [r.name, r.id === null])).toEqual([['back.svg', false], ['front.svg', false]]);
    expect(files[1].metadata).toMatchObject({ size: 6, mimetype: 'image/svg+xml' });
    expect(mock.storageList('garment-flats', { prefix: 'flats/tee', limit: 1, offset: 1 }, ex).map((r) => r.name)).toEqual(['v10']);
  });

  it('storageListHidden: скрытый объект не виден, папка из одних скрытых — тоже', () => {
    const ex = { ...bucket(), storageListHidden: ['garment-flats/flats/tee/v2/front.svg'] };
    expect(mock.storageList('garment-flats', { prefix: 'flats/tee' }, ex).map((r) => r.name)).toEqual(['v1', 'v10']);
  });

  it('без карты объектов — пусто (прежнее поведение); другой бакет не смешивается', () => {
    expect(mock.storageList('garment-flats', { prefix: 'flats/tee' }, {})).toEqual([]);
    expect(mock.storageList('order-artworks', { prefix: 'flats/tee' }, bucket())).toEqual([]);
  });

});
