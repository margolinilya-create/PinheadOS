import { describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

vi.mock('../../lib/supabase', () => ({
  supabase: { from: vi.fn(), rpc: vi.fn(), channel: vi.fn(), removeChannel: vi.fn() },
}));

const { DOMAIN_INITIAL_STATE } = await import('./domainState');
const { attachDomainSlices } = await import('./domainSlices');
const { useErpStore, resetErpStore } = await import('./useErpStore');
const SLICES = await import('./slices');

/**
 * Разделение стора на ядро и доменную часть.
 *
 * Оболочку ERP грузят ВСЕ и ВСЕГДА — это раздел по умолчанию. Пока
 * `useErpStore` собирался из всех шестнадцати слайсов, склад, подряд, образцы,
 * справочники и план ехали рабочему, который открывает только очередь своего
 * цеха. Здесь сторожатся три вещи, каждая из которых ломается молча:
 *   · ядро не тянет доменные слайсы обратно в оболочку;
 *   · ни одно действие не потеряно по дороге;
 *   · исходные данные в ядре совпадают с тем, что объявляют слайсы.
 */

const ERP = join(process.cwd(), 'src/erp');
const CORE = ['bootstrapSlice', 'ordersSlice', 'permissionsSlice', 'bypassSlice', 'realtimeSlice'];
const DOMAIN = [
  'stagesSlice', 'materialsSlice', 'warehouseSlice', 'procurementSlice',
  'subcontractingSlice', 'employeesSlice', 'invitesSlice', 'dictionariesSlice', 'experimentalSlice',
  'tzSlice', 'planSlice', 'settingsSlice',
];

/** Поля слайса, выполнив его фабрику «вхолостую» */
function fieldsOf(name: string): Record<string, unknown> {
  const factory = (SLICES as unknown as Record<string, unknown>)[name] as (
    s: unknown, g: unknown, a: unknown,
  ) => Record<string, unknown>;
  return factory(() => {}, () => ({}), {});
}

const dataOf = (name: string) => Object.fromEntries(
  Object.entries(fieldsOf(name)).filter(([, v]) => typeof v !== 'function'),
);
const actionsOf = (name: string) => Object.keys(fieldsOf(name))
  .filter((k) => typeof fieldsOf(name)[k] === 'function');

describe('состав ядра и доменной части', () => {
  it('перечислены все слайсы — новый обязан попасть в один из списков', () => {
    const known = [...CORE, ...DOMAIN].sort();
    expect(Object.keys(SLICES).sort()).toEqual(known);
  });

  it('ядро не импортирует доменные слайсы статически', () => {
    // Одна такая строка возвращает слайс в оболочку, и бюджет скажет
    // «стало больше», но не скажет, из-за чего
    const src = readFileSync(join(ERP, 'store/useErpStore.ts'), 'utf8');
    for (const name of DOMAIN) {
      expect(src, `${name} вернулся в ядро`).not.toContain(`slices/${name}`);
    }
  });

  it('ядро не тянет баррель слайсов — он тащит все шестнадцать', () => {
    const src = readFileSync(join(ERP, 'store/useErpStore.ts'), 'utf8');
    expect(src).not.toMatch(/from '\.\/slices'/);
  });
});

describe('данные доменных слайсов стоят в ядре', () => {
  it.each(DOMAIN)('%s: объявленные данные совпадают с DOMAIN_INITIAL_STATE', (name) => {
    const data = dataOf(name);
    for (const [key, value] of Object.entries(data)) {
      expect(DOMAIN_INITIAL_STATE, `${name}.${key} нет в ядре`).toHaveProperty(key);
      expect(
        (DOMAIN_INITIAL_STATE as Record<string, unknown>)[key],
        `${name}.${key} разошлось с ядром`,
      ).toEqual(value);
    }
  });

  it('в ядре нет лишних доменных полей', () => {
    const declared = new Set(DOMAIN.flatMap((n) => Object.keys(dataOf(n))));
    for (const key of Object.keys(DOMAIN_INITIAL_STATE)) {
      expect(declared.has(key), `${key} не объявлен ни одним слайсом`).toBe(true);
    }
  });

  it('данные доступны ДО подключения слайсов', () => {
    // `loadBootstrap` наполняет subcontracting/experimental/dictionaries ещё
    // до открытия экрана, а `useErpAccess` читает myDeptId в самой оболочке
    for (const key of ['subcontracting', 'experimental', 'dictionaries', 'myDeptId', 'capacity']) {
      expect(useErpStore.getState()).toHaveProperty(key);
    }
  });
});

describe('подключение доменных действий', () => {
  it('после attach в сторе есть все действия всех слайсов', () => {
    attachDomainSlices();
    const state = useErpStore.getState() as unknown as Record<string, unknown>;
    for (const name of DOMAIN) {
      for (const action of actionsOf(name)) {
        expect(typeof state[action], `${name}.${action} не подключено`).toBe('function');
      }
    }
  });

  it('attach переносит ТОЛЬКО функции — иначе затёр бы загруженное', () => {
    attachDomainSlices();
    // Наполняем как это делает loadBootstrap, потом «подключаем» повторно
    useErpStore.setState({ subcontracting: [{ id: 'x' }] } as never);
    attachDomainSlices();
    expect(useErpStore.getState().subcontracting).toHaveLength(1);
  });

  it('сброс стора чистит и доменные данные', () => {
    // Иначе на общем планшете следующая смена увидит чужой подряд
    attachDomainSlices();
    useErpStore.setState({
      subcontracting: [{ id: 'x' }], experimental: [{ id: 'y' }], myDeptId: 'd1',
    } as never);
    resetErpStore();
    expect(useErpStore.getState().subcontracting).toEqual([]);
    expect(useErpStore.getState().experimental).toEqual([]);
    expect(useErpStore.getState().myDeptId).toBeNull();
  });

  it('действия переживают сброс: setState со слиянием', () => {
    attachDomainSlices();
    resetErpStore();
    const state = useErpStore.getState() as unknown as Record<string, unknown>;
    expect(typeof state.loadPlan).toBe('function');
    expect(typeof state.setStageStatus).toBe('function');
  });
});

describe('ленивый ERP-экран заводится только lazyScreen', () => {
  /**
   * Правило сформулировано ПО ЭКРАНАМ, а не по файлу-оболочке, и это важно.
   *
   * Первая версия сторожа обходила статический граф `ErpApp` — и пропустила
   * настоящую поломку: единая админка ERP смонтирована ЕЩЁ И в Order Studio
   * (`OrderStudioApp`), голым `lazy`, мимо всякого `ErpApp`. На `/admin`
   * в том разделе экран получал стор без половины действий и падал с
   * «loadEmployees is not a function». Сторож, привязанный к одной точке
   * входа, сторожит одну точку входа.
   */
  const SRC = join(process.cwd(), 'src');

  function allSources(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const abs = join(dir, name);
      if (statSync(abs).isDirectory()) { allSources(abs, out); continue; }
      if (!/\.(jsx?|tsx?)$/.test(name) || name.includes('.test.')) continue;
      out.push(abs);
    }
    return out;
  }

  /** Строки, где динамически импортируется экран ERP */
  function screenImportLines(): { file: string; line: string }[] {
    const hits: { file: string; line: string }[] = [];
    for (const file of allSources(SRC)) {
      const inErp = relative(SRC, file).startsWith('erp/');
      for (const line of readFileSync(file, 'utf8').split('\n')) {
        const m = line.match(/import\(\s*'([^']+)'\s*\)/);
        if (!m) continue;
        const path = m[1];
        const isScreen = path.includes('erp/screens/') || (inErp && path.includes('./screens/'));
        if (isScreen) hits.push({ file: relative(SRC, file), line });
      }
    }
    return hits;
  }

  const HITS = screenImportLines();

  it('экраны найдены — иначе сторож проверяет пустоту', () => {
    expect(HITS.length).toBeGreaterThan(10);
    expect(HITS.map((h) => h.file)).toContain('orderstudio/OrderStudioApp.jsx');
  });

  it('каждый такой импорт обёрнут lazyScreen', () => {
    const bad = HITS.filter(({ line }) => {
      // Предзагрузка в простое — не отрисовка, обёртка ей не нужна
      if (/^\s*\(\)\s*=>\s*import\(/.test(line)) return false;
      return !line.includes('lazyScreen(');
    }).map(({ file, line }) => `${file}: ${line.trim()}`);
    expect(bad, `экран ERP без lazyScreen:\n${bad.join('\n')}`).toEqual([]);
  });

  it('карточка заказа тоже: её хост смонтирован вне <Routes>', () => {
    const src = readFileSync(join(ERP, 'screens/orderCard/OrderDrawerHost.jsx'), 'utf8');
    expect(src).toContain('lazyScreen(');
  });

  it('доменный чанк греется в простое вместе с соседними экранами', () => {
    const src = readFileSync(join(ERP, 'ErpApp.jsx'), 'utf8');
    expect(src).toContain('ensureDomainSlices');
  });
});

/**
 * Выбор оболочки не зависит от переходов роутера.
 *
 * ЧТО СЛУЧИЛОСЬ. Экран приглашения `/join` выбирается по адресу, и путь взяли
 * из `useLocation()` — самое очевидное решение. Оно подписало `App` на КАЖДЫЙ
 * переход, а `App` на каждом рендере читает `FEATURES.orderStudio` — геттер,
 * который берёт `?studio=` из адреса. Внутренние ссылки параметр не несут,
 * поэтому первый же переход внутри производства открывал Order Studio: адрес
 * менялся правильно, а на экране оказывался чужой раздел. Восемь сценариев
 * e2e сразу — навигация, очередь, план, вкладки, мобильное меню.
 *
 * Сторож проверяет СПОСОБ, а не результат: юнит-тесты рендерят `App` через
 * `createMemoryRouter` и подписки не замечают вовсе, а e2e ловит это только
 * через четыре минуты прогона.
 */
describe('оболочка выбирается без подписки на роутер', () => {
  it('App не использует useLocation', () => {
    const src = readFileSync(join(process.cwd(), 'src/App.jsx'), 'utf8');
    // Комментарии снимаем: объяснение «почему подписки нет» содержит те же
    // слова, что и сама подписка, и утверждение «этого здесь нет» ловило бы его
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code, 'App снова подписан на переходы — режим будет пересчитываться')
      .not.toMatch(/useLocation\s*\(/);
  });
});
