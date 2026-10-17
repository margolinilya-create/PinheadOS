import { describe, it, expect } from 'vitest';
import { asciiFileName, translitAscii } from './asciiFileName';
// Сверка с правилом ERP: копия правила обязана совпадать с оригиналом,
// иначе ключи файлов Order и ERP разъедутся (ERP заморожен — модуль не переносится)
import { safeFileName as erpSafeFileName } from '../erp/utils/storageKey';

const ASCII_SEGMENT = /^[A-Za-z0-9._-]+$/;

const CORPUS = [
  'Логотип клиента.png',
  'ТЗ Швейка (финал).pdf',
  'my logo 🎉.svg',
  '../../etc/passwd',
  '..\\..\\x.ai',
  'архив.tar.gz',
  '🎉🎉.png',
  '',
  '.hidden',
  'a....b...c.jpeg',
  'файл без расширения',
  'Ёлка-Щука_Юла.EPS',
  'x'.repeat(300) + '.pdf',
  'имя.оченьдлинноерасширение',
];

describe('asciiFileName', () => {
  it('кириллица транслитерируется с сохранением регистра', () => {
    expect(translitAscii('ТЗ Швейка')).toBe('TZ Shveyka');
    expect(asciiFileName('Логотип клиента.png', 'file', 'bin')).toBe('Logotip_klienta.png');
  });

  it('результат — один ASCII-сегмент без «..» для любого имени', () => {
    for (const name of CORPUS) {
      const out = asciiFileName(name, 'file', 'bin');
      expect(out, name).toMatch(ASCII_SEGMENT);
      expect(out, name).not.toContain('..');
      expect(out, name).not.toContain('/');
    }
  });

  it('пустое и непереводимое имя — запасное имя и расширение', () => {
    expect(asciiFileName('', 'file', 'bin')).toBe('file.bin');
    expect(asciiFileName('🎉🎉.png', 'file', 'bin')).toBe('file.png');
  });

  it('совпадает с правилом ERP (utils/storageKey.safeFileName) на всём корпусе', () => {
    for (const name of CORPUS) {
      expect(asciiFileName(name, 'file', 'bin'), name).toBe(erpSafeFileName(name, 'file', 'bin'));
    }
  });
});
