import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createElement as h } from 'react';
import { render, act } from '@testing-library/react';
import { useListScroll } from './useListScroll';

/**
 * ВОЗВРАТ К СПИСКУ СОХРАНЯЕТ ПОЛОЖЕНИЕ ПРОКРУТКИ (правки 19.10, п. 7).
 *
 * Прокручивается не окно, а `main#main-content` оболочки ERP: позиция
 * записывается в sessionStorage по ключу и возвращается при новом монтировании.
 */

function List({ name, ready = true }) {
  useListScroll(name, ready);
  return h('div', null, 'список');
}

let main;

beforeEach(() => {
  sessionStorage.clear();
  document.body.replaceChildren();
  main = document.createElement('main');
  main.id = 'main-content';
  document.body.appendChild(main);
});

describe('useListScroll', () => {
  it('возвращает позицию после размонтирования', () => {
    const first = render(h(List, { name: 'biz-tasks' }), { container: main.appendChild(document.createElement('div')) });
    main.scrollTop = 640;
    act(() => { main.dispatchEvent(new Event('scroll')); });
    first.unmount();

    main.scrollTop = 0;
    render(h(List, { name: 'biz-tasks' }), { container: main.appendChild(document.createElement('div')) });
    expect(main.scrollTop).toBe(640);
  });

  it('ждёт готовности списка: пустой экран не прокручивается', () => {
    sessionStorage.setItem('erp:list-scroll:biz-tasks', '300');
    const view = render(h(List, { name: 'biz-tasks', ready: false }), { container: main.appendChild(document.createElement('div')) });
    expect(main.scrollTop).toBe(0);
    view.rerender(h(List, { name: 'biz-tasks', ready: true }));
    expect(main.scrollTop).toBe(300);
  });

  it('другой ключ — своя позиция', () => {
    sessionStorage.setItem('erp:list-scroll:a', '120');
    render(h(List, { name: 'b' }), { container: main.appendChild(document.createElement('div')) });
    expect(main.scrollTop).toBe(0);
  });

  it('хранилище недоступно — без падения', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    const view = render(h(List, { name: 'x' }), { container: main.appendChild(document.createElement('div')) });
    act(() => { main.dispatchEvent(new Event('scroll')); });
    expect(() => view.unmount()).not.toThrow();
    spy.mockRestore();
    set.mockRestore();
  });
});
