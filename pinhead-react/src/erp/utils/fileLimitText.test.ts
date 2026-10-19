import { describe, it, expect } from 'vitest';
import { batchStatusText, fileLimitCaption, tooBigText } from './fileLimitText';
import { TZ_MAX_BYTES } from '../types';

/**
 * ТЕКСТЫ ЛИМИТА ФАЙЛА (правка 19.10, пп. 3–4): «Рядом с кнопкой загрузки
 * указать „До 30 МБ на один файл“» и «показать имя и причину отказа».
 * Число мегабайт считается из аргумента — константа лимита одна на бакет.
 */
describe('fileLimitText', () => {
  it('подпись у кнопки — лимит на ОДИН файл, а не на пачку', () => {
    expect(fileLimitCaption(31457280)).toBe('До 30 МБ на один файл');
    expect(fileLimitCaption(TZ_MAX_BYTES)).toBe('До 30 МБ на один файл');
  });

  it('причина отказа большого файла называет лимит и что делать', () => {
    expect(tooBigText(TZ_MAX_BYTES))
      .toBe('не загрузилось: файл больше 30 МБ — уменьшите или разбейте PDF');
  });

  it('число следует за аргументом, а не вписано в текст', () => {
    expect(fileLimitCaption(20 * 1024 * 1024)).toBe('До 20 МБ на один файл');
    expect(tooBigText(20 * 1024 * 1024)).toContain('больше 20 МБ');
  });

  it('сводка пачки: загружено из всех, сбои — только если есть, пусто без файлов', () => {
    expect(batchStatusText(3, 5, 1)).toBe('Загружено 3 из 5 · не загрузилось 1');
    expect(batchStatusText(2, 2, 0)).toBe('Загружено 2 из 2');
    expect(batchStatusText(0, 0, 0)).toBe('');
  });
});
