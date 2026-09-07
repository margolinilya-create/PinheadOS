import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { useErpStore } from '../store/useErpStore';
import { useAuthStore } from '../../store/useAuthStore';

/**
 * ПУНКТА «МОЙ ЦЕХ» БОЛЬШЕ НЕТ (правки 07.09, п. 18).
 *
 * Он вёл на `/queue` без кода участка и был вторым входом в тот же экран, что
 * и группа «Цеха»: свой участок в ней стоит со своим числом заданий. До 04.09
 * пункт вдобавок показывался всем и уводил в заглушку «Ваш профиль не привязан
 * к цеху»; тогда его спрятали от тех, у кого цеха нет, — теперь он снят вовсе,
 * а цеховая роль приземляется прямо в очередь своего участка (`utils/landing`).
 *
 * Сторож проверяет ОТСУТСТВИЕ: пункт, вернувшийся «за компанию» с правкой
 * меню, снова завёл бы два счёта одного цеха под разными подписями.
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
  it('пункта «Мой цех» нет', () => {
    mount();
    expect(screen.queryByRole('link', { name: /Мой цех/ })).toBeNull();
  });

  it('ни одна ссылка меню не ведёт на /queue без кода участка', () => {
    // Такого маршрута больше нет вовсе: он уходил бы на обзор общим `path="*"`,
    // то есть пункт меню молча возвращал бы человека туда, откуда он нажал
    mount();
    const dead = screen.queryAllByRole('link')
      .filter((a) => a.getAttribute('href') === '/queue');
    expect(dead).toHaveLength(0);
  });

  it('очередь участка приходит из группы «Цеха»', () => {
    mount({
      deptItems: [{ to: '/queue/cutting', label: 'Закрой', icon: 'scissors', count: 3 }],
    });
    const link = screen.getByRole('link', { name: /Закрой/ });
    expect(link).toHaveAttribute('href', '/queue/cutting');
    // Число обязано называть себя: скринридер читает только `aria-label`
    expect(screen.getByLabelText('Заданий в очереди: 3')).toBeInTheDocument();
  });

  it('обзор и заказы на месте', () => {
    mount();
    expect(screen.getByRole('link', { name: /Обзор/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Заказы/ })).toBeInTheDocument();
  });
});
