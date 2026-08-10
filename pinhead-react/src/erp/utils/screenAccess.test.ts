import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SCREEN_ACCESS, canOpenScreen } from './screenAccess';
import { DEFAULT_PERMISSIONS } from './permissions';
import { ERP_PERMISSIONS } from '../types';
import type { EmployeeRole, ErpPermission } from '../types';

/**
 * Право, до экрана которого не дойти, — то же декоративное право, только
 * этажом выше.
 *
 * Разделы «Операции» были закрыты ролью УЧЁТНОЙ ЗАПИСИ, двумя независимыми
 * списками — в маршруте и в меню. Права, заведённые 10.08 под конкретных людей,
 * оказались недостижимы: кладовщик получил «Вести склад», но не видел пункта
 * «Склад» и не мог открыть адрес. Матрица говорила «можно», интерфейс —
 * «раздела нет».
 */

const SRC = join(process.cwd(), 'src/erp');
const APP = readFileSync(join(SRC, 'ErpApp.jsx'), 'utf8');
const SIDEBAR = readFileSync(join(SRC, 'layout/Sidebar.jsx'), 'utf8');

/** Кто получает раздел по запасным значениям прав */
function holders(path: string): EmployeeRole[] {
  const can = (role: EmployeeRole) => (p: ErpPermission) =>
    DEFAULT_PERMISSIONS[role].includes(p);
  return (Object.keys(DEFAULT_PERMISSIONS) as EmployeeRole[])
    .filter((r) => canOpenScreen(can(r), path));
}

describe('разделы «Операции» открываются правом, а не ролью учётной записи', () => {
  it.each(Object.keys(SCREEN_ACCESS))('маршрут %s гейтится через canOpen', (path) => {
    expect(APP).toContain(`canOpen('${path}')`);
  });

  it('ни один раздел «Операций» не остался на isAdmin', () => {
    for (const path of Object.keys(SCREEN_ACCESS)) {
      const route = APP.slice(APP.indexOf(`path="${path}"`), APP.indexOf(`path="${path}"`) + 160);
      expect(route, `${path} всё ещё под isAdmin`).not.toMatch(/allowed=\{isAdmin\}/);
    }
  });

  it('меню и маршруты берут ОДИН источник', () => {
    // Два независимых списка уже разъехались один раз — этим тестом и ловим
    expect(APP).toContain('canOpenScreen');
    expect(SIDEBAR).toContain('canOpenScreen');
  });

  it('пункты «Операций» больше не помечены admin', () => {
    const block = SIDEBAR.slice(SIDEBAR.indexOf("title: 'Операции'"), SIDEBAR.indexOf("title: 'Настройки'"));
    for (const path of Object.keys(SCREEN_ACCESS)) {
      expect(block).toContain(`to: '${path}'`);
    }
    /**
     * Комментарии убираются перед проверкой ОТСУТСТВИЯ: объяснение «почему
     * `admin: true` здесь больше не стоит» содержит ровно те же слова, и тест
     * ловил бы сам себя. Правило проекта, записанное для SQL, — то же и здесь.
     */
    const code = block.split('\n').filter((l) => !l.trimStart().startsWith('//')).join('\n');
    expect(code).not.toMatch(/admin: true/);
  });

  it('админка остаётся за учётной записью', () => {
    // Настройка системы — не работа по заказу, право ей не подходит
    expect(APP).toMatch(/path="\/admin"[\s\S]{0,60}allowed=\{isAdmin\}/);
  });
});

describe('каждый раздел достижим тем, ради кого заведено право', () => {
  it('кладовщик видит склад', () => {
    expect(holders('/warehouse')).toContain('storekeeper');
  });

  it('закупщик видит закупку', () => {
    expect(holders('/purchasing')).toContain('purchaser');
  });

  it('технолог видит эксперим. цех', () => {
    expect(holders('/experimental')).toContain('technologist');
  });

  it('менеджер заказа видит подряд', () => {
    expect(holders('/subcontracting')).toContain('manager');
  });

  it.each(Object.keys(SCREEN_ACCESS))('директор видит %s', (path) => {
    expect(holders(path)).toContain('director');
  });

  it.each(Object.keys(SCREEN_ACCESS))('рабочий цеха НЕ видит %s', (path) => {
    // У него нет ни одного из перечисленных прав — раздел ему не нужен
    expect(holders(path)).not.toContain('worker');
  });

  it('кадры не видят ни одного раздела «Операций»', () => {
    for (const path of Object.keys(SCREEN_ACCESS)) {
      expect(holders(path)).not.toContain('hr');
    }
  });
});

describe('список прав раздела осмыслен', () => {
  it.each(Object.entries(SCREEN_ACCESS))('%s перечисляет существующие права', (_p, perms) => {
    for (const perm of perms) {
      expect(ERP_PERMISSIONS).toContain(perm);
    }
  });

  it('незнакомый путь открыт: гейт перечисляет исключения', () => {
    // Иначе новый экран, забытый в списке, молча пропал бы у всех
    expect(canOpenScreen(() => false, '/board')).toBe(true);
  });
});
