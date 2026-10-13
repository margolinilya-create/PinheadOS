import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { useListParams } from './useListParams';

/**
 * Контекст списка в адресе (правки 05.10, пп. 6 и 8): «при возврате
 * сохранять поиск, фильтры и место в списке». Проверяется сам адрес —
 * именно он переживает уход в карточку и «Назад».
 */

const DEFAULTS = { tab: 'all', open: '1' };

function setup(url = '/warehouse') {
  return renderHook(() => ({ list: useListParams(DEFAULTS), loc: useLocation() }), {
    wrapper: ({ children }) => <MemoryRouter initialEntries={[url]}>{children}</MemoryRouter>,
  });
}

describe('useListParams', () => {
  it('читает значения из адреса, а отсутствующие — умолчанием', () => {
    const { result } = setup('/warehouse?q=футер&page=3');
    expect(result.current.list.get('q')).toBe('футер');
    expect(result.current.list.get('tab')).toBe('all');
    expect(result.current.list.get('open')).toBe('1');
    expect(result.current.list.page).toBe(3);
  });

  it('мусор вместо номера страницы читается первой страницей', () => {
    const { result } = setup('/warehouse?page=abc');
    expect(result.current.list.page).toBe(1);
  });

  it('правка подбора сбрасывает страницу', () => {
    const { result } = setup('/warehouse?page=4&tab=materials');
    act(() => result.current.list.patch({ q: 'тест' }));
    const sp = new URLSearchParams(result.current.loc.search);
    expect(sp.get('q')).toBe('тест');
    expect(sp.get('tab')).toBe('materials');
    expect(sp.has('page')).toBe(false);
  });

  it('открытие карточки страницу НЕ сбрасывает — место в списке сохраняется', () => {
    const { result } = setup('/warehouse?page=4');
    act(() => result.current.list.patchKeep({ task: 't1' }));
    const sp = new URLSearchParams(result.current.loc.search);
    expect(sp.get('task')).toBe('t1');
    expect(sp.get('page')).toBe('4');
  });

  it('умолчание и пустое значение из адреса убираются', () => {
    const { result } = setup('/warehouse?tab=materials&q=x');
    act(() => result.current.list.patch({ tab: 'all', q: '' }));
    expect(result.current.loc.search).toBe('');
  });

  it('первая страница в адрес не пишется', () => {
    const { result } = setup('/warehouse?page=2');
    act(() => result.current.list.setPage(1));
    expect(result.current.loc.search).toBe('');
    act(() => result.current.list.setPage(3));
    expect(new URLSearchParams(result.current.loc.search).get('page')).toBe('3');
  });
});
