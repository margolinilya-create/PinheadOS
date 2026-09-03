import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';

/**
 * Сторож виджета визуальной обратной связи (agentation.com).
 *
 * ЧТО ЛОВИТСЯ. Ровно тот дефект, ради устранения которого виджет сюда
 * и переехал: до правки он висел в `OrderStudioApp` без единой проверки
 * режима сборки, пакет стоял в `dependencies`, и 42 кБ gzip инструмента
 * разработки уезжали в прод (аудит 29.07, раздел D5). Возврат этого
 * состояния не роняет ни сборку, ни один функциональный тест — он просто
 * добавляет вес тем, у кого его быть не должно, а увидеть это глазами
 * нельзя. Значит, проверять обязана машина.
 *
 * Три разные вещи, и ни одна не покрывает остальные:
 *  · ПОВЕДЕНИЕ — в прод-режиме компонент не рисует ничего;
 *  · ПОЛНОТА — виджету передан адрес MCP-сервера (без него замечание
 *    доходит только до буфера обмена, то есть интеграции нет, а выглядит
 *    она сделанной);
 * Ещё две проверки живут в других местах, и это не разбросанность:
 *  · ЕДИНСТВЕННОСТЬ точки монтирования — `DevAnnotations.sources.test.ts`
 *    (обход исходников требует node-глобалей, а в `.jsx` их ловит ESLint);
 *  · отсутствие чанка в САМОЙ СБОРКЕ — `scripts/bundle-budget.mjs`: здесь
 *    `import.meta.env` подставляет Vitest, и о том, что выбросил Rollup,
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

/** Модуль читает окружение НА УРОВНЕ МОДУЛЯ — значит импорт после подмены */
async function mount() {
  vi.resetModules();
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

describe('DevAnnotations — виджет визуальной обратной связи', () => {
  it('в прод-сборке не рисует ничего и даже не грузит пакет', async () => {
    vi.stubEnv('DEV', false);
    const { container } = await mount();
    await settle();
    expect(loads.current, 'чанк виджета вообще не должен запрашиваться').toBe(0);
    expect(container).toBeEmptyDOMElement();
  });

  it('выключается VITE_AGENTATION=0 — этим e2e убирает тулбар из эталонов', async () => {
    vi.stubEnv('DEV', true);
    vi.stubEnv('VITE_AGENTATION', '0');
    const { container } = await mount();
    await settle();
    expect(loads.current).toBe(0);
    expect(container).toBeEmptyDOMElement();
  });

  it('в dev рисуется и получает адрес MCP-сервера', async () => {
    vi.stubEnv('DEV', true);
    vi.stubEnv('VITE_AGENTATION', '');
    await mount();
    await screen.findByTestId('agentation-widget');
    // Без `endpoint` замечание уезжает только в буфер обмена, и MCP-сервер
    // (`.mcp.json` → agentation-mcp server) не увидит его никогда
    expect(widgetProps.current?.endpoint).toBe('http://localhost:4747');
  });

  it('адрес переопределяется VITE_AGENTATION_ENDPOINT (сервер на другом порту)', async () => {
    vi.stubEnv('DEV', true);
    vi.stubEnv('VITE_AGENTATION_ENDPOINT', 'http://localhost:8080');
    await mount();
    await screen.findByTestId('agentation-widget');
    expect(widgetProps.current?.endpoint).toBe('http://localhost:8080');
  });
});
