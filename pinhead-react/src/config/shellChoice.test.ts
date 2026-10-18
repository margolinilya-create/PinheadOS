import { describe, it, expect } from 'vitest';
import { chooseShell, isOrderOnlyPath, shellEnv, type ShellInput } from './shellChoice';

const live = { active: true, approved: true };
const SELLER = { id: 's', role: 'manager', is_sales: true, ...live };
const MS = { id: 'm', role: 'manager', is_ms: true, ...live };
const ROP = { id: 'r', role: 'rop', ...live };
const ADMIN = { id: 'a', role: 'admin', ...live };
const DIRECTOR = { id: 'd', role: 'director', ...live };
const DESIGNER = { id: 'g', role: 'designer', ...live };
const MANAGER = { id: 'n', role: 'manager', is_sales: false, ...live };

const base: ShellInput = { search: '', path: '/', stored: null, env: undefined, profile: null };
const pick = (over: Partial<ShellInput>) => chooseShell({ ...base, ...over });

describe('shellEnv — тройка VITE_FEATURE_ORDER_STUDIO', () => {
  it.each([
    ['0', 'off'], ['false', 'off'], ['1', 'on'], ['true', 'on'],
    ['', 'profile'], [undefined, 'profile'], [null, 'profile'], ['yes', 'profile'],
  ])('%s → %s', (raw, mode) => {
    expect(shellEnv(raw as string | undefined)).toBe(mode);
  });
});

describe('isOrderOnlyPath', () => {
  it.each([
    ['/sales', true], ['/sales/x', true], ['/sales-staff', true], ['/order-settings', true],
    ['/express', true], ['/sku', true], ['/prices', true],
    ['/', false], ['/admin', false], ['/orders', false], ['/salesman', false], ['/board', false],
  ])('%s → %s', (path, yes) => {
    expect(isOrderOnlyPath(path)).toBe(yes);
  });
});

describe('chooseShell — порядок правил (К1)', () => {
  // 1. Выключатель
  it('выключатель «0» бьёт ?studio=1, путь /sales/x и продавца', () => {
    expect(pick({ env: '0', search: '?studio=1', path: '/sales/x', profile: SELLER, stored: '1' })).toBe('erp');
  });
  it('выключатель «false» тоже гасит раздел', () => {
    expect(pick({ env: 'false', path: '/sales', profile: ADMIN })).toBe('erp');
  });

  // 2. Адрес на один заход
  it('?studio=0 у продавца на /sales/x — «Производство» на этот заход', () => {
    expect(pick({ search: '?studio=0', path: '/sales/x', profile: SELLER })).toBe('erp');
  });
  it('?studio=1 у дизайнера — раздел (дальше его уводит LeaveToProduction)', () => {
    expect(pick({ search: '?studio=1', path: '/sales', profile: DESIGNER })).toBe('order');
  });
  it('?studio=1 бьёт записанный «0»', () => {
    expect(pick({ search: '?studio=1', stored: '0', profile: ADMIN })).toBe('order');
  });

  // 3. Путь раздела
  it('продавец на /sales/x с записанным «0» — раздел', () => {
    expect(pick({ path: '/sales/x', stored: '0', profile: SELLER })).toBe('order');
  });
  it('admin с записанным «0» на /sku — раздел (путь только раздела)', () => {
    expect(pick({ path: '/sku', stored: '0', profile: ADMIN })).toBe('order');
  });
  it('дизайнер на /sales без флагов — «Производство»: путь без доступа не работает', () => {
    expect(pick({ path: '/sales', profile: DESIGNER })).toBe('erp');
  });

  // 4. Выбор устройства
  it('дизайнер с «1» — раздел; после записи «0» LeaveToProduction — «Производство», петли нет', () => {
    expect(pick({ stored: '1', profile: DESIGNER })).toBe('order');
    expect(pick({ stored: '0', profile: DESIGNER })).toBe('erp');
  });
  it('admin с «1» — раздел, с «0» — «Производство» даже при env «1»', () => {
    expect(pick({ stored: '1', profile: ADMIN })).toBe('order');
    expect(pick({ stored: '0', profile: ADMIN, env: '1' })).toBe('erp');
  });
  it('продавец на / с «0», записанным не им, — раздел: «0» его не запирает', () => {
    expect(pick({ path: '/', stored: '0', profile: SELLER })).toBe('order');
  });

  // 5. Умолчание профиля
  it.each([
    ['продавец', SELLER], ['МС', MS], ['rop', ROP],
  ])('%s на / — раздел', (_n, profile) => {
    expect(pick({ profile })).toBe('order');
  });
  it.each([
    ['admin', ADMIN], ['director', DIRECTOR], ['дизайнер', DESIGNER], ['менеджер без признака', MANAGER],
  ])('%s без флагов — «Производство»', (_n, profile) => {
    expect(pick({ profile })).toBe('erp');
  });
  it('неактивный продавец — «Производство»', () => {
    expect(pick({ profile: { ...SELLER, active: false } })).toBe('erp');
  });

  // 6. Dev/e2e
  it('admin с env «1» — раздел', () => {
    expect(pick({ profile: ADMIN, env: '1' })).toBe('order');
    expect(pick({ profile: ADMIN, env: 'true' })).toBe('order');
  });

  // 7. Остальное
  it('без профиля и флагов — «Производство»', () => {
    expect(pick({})).toBe('erp');
  });

  it('решение принимается на входные данные: admin пришёл по /sales, потом /admin — ShellGate не пересчитывает', () => {
    // Сам ShellGate держит первое решение (App.test.jsx); здесь — что второй вызов дал бы другое
    expect(pick({ path: '/sales', profile: ADMIN })).toBe('order');
    expect(pick({ path: '/admin', profile: ADMIN })).toBe('erp');
  });
});
