import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ResultFieldsCell } from './DeptFields';

/**
 * §5 обхода 04.09: схема отчёта участка вводилась как DSL в `textarea` —
 * строка на поле, `код | подпись | единица | назначение | *`. Довод «формы
 * с восемью инпутами на строку таблицы здесь быть не может» верен, но он
 * про ТАБЛИЦУ: редактор и раньше открывался блоком поверх ячейки, а в блоке
 * синтаксис ничего не экономит — человек обязан помнить порядок пяти позиций
 * и коды назначений, а ошибку узнаёт после «Сохранить».
 *
 * Проверка при сохранении осталась ровно та же: недозаполненное поле
 * не должно уезжать в форму цеха.
 *
 * ГДЕ ОТКРЫВАЕТСЯ — тоже правило, а не оформление. Первая редакция правки
 * раскрывала поля прямо в ячейке таблицы участков; ячейка узкая (колонок
 * девять), и шесть полей строки вставали столбиком — хуже `textarea`,
 * которую заменяли. Довод «формы с восемью инпутами на строку таблицы здесь
 * быть не может» оказался верным буквально, и найдено это снимком экрана,
 * а не рассуждением. Отсюда `Modal`.
 */

const DEPT = {
  id: 'd1', name: 'Закройный цех',
  result_fields: [{ code: 'cut', label: 'Скроено', unit: 'шт', target: 'qty_good', required: true }],
};

const open = (onSave = vi.fn()) => {
  render(<ResultFieldsCell dept={DEPT} onSave={onSave} />);
  fireEvent.click(screen.getByRole('button', { name: /Настроить отчёт участка/ }));
  return onSave;
};

describe('схема отчёта участка', () => {
  it('редактор открывается диалогом, а не внутри узкой ячейки', () => {
    open();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAccessibleName(/Отчёт участка/);
    // Поля живут ВНУТРИ диалога — иначе они снова окажутся в ячейке таблицы
    expect(dialog).toContainElement(screen.getByLabelText('Подпись поля 1'));
  });

  it('поля правятся полями, а не строкой синтаксиса', () => {
    open();
    expect(screen.getByLabelText('Подпись поля 1')).toHaveValue('Скроено');
    expect(screen.getByLabelText('Код поля 1')).toHaveValue('cut');
    expect(screen.getByLabelText('Назначение поля 1')).toHaveValue('qty_good');
    expect(screen.getByLabelText('Поле 1 обязательное')).toBeChecked();
    // Прежний ввод синтаксисом снят целиком, а не спрятан
    expect(screen.queryByLabelText(/Поля отчёта участка/)).not.toBeInTheDocument();
  });

  it('сохраняет ровно то, что набрано', () => {
    const onSave = open();
    fireEvent.change(screen.getByLabelText('Подпись поля 1'), { target: { value: 'Раскроено' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(onSave).toHaveBeenCalledWith([
      { code: 'cut', label: 'Раскроено', unit: 'шт', target: 'qty_good', required: true },
    ]);
  });

  it('недозаполненное поле не уезжает в форму цеха', () => {
    const onSave = open();
    fireEvent.click(screen.getByRole('button', { name: /Поле/ }));
    fireEvent.change(screen.getByLabelText('Подпись поля 2'), { target: { value: 'Брак' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText(/нужны код, подпись и назначение/)).toBeInTheDocument();
  });

  /** Совсем пустая строка — недозаполненный черновик, а не ошибка */
  it('пустая строка отбрасывается молча', () => {
    const onSave = open();
    fireEvent.click(screen.getByRole('button', { name: /Поле/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(onSave).toHaveBeenCalledWith([
      { code: 'cut', label: 'Скроено', unit: 'шт', target: 'qty_good', required: true },
    ]);
  });
});
