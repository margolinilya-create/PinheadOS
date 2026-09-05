import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { useErpStore } from '../store/useErpStore';
import { useAuthStore } from '../../store/useAuthStore';

/**
 * «МОЙ ЦЕХ» — ТОЛЬКО ТЕМ, У КОГО ЦЕХ ЕСТЬ (обход 04.09).
 *
 * Пункт показывался всем, включая менеджера и диспетчера, и вёл в заглушку
 * «Выберите свой цех выше»: постоянный пункт меню, ведущий в тупик, читается
 * как поломка, а не как «это не для вас». Условие то же, по которому `/queue`
 * выбирает участок, — привязка сотрудника ЛИБО выбранный на экране очереди
 * цех: у того, кто участок уже выбрал, пункт работает и остаётся.
 */
function mount(props = {}) {
  useAuthStore.setState({
    user: { id: 'u', email: 'a@b.c', name: 'A', role: 'director', approved: true, active: true },
  });
  useErpStore.setState({ myRole: 'director', myDeptId: null, permissionMatrix: {} });
  return render(
    <MemoryRouter><Sidebar isAdmin {...props} /></MemoryRouter>,
  );
}

describe('меню раздела', () => {
  it('без цеха пункт «Мой цех» не показывается', () => {
    mount({ hasMyDept: false });
    expect(screen.queryByRole('link', { name: /Мой цех/ })).toBeNull();
  });

  it('с цехом — показывается', () => {
    mount({ hasMyDept: true });
    expect(screen.getByRole('link', { name: /Мой цех/ })).toBeInTheDocument();
  });

  /** Остальные пункты «Главного» от этого не зависят */
  it('обзор и заказы на месте в обоих случаях', () => {
    mount({ hasMyDept: false });
    expect(screen.getByRole('link', { name: /Обзор/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Заказы/ })).toBeInTheDocument();
  });
});
