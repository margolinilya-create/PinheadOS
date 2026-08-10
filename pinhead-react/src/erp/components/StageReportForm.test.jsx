import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StageReportForm } from './StageReportForm';

/**
 * Форма отчёта цеха гейтилась ОДНИМ правом — «записывать результат», — а страж
 * этапов разбирает изменение по колонкам: `qty_rework` он проверяет отдельно,
 * под «оформлять брак».
 *
 * Матрица прав редактируема. Стоит снять у роли «Оформлять брак» — и человек
 * по-прежнему видел поле «В переделку», заполнял его и получал 42501 на
 * сохранении. Падал ВЕСЬ отчёт: вместе с браком терялось уже введённое
 * «сшито», а тост говорил про права вообще. Запрещённое «кнопка есть, действие
 * падает», причём в самой частой форме цеха.
 */

const DEPT = {
  id: 'd-sew',
  name: 'Швейный',
  result_fields: [
    { code: 'sewn', label: 'Сшито', unit: 'шт', required: true, target: 'qty_good' },
    { code: 'defect', label: 'Брак', unit: 'шт', required: false, target: 'qty_defect' },
    { code: 'rework', label: 'В переделку', unit: 'шт', required: false, target: 'qty_rework' },
  ],
};

const ENTRY = {
  order: { id: 'o1', title: 'Заказ' },
  item: { id: 'it1', qty: 100, stages: [] },
  stage: { id: 'st1', item_id: 'it1', department_id: 'd-sew', qty_done: 0, depends_on: [] },
};

function renderForm(props = {}) {
  return render(
    <StageReportForm
      entry={ENTRY}
      dept={DEPT}
      busy={false}
      onSubmit={vi.fn()}
      onCancel={vi.fn()}
      {...props}
    />,
  );
}

describe('поля брака показываются только с правом на брак', () => {
  it('с правом видны все поля участка', () => {
    renderForm({ canDefect: true });
    expect(screen.getByLabelText(/Сшито/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Брак/)).toBeInTheDocument();
    expect(screen.getByLabelText(/В переделку/)).toBeInTheDocument();
  });

  it('без права остаётся только выработка', () => {
    renderForm({ canDefect: false });
    expect(screen.getByLabelText(/Сшито/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Брак/)).toBeNull();
    expect(screen.queryByLabelText(/В переделку/)).toBeNull();
  });

  /**
   * Форма не «урезанная», а рабочая: «сшито» без «в переделку» — законный
   * отчёт цеха, и обязательное поле остаётся обязательным.
   */
  it('без права отчёт всё равно можно сдать', () => {
    renderForm({ canDefect: false });
    expect(screen.getByRole('button', { name: /Сдать результат/i })).toBeInTheDocument();
  });

  it('по умолчанию право есть — старые вызовы не меняют поведения', () => {
    renderForm();
    expect(screen.getByLabelText(/В переделку/)).toBeInTheDocument();
  });
});
