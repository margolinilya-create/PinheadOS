import { describe, it, expect } from 'vitest';
import { tzFilePath } from '../../erp/utils/tz';
import { attachmentFilePath } from '../../erp/utils/storageKey';
import { isErpFileKey } from '../api/erpFiles';
import { erpAttachmentKey, erpFileName, erpScope, erpTzKey } from './erpKeys';

/**
 * Ключи копий в `erp-attachments` (К12): формат ERP без импорта ERP в рантайме.
 * Тест сверяет с `tzFilePath`/`attachmentFilePath` ERP ТОЛЬКО префикс и ASCII —
 * в остальном ключ Order свой: область — uuid попытки, у вложения нет имени.
 */
const A = '11111111-2222-4333-8444-555555555555';
const B = '66666666-7777-4888-9999-aaaaaaaaaaaa';
const ORDER_ID = '0b6c1f0e-1d2a-4c3b-8e4f-5a6b7c8d9e0f';
const ASCII = /^[\x21-\x7e]+$/;

describe('erpKeys', () => {
  it('ТЗ: префикс и форма как у tzFilePath ERP, область — попытка', () => {
    const key = erpTzKey(A, B);
    const erp = tzFilePath(erpScope(A), B, 1, 'tz.pdf');
    expect(key.split('/')[0]).toBe(erp.split('/')[0]);
    expect(key).toBe(`tz/v4-${A}/${B}/v1-tz.pdf`);
    expect(key).toBe(erp);
    expect(key).toMatch(ASCII);
    expect(isErpFileKey(key)).toBe(true);
  });

  it('вложение: префикс att/ как у attachmentFilePath ERP, ASCII, принимает писатель', () => {
    const key = erpAttachmentKey(A, 'print', B, 'png');
    const erp = attachmentFilePath(erpScope(A), 'print', B, 'Логотип.png');
    expect(key.split('/').slice(0, 3)).toEqual(erp.split('/').slice(0, 3));
    expect(key).toBe(`att/v4-${A}/print/${B}.png`);
    expect(key).toMatch(ASCII);
    expect(isErpFileKey(key)).toBe(true);
    expect(isErpFileKey(erpAttachmentKey(A, 'label', B, 'jpg'))).toBe(true);
  });

  it('в ключе нет id заказа и номера; разные попытки — разные ключи', () => {
    const keys = [erpTzKey(A, B), erpAttachmentKey(A, 'print', B, 'pdf')];
    for (const k of keys) {
      expect(k).not.toContain(ORDER_ID);
      expect(k).not.toMatch(/PH-/);
    }
    expect(erpTzKey(A, B)).not.toBe(erpTzKey(B, A));
  });

  it('не uuid, чужой вид или расширение — бросок, а не кривой ключ', () => {
    expect(() => erpTzKey(ORDER_ID.slice(0, 8), B)).toThrow();
    expect(() => erpTzKey(A, '../x')).toThrow();
    expect(() => erpAttachmentKey(A, 'note' as 'print', B, 'png')).toThrow();
    expect(() => erpAttachmentKey(A, 'print', B, 'p/ng')).toThrow();
    expect(() => erpAttachmentKey(A, 'print', B, 'ПНГ')).toThrow();
  });

  it.each([
    [['PH-1234', 'Футболка', 'нанесение 1'], 'png', 'PH-1234-Futbolka-nanesenie_1.png'],
    [['PH-1234', 'Худи «Оверсайз»'], 'pdf', 'PH-1234-Hudi_Oversayz.pdf'],
    [['..', '..', 'etc'], 'pdf', 'etc.pdf'],
    [['PH-1', 'a'.repeat(300)], 'pdf', `PH-1-${'a'.repeat(95)}.pdf`],
    [[], 'png', 'file.png'],
    [['', '  '], 'jpg', 'file.jpg'],
    [['ТЗ'], 'pdf', 'TZ.pdf'],
    [['PH-9', 'Свитшот', 'бирка 2'], 'jpg', 'PH-9-Svitshot-birka_2.jpg'],
    [['日本'], 'png', 'file.png'],
    [['PH-5', 'a/b\\c'], 'svg', 'PH-5-a_b_c.svg'],
  ])('имя для человека через asciiFileName: %j', (parts, ext, expected) => {
    const name = erpFileName(parts, ext);
    expect(name).toBe(expected);
    expect(name).toMatch(ASCII);
    expect(name).not.toContain('..');
  });
});
