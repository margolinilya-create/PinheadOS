import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { useCutReport } from './useCutReport';
import { CutUsageSection } from './CutUsageSection';
import { CutTotalsBar } from './CutTotalsBar';
import { useConfirmStore } from '../../../store/useConfirmStore';

/**
 * «РАСХОД ТКАНИ» (правки 19.10, «Закрой»): у рулона три режима — «Не
 * использован», «Полностью», «Частично»; выпуск вводится один раз таблицей,
 * здесь — только метры. Массовое «Использованы полностью» — для выбранных
 * флажками, частичный остаток без подтверждения не затирается.
 */

const roll = (id, seq, left, extra = {}) => ({
  id, material_id: 'm-f', seq, label: `Рулон №${seq}`, status: 'in_stock', qty: 20, unit: 'кг',
  length_m: left, length_source: 'supplier', length_left_m: left, price_per_m: 100,
  leftover_kind: null, ...extra,
});
const FOOTER = { id: 'm-f', kind: 'fabric', name: 'Футер', color: 'чёрный', accept_status: 'accepted_full' };
const RIB = { id: 'm-r', kind: 'fabric', name: 'Рибана', color: 'чёрный', accept_status: 'accepted_full' };
const OPTIONS = [
  { roll: roll('r-12', 12, 50), material: FOOTER, label: 'Рулон №12 · Футер · чёрный' },
  { roll: roll('r-13', 13, 50), material: FOOTER, label: 'Рулон №13 · Футер · чёрный' },
  { roll: roll('r-14', 14, 50, { length_source: 'calc' }), material: FOOTER, label: 'Рулон №14 · Футер · чёрный' },
  {
    roll: roll('r-20', 20, 10, { material_id: 'm-r' }), material: RIB, label: 'Рулон №20 · Рибана · чёрный',
  },
  {
    roll: roll('r-90', 3, 7, { material_id: 'm-x', status: 'used', leftover_kind: 'usable' }),
    material: { ...FOOTER, id: 'm-x' },
    label: 'Рулон №3 · Футер · остаток заказа «PH-1017»',
    fromOrder: 'PH-1017',
  },
];
const ORDER = {
  id: 'o-1',
  items: [{ id: 'it-1', qty: 100, size_grid: [{ color: 'чёрный', sizes: { S: 50, M: 50 } }] }],
};
const STAGE = { id: 'st-1', item_id: 'it-1' };

function Harness({ options = OPTIONS }) {
  const cut = useCutReport({ stage: STAGE, order: ORDER, options });
  return (
    <>
      <CutUsageSection cut={cut} options={options} onRollParams={vi.fn()} />
      <CutTotalsBar cut={cut} options={options} />
    </>
  );
}

const modeGroup = (seq) => screen.getByRole('radiogroup', { name: `Рулон №${seq} — использование` });
const usedOf = (seq) => screen.getByTestId(`used-${seq}`);

describe('CutUsageSection — режимы рулона', () => {
  it('по умолчанию «Не использован»', () => {
    render(<Harness />);
    for (const seq of [12, 13, 14, 20]) {
      expect(within(modeGroup(seq)).getByRole('radio', { name: 'Не использован' })).toBeChecked();
    }
    expect(usedOf(12)).toHaveTextContent('0 м');
  });

  it('стрелка вправо в radiogroup «Рулон №12 — использование» → «Полностью»', () => {
    render(<Harness />);
    const group = modeGroup(12);
    const unused = within(group).getByRole('radio', { name: 'Не использован' });
    const full = within(group).getByRole('radio', { name: 'Полностью' });
    // Нативные радио одного name: стрелка браузера = выбор соседнего.
    // jsdom стрелок не знает — проверяем, что группа одна и выбор переходит.
    expect(unused).toHaveAttribute('name', full.getAttribute('name'));
    unused.focus();
    fireEvent.keyDown(unused, { key: 'ArrowRight' });
    fireEvent.click(full);
    expect(full).toBeChecked();
    expect(unused).not.toBeChecked();
    expect(usedOf(12)).toHaveTextContent('50 м');
  });

  it('выбор двух + «Использованы полностью» → расход = доступному, без выбора пригодности, status объявляет итог, фокус на кнопке', async () => {
    render(<Harness />);
    const group = screen.getByRole('group', { name: 'Футер · чёрный' });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Выбрать рулон №12' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Выбрать рулон №13' }));
    expect(within(group).getByText('Выбрано: 2')).toBeInTheDocument();
    const button = within(group).getByRole('button', { name: 'Использованы полностью' });
    button.focus();
    await act(async () => { fireEvent.click(button); });
    expect(within(modeGroup(12)).getByRole('radio', { name: 'Полностью' })).toBeChecked();
    expect(within(modeGroup(13)).getByRole('radio', { name: 'Полностью' })).toBeChecked();
    expect(usedOf(12)).toHaveTextContent('50 м');
    expect(screen.queryByRole('radiogroup', { name: /остаток/ })).not.toBeInTheDocument();
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('2 рулона: полностью. Расход 100 м');
    expect(document.activeElement).toBe(button);
    // Выбор снят
    expect(screen.getByRole('checkbox', { name: 'Выбрать рулон №12' })).not.toBeChecked();
  });

  it('без выбора «Использованы полностью» — aria-disabled с причиной', () => {
    render(<Harness />);
    const group = screen.getByRole('group', { name: 'Футер · чёрный' });
    const button = within(group).getByRole('button', { name: 'Использованы полностью' });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toHaveAccessibleDescription('Отметьте рулоны флажками');
    fireEvent.click(button);
    expect(within(modeGroup(12)).getByRole('radio', { name: 'Не использован' })).toBeChecked();
  });

  it('выбор строк сам не меняет итоги', () => {
    render(<Harness />);
    const before = screen.getByRole('status').textContent;
    fireEvent.click(screen.getByRole('checkbox', { name: 'Выбрать все в группе Футер · чёрный' }));
    expect(screen.getByRole('checkbox', { name: 'Выбрать рулон №14' })).toBeChecked();
    expect(screen.getByRole('status').textContent).toBe(before);
    expect(usedOf(12)).toHaveTextContent('0 м');
  });

  it('частичный остаток не затирается без подтверждения', async () => {
    render(<Harness />);
    fireEvent.click(within(modeGroup(12)).getByRole('radio', { name: 'Частично' }));
    fireEvent.change(screen.getByLabelText('Остаток, м — рулон №12'), { target: { value: '12' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Выбрать рулон №12' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Выбрать рулон №13' }));
    const button = screen.getAllByRole('button', { name: 'Использованы полностью' })[0];
    await act(async () => { fireEvent.click(button); });
    const dialog = useConfirmStore.getState();
    expect(dialog.open).toBe(true);
    expect(dialog.title).toBe('У 1 рулона введён остаток. Отметить полностью?');
    expect(dialog.confirmLabel).toBe('Отметить полностью');
    expect(dialog.cancelLabel).toBe('Не менять');
    await act(async () => { useConfirmStore.getState()._close(false); });
    expect(within(modeGroup(12)).getByRole('radio', { name: 'Частично' })).toBeChecked();
    expect(screen.getByLabelText('Остаток, м — рулон №12')).toHaveValue(12);
    expect(within(modeGroup(13)).getByRole('radio', { name: 'Не использован' })).toBeChecked();
  });

  it('частично 12 из 50 → расход 38 и обязательная пригодность', () => {
    render(<Harness />);
    fireEvent.click(within(modeGroup(12)).getByRole('radio', { name: 'Частично' }));
    const left = screen.getByLabelText('Остаток, м — рулон №12');
    fireEvent.change(left, { target: { value: '12' } });
    fireEvent.blur(left);
    expect(usedOf(12)).toHaveTextContent('38 м');
    const fate = screen.getByRole('radiogroup', { name: 'Рулон №12 — остаток' });
    expect(within(fate).getByRole('radio', { name: 'Остаток пригоден' })).not.toBeChecked();
    expect(within(fate).getByRole('radio', { name: /Малый остаток, не учитывать/ })).toHaveAccessibleDescription(/спишется в отходы/);
    expect(fate).toHaveAttribute('aria-invalid', 'true');
    expect(fate).toHaveAccessibleDescription(/Выберите: остаток пригоден или малый остаток/);
    fireEvent.click(within(fate).getByRole('radio', { name: 'Остаток пригоден' }));
    expect(fate).not.toHaveAttribute('aria-invalid');
    expect(screen.getByRole('status')).toHaveTextContent('Расход 38 м');
  });

  it('остаток больше доступного → ошибка и «Уточнить метраж рулона»', () => {
    render(<Harness />);
    fireEvent.click(within(modeGroup(12)).getByRole('radio', { name: 'Частично' }));
    const left = screen.getByLabelText('Остаток, м — рулон №12');
    fireEvent.change(left, { target: { value: '60' } });
    expect(left).toHaveAttribute('aria-invalid', 'true');
    expect(left).toHaveAccessibleDescription(/Остаток больше доступного \(50 м\) — уточните метраж рулона/);
    const row = screen.getByRole('group', { name: 'Рулон №12' });
    expect(within(row).getByRole('button', { name: 'Уточнить метраж рулона' })).toBeInTheDocument();
  });

  it('рулон без метража сервера — расход не записать, форма параметров у строки', () => {
    const bare = {
      roll: roll('r-30', 30, null, { length_m: null, length_left_m: null, width_cm: 180, density_gsm: 240 }),
      material: FOOTER,
      label: 'Рулон №30',
    };
    render(<Harness options={[bare]} />);
    fireEvent.click(within(modeGroup(30)).getByRole('radio', { name: 'Полностью' }));
    expect(modeGroup(30)).toHaveAttribute('aria-invalid', 'true');
    expect(modeGroup(30)).toHaveAccessibleDescription(/Не заполнены данные для учёта в метрах/);
    expect(screen.getByRole('button', { name: /Сохранить|Записать/ })).toBeInTheDocument();
  });

  it('группы по материалу и цвету, чужой остаток с заказом-источником', () => {
    render(<Harness />);
    const footer = screen.getByRole('group', { name: 'Футер · чёрный' });
    const rib = screen.getByRole('group', { name: 'Рибана · чёрный' });
    expect(within(footer).getByText(/№ 12 · Доступно 50 м/)).toBeInTheDocument();
    expect(within(footer).getByText(/расчётный метраж/)).toBeInTheDocument();
    expect(within(rib).getByText(/№ 20 · Доступно 10 м/)).toBeInTheDocument();
    expect(within(footer).queryByText(/№ 20/)).not.toBeInTheDocument();
    expect(screen.getByText(/остаток заказа PH-1017/)).toBeInTheDocument();
  });
});
