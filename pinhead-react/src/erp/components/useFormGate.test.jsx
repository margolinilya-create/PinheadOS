import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import { useFormGate } from './useFormGate';
import { FieldError, FormGateHint } from './FormGate';

/**
 * Сторож единого паттерна валидации (H-16 отчёта QA 13.08.2026).
 *
 * Проверяется не «валидация есть», а то, чего у трёх форм из четырёх не было:
 * причина названа ВИДИМО и РЯДОМ С ПОЛЕМ. Молчаливый `disabled` — та же
 * невалидированная форма, только объясняющая ещё меньше.
 */

function Demo() {
  const [name, setName] = useState('');
  const [saved, setSaved] = useState(false);
  const gate = useFormGate([
    { key: 'name', label: 'Материал', ok: Boolean(name.trim()) },
  ]);
  return (
    <div>
      <input
        aria-label="Материал"
        className={gate.cls('base', 'name')}
        value={name}
        onChange={(e) => setName(e.target.value)}
        {...gate.field('name')}
      />
      <FieldError id={gate.errId('name')} text={gate.error('name')} />
      <FormGateHint gate={gate} />
      <button type="button" onClick={gate.guard(() => setSaved(true))}>Сохранить</button>
      {saved && <span>сохранено</span>}
    </div>
  );
}

describe('useFormGate', () => {
  it('до первой попытки форма молчит — человек ещё заполняет', () => {
    render(<Demo />);
    expect(screen.queryByText(/Осталось заполнить/)).toBeNull();
    expect(screen.getByLabelText('Материал')).not.toHaveAttribute('aria-invalid');
  });

  it('кнопка НЕ заблокирована заранее: клик обязан объяснить причину', () => {
    // Ровно этим «Записать приёмку» и была сломана: кнопка гасла молча,
    // и человек не мог отличить незаполненную форму от неработающей кнопки.
    render(<Demo />);
    const btn = screen.getByRole('button', { name: 'Сохранить' });
    expect(btn).toBeEnabled();

    fireEvent.click(btn);

    expect(screen.queryByText('сохранено')).toBeNull();
    expect(screen.getByText('Заполните: Материал')).toBeInTheDocument();
    expect(screen.getByText('Осталось заполнить: Материал')).toBeInTheDocument();
  });

  it('поле помечается для скринридера и для автоскролла', () => {
    render(<Demo />);
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    const input = screen.getByLabelText('Материал');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute('data-invalid', 'true');
    expect(input).toHaveAttribute('aria-describedby', 'fg-err-name');
    expect(document.getElementById('fg-err-name')).toBeInTheDocument();
  });

  it('после исправления действие проходит, ошибка снимается', () => {
    render(<Demo />);
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    fireEvent.change(screen.getByLabelText('Материал'), { target: { value: 'кулирка' } });

    expect(screen.queryByText(/Осталось заполнить/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(screen.getByText('сохранено')).toBeInTheDocument();
  });

  it('«не заполнено» и «заполнено неверно» разведены', () => {
    // Иначе при заполненном поле всплывает «Осталось заполнить: Количество»
    function Two() {
      const gate = useFormGate([
        { key: 'a', label: 'Заказ', ok: false },
        { key: 'b', label: 'Количество', ok: false, kind: 'invalid' },
      ]);
      return (
        <>
          <button type="button" onClick={gate.guard(() => {})}>Сохранить</button>
          <FormGateHint gate={gate} />
        </>
      );
    }
    render(<Two />);
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(screen.getByText('Осталось заполнить: Заказ')).toBeInTheDocument();
    expect(screen.getByText('Проверьте: Количество')).toBeInTheDocument();
  });
});
