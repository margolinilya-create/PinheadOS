import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useRoleLanding } from './useRoleLanding';
import { useErpStore } from '../store/useErpStore';
import { useAuthStore } from '../../store/useAuthStore';

/**
 * СВЯЗКА посадочной: правило (`utils/landing`) покрыто своими тестами, здесь —
 * то, что между ним и адресной строкой.
 *
 * ПОЧЕМУ НЕ E2E. В прогоне работает dev-автологин под `admin`, а
 * `resolveErpRole` профиль администратора приводит к `director` — цеховой роли
 * там не бывает по построению, и спека, написанная под рабочего, проверяла бы
 * не тот путь. Половину, достижимую под админом (обзор не подменяется, прямая
 * ссылка сильнее посадочной), сторожит `e2e/erp-landing.spec.ts`.
 */

function Probe() {
  const { pathname } = useLocation();
  return <div data-testid="path">{pathname}</div>;
}

function Harness({ canOpen = () => true, withHomeLink = false }) {
  useRoleLanding(canOpen);
  const navigate = useNavigate();
  return (
    <>
      <Probe />
      {withHomeLink && <button type="button" onClick={() => navigate('/')}>Обзор</button>}
    </>
  );
}

function mount(initial = '/', props = {}) {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <Routes>
        <Route path="*" element={<Harness {...props} />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Роль сотрудника с сервера + роль профиля, из которых резолвится доступ */
function setRole(employeeRole, profileRole = 'manager') {
  useErpStore.setState({
    myRole: employeeRole,
    myDeptId: 'dep-cutting',
    // Очередь адресуется УЧАСТКОМ (правки 07.09, п. 18) — код берётся
    // из справочника по привязке, поэтому справочник обязан быть в сторе
    departments: [{ id: 'dep-cutting', code: 'cutting', name: 'Закройный цех' }],
  });
  useAuthStore.setState({
    user: { id: 'u1', email: 'u@p.ru', name: 'U', role: profileRole, approved: true, active: true },
  });
}

const path = () => screen.getByTestId('path').textContent;

describe('посадочная по роли: связка правила с адресом', () => {
  beforeEach(() => {
    useErpStore.setState({
      myRole: null, myDeptId: null, permissionMatrix: {}, departments: [],
    });
    localStorage.clear();
    useAuthStore.setState({ user: null });
  });

  it('рабочего цеха уводит с обзора в очередь ЕГО участка', async () => {
    setRole('worker');
    mount('/');
    await waitFor(() => expect(path()).toBe('/queue/cutting'));
  });

  /**
   * Участка нет ни в привязке, ни в памяти устройства — вести некуда.
   * `/queue/undefined` был бы страницей несуществующего цеха, а `/queue`
   * без кода больше не маршрут вовсе: человек остаётся на обзоре, где
   * `DeptBindingNotice` и объясняет, что заведение не закончено.
   */
  it('цеховая роль без участка остаётся на обзоре', async () => {
    setRole('worker');
    useErpStore.setState({ myDeptId: null });
    mount('/');
    await new Promise((r) => setTimeout(r, 0));
    expect(path()).toBe('/');
  });

  it('кладовщика уводит на склад', async () => {
    setRole('storekeeper');
    mount('/');
    await waitFor(() => expect(path()).toBe('/warehouse'));
  });

  it('руководство остаётся на обзоре', async () => {
    setRole('dispatcher');
    mount('/');
    await new Promise((r) => setTimeout(r, 0));
    expect(path()).toBe('/');
  });

  /**
   * ГЛАВНОЕ ОТРИЦАТЕЛЬНОЕ УСЛОВИЕ. При отказе `erp_bootstrap` слайс поднимает
   * флаг загрузки с пустыми данными, а `resolveErpRole` без роли с сервера
   * отдаёт `worker` — то есть менеджера на потерянной связи уносило бы
   * в очередь цеха. «Не знаем» обязано означать «остаёмся на обзоре».
   */
  it('роль с сервера не приехала — никуда не уводит', async () => {
    useAuthStore.setState({
      user: { id: 'u1', email: 'u@p.ru', name: 'U', role: 'manager', approved: true, active: true },
    });
    mount('/');
    await new Promise((r) => setTimeout(r, 0));
    expect(path()).toBe('/');
  });

  it('прямая ссылка сильнее посадочной', async () => {
    setRole('worker');
    mount('/orders');
    await new Promise((r) => setTimeout(r, 0));
    expect(path()).toBe('/orders');
  });

  /**
   * Решение принимается ОДИН раз за загрузку приложения. Иначе пункт меню
   * «Обзор» перестал бы работать у тех самых ролей, ради которых посадочная
   * и сделана: человек нажимает — и его отбрасывает обратно в цех.
   */
  it('вернувшись на обзор руками, человек на нём и остаётся', async () => {
    setRole('worker');
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes><Route path="*" element={<Harness withHomeLink />} /></Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(path()).toBe('/queue/cutting'));

    // Тот же смонтированный экземпляр приложения: человек нажал «Обзор» в меню
    fireEvent.click(screen.getByRole('button', { name: 'Обзор' }));

    expect(path()).toBe('/');
    // …и обратно не уносит: даём эффектам ещё один оборот
    await new Promise((r) => setTimeout(r, 0));
    expect(path()).toBe('/');
  });

  it('закрытый правом раздел не становится посадочной', async () => {
    setRole('storekeeper');
    mount('/', { canOpen: () => false });
    await new Promise((r) => setTimeout(r, 0));
    expect(path()).toBe('/');
  });
});

vi.mock('../../lib/supabase', () => ({ supabase: {} }));
