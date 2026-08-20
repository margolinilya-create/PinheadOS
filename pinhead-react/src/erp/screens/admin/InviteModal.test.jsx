import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../../../lib/supabase', () => ({
  supabase: { from: vi.fn(), rpc: vi.fn(), channel: vi.fn(), removeChannel: vi.fn() },
}));

const { InviteModal } = await import('./InviteModal');
const { useErpStore } = await import('../../store/useErpStore');
const { attachDomainSlices } = await import('../../store/domainSlices');
const { useConfirmStore } = await import('../../../store/useConfirmStore');

/**
 * Выдача приглашений.
 *
 * Смысл экрана — отдать админу ГОТОВУЮ ССЫЛКУ: письма в этом пути не участвуют,
 * потому что именно на письмах прежний порядок и вставал. Поэтому ссылка
 * показывается в поле, а не в тосте: тост исчезнет раньше, чем человек успеет
 * переключиться в мессенджер.
 */

const DEPARTMENTS = [
  { id: 'd-sew', name: 'Швейный цех', active: true },
  { id: 'd-old', name: 'Закрытый участок', active: false },
];

const HOUR_MS = 60 * 60 * 1000;

/**
 * Действующее приглашение — то, срок которого ЕЩЁ НЕ ВЫШЕЛ, а это величина
 * относительная: экран сравнивает `expires_at` с `new Date()`.
 *
 * Здесь стояла фиксированная дата (`2026-08-20T10:00:00Z`), и тест исправно
 * проходил ровно до того часа, когда она наступила: 20.08 «действующих (1)»
 * стало «(0)», и два теста упали сами по себе, без единой правки кода.
 * Фиксированные ISO нужны там, где дата ПОКАЗЫВАЕТСЯ или сравнивается
 * с другой фикстурой; сроку, который должен быть в будущем всегда,
 * фиксированная дата — отложенная поломка.
 */
const FRESH = {
  code: 'code-1', profile_role: 'production', employee_role: 'worker',
  department_id: 'd-sew', email: null, note: null,
  expires_at: new Date(Date.now() + 72 * HOUR_MS).toISOString(),
  used_at: null, revoked_at: null,
  created_by: null, created_at: new Date(Date.now() - HOUR_MS).toISOString(),
};

let createInvite;
let revokeInvite;
let writeText;

beforeEach(() => {
  attachDomainSlices();
  createInvite = vi.fn().mockResolvedValue(FRESH);
  revokeInvite = vi.fn().mockResolvedValue(true);
  useErpStore.setState({
    departments: DEPARTMENTS,
    profilesList: [
      { id: 'p-1', email: 'za@pnhd.ru', name: 'za@pnhd.ru', role: 'manager', approved: false, active: false },
    ],
    invites: [],
    invitesLoaded: true,
    loadInvites: vi.fn(),
    createInvite,
    revokeInvite,
  });
  writeText = vi.fn().mockResolvedValue();
  Object.assign(navigator, { clipboard: { writeText } });
});

describe('InviteModal — выдача ссылки', () => {
  it('роль, цех и срок уезжают в приглашение', async () => {
    render(<InviteModal onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText(/Цех$/), { target: { value: 'd-sew' } });
    fireEvent.click(screen.getByText('Создать ссылку'));

    await waitFor(() => expect(createInvite).toHaveBeenCalledWith(expect.objectContaining({
      profile_role: 'production',
      employee_role: 'worker',
      department_id: 'd-sew',
      expiresInHours: 72,
    })));
  });

  it('готовая ссылка видна целиком и копируется', async () => {
    render(<InviteModal onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('Создать ссылку'));

    const link = await screen.findByLabelText('Ссылка-приглашение');
    expect(link.value).toContain('/join?code=code-1');

    fireEvent.click(screen.getAllByText('Скопировать')[0]);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining('/join?code=code-1'),
    ));
  });

  /** Закрытый участок в списке назначений — приглашение в никуда */
  it('отключённые цеха не предлагаются', () => {
    render(<InviteModal onClose={vi.fn()} />);
    expect(screen.queryByText('Закрытый участок')).toBeNull();
    expect(screen.getByText('Швейный цех')).toBeInTheDocument();
  });
});

describe('InviteModal — список и отзыв', () => {
  it('действующее приглашение показано с ролью и цехом', () => {
    useErpStore.setState({ invites: [FRESH] });
    render(<InviteModal onClose={vi.fn()} />);

    expect(screen.getByText(/Сотрудник цеха · Швейный цех/)).toBeInTheDocument();
    expect(screen.getByText(/Действующие приглашения \(1\)/)).toBeInTheDocument();
  });

  it('использованное уезжает в свёрнутый журнал, а не пропадает', () => {
    useErpStore.setState({ invites: [{ ...FRESH, used_at: '2026-08-14T12:00:00Z' }] });
    render(<InviteModal onClose={vi.fn()} />);

    expect(screen.getByText(/Действующие приглашения \(0\)/)).toBeInTheDocument();
    expect(screen.getByText(/Использованные и просроченные \(1\)/)).toBeInTheDocument();
  });

  it('просроченное действующим не считается', () => {
    useErpStore.setState({ invites: [{ ...FRESH, expires_at: '2020-01-01T00:00:00Z' }] });
    render(<InviteModal onClose={vi.fn()} />);

    expect(screen.getByText(/Действующие приглашения \(0\)/)).toBeInTheDocument();
  });

  it('отзыв спрашивает подтверждение — ссылка могла быть уже отправлена', async () => {
    useErpStore.setState({ invites: [FRESH] });
    render(<InviteModal onClose={vi.fn()} />);

    fireEvent.click(screen.getByText('Отозвать'));

    await waitFor(() => expect(useConfirmStore.getState().open).toBe(true));
    useConfirmStore.getState()._close(true);

    await waitFor(() => expect(revokeInvite).toHaveBeenCalledWith('code-1'));
  });
});

/**
 * Приглашение на адрес, у которого уже есть учётная запись, — тупик:
 * `signUp` вторую учётку не создаёт, и человек упирается в «уже
 * зарегистрирован» сколько бы раз ни открыл ссылку. На проде так и вышло:
 * девять попыток подряд. Сказать об этом ЗДЕСЬ дешевле, чем разбираться
 * потом по логам.
 */
describe('InviteModal — адрес уже заведён', () => {
  it('предупреждает при вводе существующего адреса и называет, что он отключён', () => {
    render(<InviteModal onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText(/Email/), { target: { value: 'ZA@pnhd.ru' } });

    expect(screen.getByText(/уже есть учётная запись \(отключена\)/)).toBeInTheDocument();
  });

  it('на свободный адрес не ругается', () => {
    render(<InviteModal onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText(/Email/), { target: { value: 'nobody@pnhd.ru' } });

    expect(screen.queryByText(/уже есть учётная запись/)).toBeNull();
  });
});
