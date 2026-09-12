import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SCREEN_ACCESS, canOpenScreen } from './screenAccess';
import { DEFAULT_PERMISSIONS } from './permissions';
import { ERP_PERMISSIONS } from '../types';
import { NAV_GROUPS } from '../layout/navGroups';
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

  /**
   * ЧИТАЕТСЯ СПИСОК, А НЕ ТЕКСТ ФАЙЛА (правка 12.09).
   *
   * Прежняя редакция вырезала из исходника `Sidebar.jsx` кусок между
   * `title: 'Операции'` и `title: 'Настройки'` и искала в нём подстроки.
   * Такой сторож сторожит ФАЙЛ: список переехал в `layout/navGroups.js`
   * (его понадобилось читать ещё и командной строке), и срез стал пустым —
   * то есть `toContain` начал падать, а `not.toMatch(/admin: true/)`
   * прошёл бы на пустоте при ЛЮБОМ содержимом меню.
   *
   * Теперь проверяются объекты. Заодно исчезла возня со снятием
   * комментариев: объяснение «почему `admin: true` здесь больше не стоит»
   * содержит те же слова и ловило сторож на себе.
   */
  it('пункты «Операций» больше не помечены admin', () => {
    const ops = NAV_GROUPS.find((g) => g.title === 'Операции');
    expect(ops, 'группы «Операции» в меню нет — проверка вырождается').toBeTruthy();

    for (const path of Object.keys(SCREEN_ACCESS)) {
      expect(ops!.items.some((i) => i.to === path), `${path} не в меню «Операций»`).toBe(true);
    }
    for (const item of ops!.items) {
      expect(item.admin, `${item.to} помечен admin`).not.toBe(true);
    }
  });

  it('меню целиком объявлено одним списком — его читают и сайдбар, и палитра', () => {
    // Список вынесен из компонента именно поэтому: копия в палитре была бы
    // третьим перечислением разделов, а два уже расходились
    expect(SIDEBAR).toContain('NAV_GROUPS');
    expect(NAV_GROUPS.length).toBeGreaterThan(2);
    expect(NAV_GROUPS.flatMap((g) => g.items).length).toBeGreaterThan(5);
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

  /**
   * ПОДСТРАНИЦА РАЗДЕЛА ЗАКРЫТА ТЕМ ЖЕ ПРАВОМ (правка 22.08).
   *
   * Карточка разработки переехала со шторки `?dev=` на страницу
   * `/experimental/<uuid>` (п. 4.11). При сравнении путей ЦЕЛИКОМ такой адрес
   * оказался бы «незнакомым», то есть открытым всем, включая цех без права
   * `experimental.manage`. Ровно этим доводом вид раздела в своё время увели
   * в query-параметр — теперь причина устранена в самом гейте.
   */
  it('страница внутри раздела требует прав раздела', () => {
    const none = () => false;
    const tech = (p: string) => p === 'experimental.manage';
    expect(canOpenScreen(none, '/experimental/8f1b0f0e-1111-2222-3333-444455556666')).toBe(false);
    expect(canOpenScreen(tech, '/experimental/8f1b0f0e-1111-2222-3333-444455556666')).toBe(true);
    // И у остальных разделов поведение не изменилось
    expect(canOpenScreen(none, '/warehouse')).toBe(false);
  });
});
