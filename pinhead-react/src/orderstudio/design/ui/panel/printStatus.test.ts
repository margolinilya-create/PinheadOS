import { describe, it, expect } from 'vitest';
import { printStatus, PRINT_STATUS_TEXT } from './printStatus';
import { MSG_MODEL_MISMATCH } from '../../export/preflight';

describe('printStatus — статус нанесения по проверке макета (веха 5в, Э2)', () => {
  it('серьёзное у нанесения — «Исправить», предупреждение — «Проверить», подсказка и пусто — «Готово»', () => {
    const issues = [
      { level: 'serious' as const, printKey: 'a', message: 'x' },
      { level: 'warn' as const, printKey: 'b', message: 'y' },
      { level: 'info' as const, printKey: 'c', message: 'z' },
    ];
    expect(printStatus(issues, 'a')).toBe('fix');
    expect(printStatus(issues, 'b')).toBe('check');
    expect(printStatus(issues, 'c')).toBe('ok');
    expect(printStatus(issues, 'd')).toBe('ok');
  });
  it('общее серьёзное без нанесения (силуэт другой модели) — «Исправить» у всех', () => {
    expect(printStatus([{ level: 'serious', message: MSG_MODEL_MISMATCH }], 'a')).toBe('fix');
  });
  it('подписи — текстом, знак отдельно', () => {
    expect(PRINT_STATUS_TEXT).toEqual({
      ok: { sign: '✓', text: 'Готово' },
      check: { sign: '!', text: 'Проверить' },
      fix: { sign: '✕', text: 'Исправить' },
    });
  });
});
