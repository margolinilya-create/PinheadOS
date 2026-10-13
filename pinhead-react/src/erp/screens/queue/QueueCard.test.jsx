import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueueCard } from './QueueCard';

/**
 * УПРАВЛЕНИЕ ОЧЕРЕДЬЮ НА ПЛАНШЕТЕ.
 *
 * ЗАЧЕМ ЭТОТ СТОРОЖ. Приоритет очереди (перетаскивание + кнопки ↑/↓) и
 * «Поставить в план» жили ТОЛЬКО в `QueueRow` — десктопной строке.
 * А `useCompactLayout` это `max-width: 1024px` ИЛИ `pointer: coarse`, то есть
 * на ЛЮБОМ цеховом планшете рисуется `QueueCard`, которой эти пропсы не
 * передавались и которая их не принимала. Перетащить нельзя (карточки
 * не draggable), нажать нечего (кнопок нет) — право `stage.priority`
 * оказалось недостижимо на основном рабочем устройстве цеха.
 *
 * Отдельная горечь: комментарий в `QueueRow` называет те же кнопки
 * «клавиатурной и ТАЧ-альтернативой» перетаскиванию. Альтернатива жила
 * в раскладке, которой на тач-экране не бывает.
 */

vi.mock('../../store/useErpStore', () => ({
  orderPreviewUrl: () => null,
  lastDefectPhotoUrl: () => null,
  useErpStore: () => ({}),
}));

vi.mock('./StageActionsPanel', () => ({
  StageActionsPanel: () => null,
}));

const ENTRY = {
  order: { id: 'o1', bitrix_id: '4821', title: 'Худи «Ромашка»', due_date: '2026-09-20', customer: 'ООО Ромашка' },
  item: { id: 'i1', product_type: 'Худи', variant: 'чёрное', qty: 100 },
  stage: { id: 'st1', status: 'waiting', qty_done: 0, planned_end: null, department_id: 'd1' },
  group: 'ready',
  reason: null,
  missingMaterials: [],
};

const PERMS = { plan: true, take: true, progress: true, complete: true, block: true, defect: true };

function renderCard(props = {}) {
  return render(
    <MemoryRouter>
      <QueueCard
        entry={ENTRY}
        perms={PERMS}
        rework={null}
        deptShortById={new Map()}
        actions={{}}
        {...props}
      />
    </MemoryRouter>,
  );
}

describe('QueueCard — приоритет и план доступны на планшете', () => {
  it('с правом на приоритет рисует кнопки ↑/↓ с внятными именами', () => {
    renderCard({ canReorder: true, index: 1, canMoveUp: true, canMoveDown: true, onMove: vi.fn() });
    expect(screen.getByRole('button', { name: /Поднять приоритет/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Опустить приоритет/ })).toBeInTheDocument();
    // Номер приоритета виден: без него кнопки двигают вслепую
    expect(screen.getByText('Приоритет 2')).toBeInTheDocument();
  });

  it('кнопка ↑ отключена у первой строки, ↓ — у последней', () => {
    renderCard({ canReorder: true, index: 0, canMoveUp: false, canMoveDown: true, onMove: vi.fn() });
    expect(screen.getByRole('button', { name: /Поднять приоритет/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Опустить приоритет/ })).not.toBeDisabled();
  });

  it('без права на приоритет кнопок нет вовсе', () => {
    renderCard({ canReorder: false });
    expect(screen.queryByRole('button', { name: /приоритет/i })).not.toBeInTheDocument();
  });

  it('«В план» есть у готового к запуску при праве на план', () => {
    renderCard({ onPlan: vi.fn() });
    expect(screen.getByRole('button', { name: /Поставить в план/ })).toBeInTheDocument();
  });

  it('«В план» не предлагается тому, кто ещё не готов к запуску', () => {
    // Планировать «ждёт материалы» можно, но это решение с оговоркой,
    // и живёт оно на общем экране плана — то же правило, что в QueueRow
    renderCard({ onPlan: vi.fn(), entry: { ...ENTRY, group: 'awaiting_materials' } });
    expect(screen.queryByRole('button', { name: /Поставить в план/ })).not.toBeInTheDocument();
  });

  it('без права на план кнопки нет', () => {
    renderCard({ onPlan: vi.fn(), perms: { ...PERMS, plan: false } });
    expect(screen.queryByRole('button', { name: /Поставить в план/ })).not.toBeInTheDocument();
  });
});
