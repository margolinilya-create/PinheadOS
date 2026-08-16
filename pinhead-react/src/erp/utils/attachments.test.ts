import { describe, it, expect } from 'vitest';
import { itemAttachments, materialAttachments, countItemAttachments } from './attachments';
import { attachmentFilePath, safeFileName } from './storageKey';

/**
 * Отбор вложений и ключ объекта в Storage.
 *
 * Оба правила уже один раз стоили работы приложения — только по разным
 * причинам: ключ с кириллицей отвечал `InvalidKey` и не давал создать НИ ОДНОГО
 * заказа с ТЗ, а «чей это файл» разъезжалось бы по экранам молча, показывая
 * цеху чужую схему узла.
 */

const att = (over: Record<string, unknown>) => ({
  id: 'a1', kind: 'tech', item_id: null, material_id: null, ...over,
} as never);

const ORDER = {
  attachments: [
    att({ id: 'a1', kind: 'tech', item_id: 'i1' }),
    att({ id: 'a2', kind: 'packaging', item_id: 'i1' }),
    att({ id: 'a3', kind: 'tech', item_id: 'i2' }),
    att({ id: 'a4', kind: 'purchase', material_id: 'm1' }),
    att({ id: 'a5', kind: 'attachment', item_id: null }),
  ],
};

describe('вложения позиции', () => {
  it('отбираются по виду И по позиции', () => {
    expect(itemAttachments(ORDER, 'i1', 'tech').map((a) => a.id)).toEqual(['a1']);
    expect(itemAttachments(ORDER, 'i1', 'packaging').map((a) => a.id)).toEqual(['a2']);
    expect(itemAttachments(ORDER, 'i2', 'tech').map((a) => a.id)).toEqual(['a3']);
  });

  /**
   * Файл ЗАКАЗА к позиции не подмешивается — в отличие от ТЗ, где «своё →
   * общее» правильно. Общее ТЗ описывает весь заказ и применимо к любой
   * позиции; превью упаковки одной позиции к другой отношения не имеет,
   * и показать чужую схему узла хуже, чем не показать никакой.
   */
  it('файл заказа не подмешивается к позиции', () => {
    expect(itemAttachments(ORDER, 'i1', 'attachment')).toEqual([]);
  });

  /**
   * Вложения приезжают из двух выборок, и в списочной их нет вовсе.
   * `undefined` обязан читаться как «файлов нет», а не ронять экран.
   */
  it('заказ без поля attachments не роняет отбор', () => {
    expect(itemAttachments({}, 'i1', 'tech')).toEqual([]);
    expect(itemAttachments(null, 'i1', 'tech')).toEqual([]);
    expect(materialAttachments(undefined, 'm1')).toEqual([]);
    expect(countItemAttachments(null, 'i1', ['tech'])).toBe(0);
  });

  it('референсы закупки привязаны к СТРОКЕ, а не к заказу', () => {
    expect(materialAttachments(ORDER, 'm1').map((a) => a.id)).toEqual(['a4']);
    expect(materialAttachments(ORDER, 'm2')).toEqual([]);
  });

  it('счётчик берёт несколько видов сразу', () => {
    expect(countItemAttachments(ORDER, 'i1', ['tech', 'packaging'])).toBe(2);
  });
});

/**
 * Ключ объекта строго ASCII: Supabase проверяет его регуляркой S3-safe
 * символов, где `\w` без флага `u`. Русская буква — `InvalidKey`, и файл
 * не загружается вообще.
 */
describe('ключ вложения в Storage', () => {
  it('кириллица транслитерируется, ключ остаётся ASCII', () => {
    const key = attachmentFilePath('new', 'packaging', 'uid-1', 'Схема узла.jpg');
    expect(key).toBe('att/new/packaging/uid-1-Shema_uzla.jpg');
    expect(/^[\w./-]+$/.test(key)).toBe(true);
  });

  it('имя целиком из непереводимых символов не съедает расширение', () => {
    expect(safeFileName('!!!.png', 'file', 'bin')).toBe('file.png');
  });

  /** «../../» из имени файла не должно уехать в ключ объекта */
  it('серии точек схлопываются', () => {
    expect(attachmentFilePath('new', 'tech', 'u', '../../etc/passwd'))
      .not.toContain('..');
  });

  it('файл без расширения получает запасное', () => {
    expect(safeFileName('макет', 'file', 'bin')).toBe('maket.bin');
  });

  /**
   * `uid`, а не отметка времени: множественный выбор в диалоге даёт несколько
   * файлов в одну миллисекунду, и одинаковый ключ затёр бы первый при upsert.
   */
  it('разные файлы получают разные ключи', () => {
    const a = attachmentFilePath('new', 'tech', 'u1', 'схема.png');
    const b = attachmentFilePath('new', 'tech', 'u2', 'схема.png');
    expect(a).not.toBe(b);
  });
});
