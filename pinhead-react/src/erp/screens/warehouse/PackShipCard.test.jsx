import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PackShipCard } from './PackShipCard';
import { PACK_SHIP_STATUS_LABELS } from '../../types';

/**
 * «Упаковка и отгрузка»: три статуса и ДВА действия (правка 23.08, п. 4).
 *
 * ЧТО ИМЕННО СТОРОЖИМ. Заказчик запретил промежуточные кнопки вроде «Начать
 * упаковку» и «отдельные карточки на каждый переход», поэтому проверяется
 * не только наличие нужной кнопки, но и ОТСУТСТВИЕ лишних: карточка, у которой
 * рядом с «Упаковано» снова появится «Принять на упаковку», пройдёт любую
 * проверку «кнопка есть».
 *
 * Снятые статусы (`awaiting_receipt`, `accepted`, `packed`) здесь не
 * фигурируют даже фикстурой: фикстура, воспроизводящая мёртвое состояние,
 * узаконивает его — и однажды окажется единственным доводом «так и было
 * задумано».
 */

const ORDER = {
  id: 'o1',
  bitrix_id: '321132',
  title: 'Общий тест 2.0',
  items: [{ id: 'it1', qty: 100, stages: [{ id: 'st1', status: 'done', qty_done: 100, qty_rework: 0 }] }],
  materials: [],
  warehouse_ops: [
    { id: 'op1', op_type: 'packing', qty: null, actor: 'Марголин Илья', created_at: '2026-08-23T09:00:00Z', note: null },
    { id: 'op2', op_type: 'marking', qty: null, actor: 'Марголин Илья', created_at: '2026-08-23T08:00:00Z', note: null },
  ],
  warehouse_tasks: [],
};

const onAdvance = vi.fn();
const setup = (status) => render(
  <PackShipCard order={ORDER} task={{ id: 'wt1', status }} onAdvance={onAdvance} />,
);

beforeEach(() => { onAdvance.mockClear(); });

describe('Упаковка и отгрузка — два действия, не пять', () => {
  it('«На упаковке»: единственное действие — «Упаковано»', () => {
    setup('packing');
    expect(screen.getByText('На упаковке')).toBeInTheDocument();
    const buttons = screen.getAllByRole('button').map((b) => b.textContent);
    expect(buttons).toEqual(['Упаковано']);
  });

  it('«Готово к отгрузке»: единственное действие — «Отгрузить»', () => {
    setup('ready_to_ship');
    expect(screen.getByText('Готово к отгрузке')).toBeInTheDocument();
    const buttons = screen.getAllByRole('button').map((b) => b.textContent);
    expect(buttons).toEqual(['Отгрузить']);
  });

  it('«Отгружено» — терминал: действий нет вовсе', () => {
    setup('shipped');
    expect(screen.getByText('Отгружено')).toBeInTheDocument();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('кнопка ведёт в следующий статус цепочки', () => {
    setup('packing');
    screen.getByRole('button', { name: 'Упаковано' }).click();
    expect(onAdvance).toHaveBeenCalledWith('wt1', 'ready_to_ship');
  });

  /**
   * Статус называется ОДИН раз (п. 4.7). Раньше он стоял и чипом в шапке,
   * и словами в подписи следующей кнопки — «Готово к отгрузке» было и
   * состоянием, и действием, ведущим в него.
   */
  it('текущий статус не дублируется подписью кнопки', () => {
    setup('packing');
    expect(screen.queryByRole('button', { name: 'На упаковке' })).toBeNull();
    setup('ready_to_ship');
    expect(screen.queryByRole('button', { name: 'Готово к отгрузке' })).toBeNull();
  });

  /** История свёрнута (п. 4.6): она не должна конкурировать с действием */
  it('история операций свёрнута под <details>', () => {
    const { container } = setup('packing');
    const details = container.querySelector('details');
    expect(details).not.toBeNull();
    expect(details.open).toBe(false);
    expect(details.querySelector('summary').textContent).toMatch(/История операций — 2/);
  });
});

describe('Подписи статусов', () => {
  it('перечисление ровно из трёх живых статусов', () => {
    expect(Object.keys(PACK_SHIP_STATUS_LABELS))
      .toEqual(['packing', 'ready_to_ship', 'shipped']);
  });
});
