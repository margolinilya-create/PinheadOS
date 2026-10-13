import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';

/**
 * Сторож виджета визуальной обратной связи (agentation.com).
 *
 * ЧТО ЛОВИТСЯ. Виджет с 03.09 работает и в проде (решение владельца), но
 * не для всех и не так же, как в dev, — а разница здесь ровно та, что стоит
 * денег и трафика:
 *  · в проде его видят только admin/director. Рабочий цеха аннотаций
 *    не пишет, но за чанк платил бы трафиком на планшете по цеховому Wi-Fi;
 *  · в проде адрес MCP-сервера НЕ передаётся: сервер локальный и с боевой
 *    страницы недостижим, а переданный адрес дал бы каждому админу висящий
 *    опрос мёртвого хоста, ошибки в консоли и поток CSP-репортов;
 *  · в dev — всем и с адресом: там за экраном разработчик.
 * Ни одно из трёх не роняет ни сборку, ни функциональный тест — они просто
 * тихо меняют то, что скачивает и видит чужой человек. Значит, машина.
 *
 * Ещё две проверки живут в других местах, и это не разбросанность:
 *  · ЕДИНСТВЕННОСТЬ точки монтирования — `DevAnnotations.sources.test.ts`
 *    (обход исходников требует node-глобалей, а в `.jsx` их ловит ESLint);
 *  · виджет остаётся ЛЕНИВЫМ чанком — `scripts/bundle-budget.mjs`: здесь
 *    `import.meta.env` подставляет Vitest, и о том, что сделал Rollup,
 *    отсюда судить нельзя.
 */

const { widgetProps, loads } = vi.hoisted(() => ({
  widgetProps: { current: null },
  loads: { current: 0 },
}));

vi.mock('agentation', () => {
  // Фабрика мока выполняется на КАЖДЫЙ импорт пакета (после `resetModules`),
  // поэтому счётчик отвечает на главный вопрос: грузился ли виджет вообще
  loads.current += 1;
  return {
    Agentation: (props) => {
      widgetProps.current = props;
      return <div data-testid="agentation-widget" />;
    },
  };
});

/**
 * Модуль читает окружение НА УРОВНЕ МОДУЛЯ — значит импорт после подмены.
 * Стор берём из того же свежего реестра, иначе `setState` уйдёт в другой
 * инстанс, и компонент прочитает пустого пользователя.
 */
async function mount(role) {
  vi.resetModules();
  const { useAuthStore } = await import('../../store/useAuthStore');
  if (role) useAuthStore.setState({ user: { id: 'u1', role } });
  const { default: DevAnnotations } = await import('./DevAnnotations');
  return render(<DevAnnotations />);
}

/**
 * Ленивому импорту дают РАЗРЕШИТЬСЯ, и без этого проверки «ничего не рисует»
 * не существует: сразу после `render` контейнер пуст всегда — это `fallback`
 * у `Suspense`, а не отсутствие виджета. Первая редакция сторожа этого
 * не делала и оставалась ЗЕЛЁНОЙ на снятом гейте `import.meta.env.DEV`,
 * то есть сторожила ровно ничего — поймано мутационным прогоном.
 */
async function settle() {
  await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 0); }); });
}

beforeEach(() => {
  widgetProps.current = null;
  loads.current = 0;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('DevAnnotations — виджет обратной связи', () => {
  it('выключается VITE_AGENTATION=0 — этим e2e убирает тулбар из эталонов', async () => {
    vi.stubEnv('VITE_AGENTATION', '0');
    const { container } = await mount('admin');
    await settle();
    expect(loads.current).toBe(0);
    expect(container).toBeEmptyDOMElement();
  });

  it('в dev рисуется любой роли и получает адрес MCP-сервера', async () => {
    vi.stubEnv('DEV', true);
    // Роль цеха: в dev за экраном разработчик, и подменённая роль
    // не должна отбирать у него инструмент
    await mount('production');
    await screen.findByTestId('agentation-widget');
    expect(widgetProps.current?.endpoint).toBe('http://localhost:4747');
  });

  it('в проде виден admin/director — но БЕЗ адреса: сервер локальный', async () => {
    vi.stubEnv('DEV', false);
    await mount('admin');
    await screen.findByTestId('agentation-widget');
    // Переданный адрес на боевой странице — это висящий опрос недостижимого
    // хоста, ошибки в консоли и CSP-репорты у каждого админа
    expect(widgetProps.current?.endpoint).toBeUndefined();
  });

  it('в проде рабочему цеха не показывается и не грузится', async () => {
    vi.stubEnv('DEV', false);
    const { container } = await mount('production');
    await settle();
    expect(loads.current, 'цеховой планшет не должен платить за чанк').toBe(0);
    expect(container).toBeEmptyDOMElement();
  });

  it('в проде без пользователя (экран входа) не показывается', async () => {
    vi.stubEnv('DEV', false);
    const { container } = await mount(null);
    await settle();
    expect(loads.current).toBe(0);
    expect(container).toBeEmptyDOMElement();
  });

  it('адрес переопределяется VITE_AGENTATION_ENDPOINT — в том числе в проде', async () => {
    vi.stubEnv('DEV', false);
    vi.stubEnv('VITE_AGENTATION_ENDPOINT', 'https://agentation.example');
    await mount('director');
    await screen.findByTestId('agentation-widget');
    expect(widgetProps.current?.endpoint).toBe('https://agentation.example');
  });
});
