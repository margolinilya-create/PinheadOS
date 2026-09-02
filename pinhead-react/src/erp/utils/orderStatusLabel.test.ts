import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ORDER_STATUS_LABELS, orderStatusLabel } from '../types';

/**
 * Сторож окна выкладки: статус, которого бандл ещё не знает, не рисуется пустотой.
 *
 * ОТКУДА ПРАВИЛО. 02.09.2026 миграция завела статус `done` и перевела в него
 * шесть заказов на проде — а фронтенд с подписью уехал позже. Работавший бандл
 * читал `ORDER_STATUS_LABELS['done']`, получал `undefined` и рисовал ПУСТУЮ
 * ячейку статуса в четырёх местах: строка списка, карточка планшета, чип
 * карточки заказа и значение сортировки.
 *
 * Тайпчек такого не ловит по построению: таблица объявлена как
 * `Record<ErpOrderStatus, string>` и пропуск ключа не даёт собраться — но
 * проверяет он СБОРКУ, а дыра открывается между базой и уже выложенным бандлом.
 * Правило проекта «новое значение перечисления заводится во всех местах разом»
 * тоже про код; окно между кодом и базой закрывает только фолбэк.
 */

describe('orderStatusLabel', () => {
  it('известный статус получает свою подпись', () => {
    expect(orderStatusLabel('active')).toBe(ORDER_STATUS_LABELS.active);
    expect(orderStatusLabel('done')).toBe('Сдан');
  });

  it('НЕИЗВЕСТНЫЙ статус отдаётся сырым, а не пустотой', () => {
    // Ровно случай `done` до выкладки подписи: значение из базы, которого
    // в таблице этого бандла нет
    expect(orderStatusLabel('done_someday')).toBe('done_someday');
  });

  it('сырое значение, а не прочерк', () => {
    // «—» неотличимо от «статуса нет вовсе»; сырое значение человек прочитает
    expect(orderStatusLabel('unknown_value')).not.toBe('—');
    expect(orderStatusLabel('unknown_value')).not.toBe('');
  });

  it('пустой статус остаётся пустым', () => {
    expect(orderStatusLabel(null)).toBe('');
    expect(orderStatusLabel(undefined)).toBe('');
    expect(orderStatusLabel('')).toBe('');
  });
});

describe('экраны не читают таблицу подписей напрямую', () => {
  /**
   * Фолбэк бесполезен, если рядом останется прямое обращение к таблице:
   * следующий статус снова нарисуется пустотой в том месте, которое забыли.
   *
   * Исключения названы поимённо, а не «кроме админки»: `DictionariesTab`
   * показывает саму таблицу целиком как справочник — ему нужна карта, а не
   * поиск по ключу.
   */
  const SCREENS = join(process.cwd(), 'src/erp/screens');
  const ALLOWED = new Set(['DictionariesTab.jsx']);

  function walk(dir: string): string[] {
    const out: string[] = [];
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) out.push(...walk(p));
      else if (/\.(jsx?|tsx?)$/.test(e.name) && !e.name.includes('.test.')) out.push(p);
    }
    return out;
  }

  it('обращений вида ORDER_STATUS_LABELS[…] в экранах не осталось', () => {
    const offenders: string[] = [];
    for (const file of walk(SCREENS)) {
      const name = file.split('/').pop() as string;
      if (ALLOWED.has(name)) continue;
      const src = readFileSync(file, 'utf8');
      if (/ORDER_STATUS_LABELS\s*\[/.test(src)) offenders.push(name);
    }
    expect(
      offenders,
      'Прямое чтение таблицы подписей мимо orderStatusLabel: статус, которого '
      + 'бандл ещё не знает, нарисуется здесь пустотой',
    ).toEqual([]);
  });
});
