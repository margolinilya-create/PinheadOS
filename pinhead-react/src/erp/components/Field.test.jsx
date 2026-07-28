import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Field } from './Field';

describe('Field', () => {
  it('связывает подпись с контролом', () => {
    render(<Field label="Количество" />);
    expect(screen.getByLabelText('Количество')).toBeInTheDocument();
  });

  it('ошибка ставит aria-invalid и связывается через aria-describedby', () => {
    render(<Field label="Срок" error="Укажите дату" />);
    const input = screen.getByLabelText('Срок');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    const described = input.getAttribute('aria-describedby');
    expect(described).toBeTruthy();
    expect(document.getElementById(described)).toHaveTextContent('Укажите дату');
  });

  it('подсказка показывается, пока нет ошибки', () => {
    const { rerender } = render(<Field label="Срок" hint="Формат ДД.ММ.ГГГГ" />);
    expect(screen.getByText('Формат ДД.ММ.ГГГГ')).toBeInTheDocument();

    rerender(<Field label="Срок" hint="Формат ДД.ММ.ГГГГ" error="Укажите дату" />);
    expect(screen.queryByText('Формат ДД.ММ.ГГГГ')).toBeNull();
    expect(screen.getByText('Укажите дату')).toBeInTheDocument();
  });

  it('as="select" рендерит выпадающий список с опциями', () => {
    const onChange = vi.fn();
    render(
      <Field label="Цех" as="select" value="cutting" onChange={onChange}>
        <option value="cutting">Закрой</option>
        <option value="sewing">Швейка</option>
      </Field>,
    );
    const select = screen.getByLabelText('Цех');
    expect(select.tagName).toBe('SELECT');
    fireEvent.change(select, { target: { value: 'sewing' } });
    expect(onChange).toHaveBeenCalled();
  });

  it('as="textarea" рендерит многострочное поле', () => {
    render(<Field label="Комментарий" as="textarea" />);
    expect(screen.getByLabelText('Комментарий').tagName).toBe('TEXTAREA');
  });

  it('пробрасывает атрибуты контрола (type, min, placeholder)', () => {
    render(<Field label="Штук" type="number" min="1" placeholder="шт" />);
    const input = screen.getByLabelText('Штук');
    expect(input).toHaveAttribute('type', 'number');
    expect(input).toHaveAttribute('min', '1');
    expect(input).toHaveAttribute('placeholder', 'шт');
  });
});
