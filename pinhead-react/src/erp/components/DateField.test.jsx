import { describe, it, expect, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DateField } from './DateField';

/**
 * ПРАВКА ЗАКАЗЧИКА 16.09, П. 3: «Нужно убрать дублирование даты справа
 * и оставить одну компактную строку: „План завершения [07.10.2026]"».
 *
 * И ОДНОВРЕМЕННО — правило, ради которого эхо когда-то завели: при en-US
 * поле показывает «10/07», и это читается двояко. Сторож держит ОБА конца:
 * при дневном-первым формате эха нет (дублирования нет), при месяце-первым
 * оно на месте (неоднозначности нет). Проверять только первое значило бы
 * засчитать за исполнение и возврат старого дефекта.
 */

const REAL_DTF = Intl.DateTimeFormat;

function withOrder(order) {
  (Intl).DateTimeFormat = function fake() {
    return {
      formatToParts: () => (order === 'day'
        ? [{ type: 'day', value: '07' }, { type: 'month', value: '10' }]
        : [{ type: 'month', value: '10' }, { type: 'day', value: '07' }]),
    };
  };
}

afterEach(() => { (Intl).DateTimeFormat = REAL_DTF; });

describe('DateField: эхо по формату браузера', () => {
  it('день первым — эха под полем нет, строка одна', () => {
    withOrder('day');
    render(<DateField value="2026-10-07" onChange={() => {}} aria-label="План завершения" />);

    expect(screen.getByLabelText('План завершения')).toHaveValue('2026-10-07');
    // Именно дублирующая подпись, на которую жалуется документ
    expect(screen.queryByText(/окт\./)).not.toBeInTheDocument();
  });

  it('месяц первым — эхо остаётся: «10/07» иначе двусмысленно', () => {
    withOrder('month');
    render(<DateField value="2026-10-07" onChange={() => {}} aria-label="План завершения" />);

    expect(screen.getByText(/окт\./)).toBeInTheDocument();
  });

  it('у пустого поля подсказка формата подчиняется тому же правилу', () => {
    withOrder('day');
    const { unmount } = render(<DateField value="" onChange={() => {}} aria-label="Срок" />);
    expect(screen.queryByText('дд.мм.гггг')).not.toBeInTheDocument();
    unmount();

    withOrder('month');
    render(<DateField value="" onChange={() => {}} aria-label="Срок" />);
    expect(screen.getByText('дд.мм.гггг')).toBeInTheDocument();
  });

  it('явный режим сильнее формата — место решает само', () => {
    withOrder('day');
    render(<DateField value="2026-10-07" onChange={() => {}} echo="always" aria-label="Срок" />);
    expect(screen.getByText(/окт\./)).toBeInTheDocument();
  });
});
