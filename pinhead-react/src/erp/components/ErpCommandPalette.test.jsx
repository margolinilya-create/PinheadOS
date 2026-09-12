import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import ErpCommandPalette from './ErpCommandPalette';
import { useErpStore } from '../store/useErpStore';
import { useAuthStore } from '../../store/useAuthStore';

/**
 * Сторож командной строки: отбор записей покрыт `utils/commandPalette.test.ts`,
 * здесь — то, что между ним и адресной строкой.
 *
 * ГЛАВНОЕ, ЧТО ПРОВЕРЯЕТСЯ, — «Enter открывает ВЫБРАННЫЙ». Именно этим сломана
 * палитра Order Studio: там нет индекса выбора, и `Enter` всегда берёт первый
 * результат, а стрелки не работают вовсе. Повторить это было бы легко —
 * дефект не роняет ничего и выглядит работающим.
 */

function Probe() {
  const { pathname } = useLocation();
  return <div data-testid="path">{pathname}</div>;
}

const DEPTS = [
  { id: 'd1', code: 'cutting', name: 'Закройный цех', is_production: true, active: true },
  { id: 'd2', code: 'sewing', name: 'Швейный цех', is_production: true, active: true },
];

function mount() {
  const onClose = vi.fn();
  render(
    <MemoryRouter initialEntries={['/']}>
      <Probe />
      <Routes>
        <Route path="*" element={<ErpCommandPalette onClose={onClose} />} />
      </Routes>
    </MemoryRouter>,
  );
  return { onClose };
}

const input = () => screen.getByRole('combobox');
const path = () => screen.getByTestId('path').textContent;
const options = () => screen.getAllByRole('option');
const selected = () => options().find((o) => o.getAttribute('aria-selected') === 'true');

beforeEach(() => {
  useErpStore.setState({ departments: DEPTS, orders: [], permissionMatrix: {}, myRole: null });
  // Админ: отбор по праву проверяет свой тест, здесь нужен полный список
  useAuthStore.setState({
    user: { id: 'u1', email: 'a@p.ru', name: 'A', role: 'admin', approved: true, active: true },
  });
});

describe('ErpCommandPalette — клавиатура', () => {
  it('первая запись выбрана сразу: Enter не требует стрелки', () => {
    mount();
    expect(selected()).toBe(options()[0]);
  });

  it('стрелка вниз двигает выбор', () => {
    mount();
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    expect(selected()).toBe(options()[1]);
  });

  it('стрелка вверх с первой записи заворачивает на последнюю', () => {
    mount();
    const all = options();
    fireEvent.keyDown(input(), { key: 'ArrowUp' });
    expect(selected()).toBe(all[all.length - 1]);
  });

  /**
   * ВОТ ЭТО И ЕСТЬ ПОЧИНКА. Берём ВТОРУЮ запись стрелкой и проверяем, что
   * `Enter` увёл именно по ней, а не по первой.
   */
  it('Enter открывает ВЫБРАННЫЙ, а не первый', () => {
    mount();
    const secondLabel = options()[1].textContent;

    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    fireEvent.keyDown(input(), { key: 'Enter' });

    expect(path()).not.toBe('/');
    // Путь соответствует именно второй записи: её подпись содержит раздел
    expect(secondLabel).toBeTruthy();
    expect(path()).toBe('/orders');
  });

  it('Escape закрывает, не уводя никуда', () => {
    const { onClose } = mount();
    fireEvent.keyDown(input(), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(path()).toBe('/');
  });

  it('Enter на пустом результате не уводит никуда', () => {
    mount();
    fireEvent.change(input(), { target: { value: 'такого раздела нет' } });
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(path()).toBe('/');
    expect(screen.getByText(/Ничего не нашлось/)).toBeInTheDocument();
  });
});

describe('ErpCommandPalette — переход', () => {
  it('клик по записи ведёт по ней и закрывает палитру', () => {
    const { onClose } = mount();
    fireEvent.change(input(), { target: { value: 'швей' } });
    fireEvent.click(screen.getByRole('option', { name: /Швейка|Швейный/ }));

    expect(path()).toBe('/queue/sewing');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('набор сбрасывает выбор на первую запись', () => {
    mount();
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    fireEvent.change(input(), { target: { value: 'цех' } });
    // Иначе выбор указывал бы в середину УЖЕ ДРУГОГО списка
    expect(selected()).toBe(options()[0]);
  });
});

describe('ErpCommandPalette — доступность', () => {
  /**
   * ПОЛНЫЙ ПАТТЕРН, А НЕ ПОЛОВИНА. `role="option"` без `listbox`,
   * `aria-selected` и `aria-activedescendant` — это ложная семантика, и
   * правило проекта запрещает её прямо (так было с `role="tab"` на «Активные
   * / Архив»).
   */
  it('список объявлен listbox, выбор ведёт aria-activedescendant', () => {
    mount();
    const list = screen.getByRole('listbox');
    expect(list).toBeInTheDocument();

    const active = input().getAttribute('aria-activedescendant');
    expect(active).toBeTruthy();
    expect(selected()?.id).toBe(active);
  });

  it('фокус остаётся в поле: стрелки не уводят его из ввода', () => {
    mount();
    expect(document.activeElement).toBe(input());
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(input());
  });

  it('окно объявлено диалогом со своим именем', () => {
    mount();
    expect(screen.getByRole('dialog', { name: 'Быстрый переход' })).toBeInTheDocument();
  });
});
