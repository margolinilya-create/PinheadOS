import { describe, it, expect } from 'vitest';
import { isSafeHttpUrl } from './safeUrl';

describe('isSafeHttpUrl', () => {
  it('http и https — да, регистр схемы не важен', () => {
    expect(isSafeHttpUrl('https://ykk.example.ru/catalog/5')).toBe(true);
    expect(isSafeHttpUrl('http://x.ru')).toBe(true);
    expect(isSafeHttpUrl('HTTPS://x.ru')).toBe(true);
  });

  it('другие схемы — нет', () => {
    expect(isSafeHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeHttpUrl('JavaScript:alert(1)')).toBe(false);
    expect(isSafeHttpUrl('data:text/html,<b>x</b>')).toBe(false);
    expect(isSafeHttpUrl('file:///etc/passwd')).toBe(false);
    expect(isSafeHttpUrl('ftp://x.ru')).toBe(false);
  });

  it('пробелы, управляющие и невидимые знаки — нет', () => {
    expect(isSafeHttpUrl(' https://x')).toBe(false);
    expect(isSafeHttpUrl('https://x.ru/a b')).toBe(false);
    expect(isSafeHttpUrl('https://x.ru/\n')).toBe(false);
    expect(isSafeHttpUrl('https://x.ru/\u0007')).toBe(false);
    expect(isSafeHttpUrl('https://x\u200b.ru')).toBe(false);
  });

  it('не адрес или пусто — нет', () => {
    expect(isSafeHttpUrl('')).toBe(false);
    expect(isSafeHttpUrl('ykk.ru')).toBe(false);
    expect(isSafeHttpUrl('https://')).toBe(false);
  });
});
