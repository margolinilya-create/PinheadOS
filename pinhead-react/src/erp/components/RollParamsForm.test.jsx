import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RollParamsForm } from './RollParamsForm';

/**
 * ПАРАМЕТРЫ РУЛОНА ДЛЯ УЧЁТА В МЕТРАХ (правка 27.09, п. 4) — форма,
 * общая для закроя и склада. Проверяется, что расчёт виден ДО нажатия
 * (пример документа: 20 кг × 180 см × 240 г/м² → 46,30 м), что недостающие
 * поля подсвечены и что на сервер уезжает ровно введённое.
 */
const roll = (extra = {}) => ({
  id: 'r1', label: 'Рулон №1', qty: 20, width_cm: null, density_gsm: null,
  length_m: null, length_source: null, ...extra,
});

describe('RollParamsForm', () => {
  it('подставляет параметры материала и показывает расчётный метраж документа', () => {
    render(<RollParamsForm roll={roll()} material={{ width_cm: 180, density_gsm: 240 }} onSave={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent('Расчётный метраж: 46,30 м (расчёт)');
    expect(screen.getByRole('status')).toHaveTextContent('0.432 кг/м');
  });

  it('без параметров — недостающие поля подсвечены, кнопка погашена', () => {
    render(<RollParamsForm roll={roll()} material={{}} onSave={vi.fn()} />);
    expect(screen.getByLabelText(/Ширина полотна/)).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText(/Плотность/)).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('button', { name: /Записать параметры/ })).toBeDisabled();
  });

  /** «Если есть метраж поставщика или замер, отсутствие плотности не должно мешать учёту в метрах» */
  it('метраж поставщика снимает обязательность плотности и уезжает с источником', async () => {
    const onSave = vi.fn(async () => true);
    render(<RollParamsForm roll={roll()} material={{}} onSave={onSave} />);
    fireEvent.change(screen.getByLabelText(/Метраж рулона/), { target: { value: '45' } });
    expect(screen.getByLabelText(/Плотность/)).not.toHaveAttribute('aria-invalid');
    fireEvent.change(screen.getByLabelText(/Источник метража/), { target: { value: 'measured' } });
    fireEvent.click(screen.getByRole('button', { name: /Записать параметры/ }));
    await vi.waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave).toHaveBeenCalledWith('r1', expect.objectContaining({
      length_m: 45, length_source: 'measured', width_cm: null, density_gsm: null,
    }));
  });

  it('у рулона с метражом спрашивает причину уточнения', () => {
    render(<RollParamsForm roll={roll({ length_m: 46.3, length_source: 'calc', width_cm: 180, density_gsm: 240 })} material={{}} onSave={vi.fn()} />);
    expect(screen.getByLabelText(/Причина уточнения/)).toBeInTheDocument();
  });
});
