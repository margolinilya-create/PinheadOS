import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LegacySubcontractTab } from './LegacySubcontractTab';
import { hasLegacySubcontracts } from '../../utils/outsourcing';
import { useErpStore } from '../../store/useErpStore';
import { attachDomainSlices } from '../../store/domainSlices';

// Компонент рендерится напрямую, минуя lazyScreen, — стор подключает тест
attachDomainSlices();

/**
 * Технический контур: операции подряда без маршрута (правка 23.08, п. 5).
 *
 * Пара «блок ушёл из рабочего раздела» + «данные видны в админке» проверяется
 * с ОБЕИХ сторон намеренно. Правило проекта: legacy снимается только после
 * того, как опустеет блок совместимости, — а «убрали блок» и «потеряли записи»
 * в тесте одного экрана выглядят одинаково.
 */

const SUB = {
  id: 'old-1',
  stage_id: null,
  operation: 'Вышивка логотипа',
  contractor: 'ООО «Нитка»',
  phase: 'at_contractor',
  status: 'in_progress',
  order_id: 'o1',
  order: { title: 'Старый заказ', bitrix_id: '55646' },
};

const setup = (subcontracting) => {
  useErpStore.setState({ subcontracting });
  return render(
    <MemoryRouter><LegacySubcontractTab /></MemoryRouter>,
  );
};

beforeEach(() => {
  useErpStore.setState({ subcontracting: [] });
});

describe('Подряд без маршрута — вкладка технического контура', () => {
  it('показывает записи без stage_id: они не потеряны, а переехали', () => {
    setup([SUB]);
    expect(screen.getByText(/Старый заказ/)).toBeInTheDocument();
    expect(screen.getByText(/Вышивка логотипа/)).toBeInTheDocument();
    expect(screen.getByText(/ООО «Нитка»/)).toBeInTheDocument();
  });

  /**
   * Записи СО связью с маршрутом сюда не попадают: они и есть обычная работа
   * подряда, и дубль в техническом контуре означал бы, что список никогда
   * не опустеет, а вкладка никогда не исчезнет.
   */
  it('связанные с маршрутом операции не показывает', () => {
    setup([{ ...SUB, id: 'live', stage_id: 'st-1' }]);
    expect(screen.queryByText(/Старый заказ/)).toBeNull();
    expect(screen.getByText(/Операций подряда без маршрута нет/)).toBeInTheDocument();
  });
});

describe('hasLegacySubcontracts — под этот предикат заводится вкладка', () => {
  it('пустой список и записи с маршрутом долга не образуют', () => {
    expect(hasLegacySubcontracts([])).toBe(false);
    expect(hasLegacySubcontracts(null)).toBe(false);
    expect(hasLegacySubcontracts([{ stage_id: 'st-1' }])).toBe(false);
  });

  it('хотя бы одна запись без маршрута — долг есть', () => {
    expect(hasLegacySubcontracts([{ stage_id: 'st-1' }, { stage_id: null }])).toBe(true);
    // Колонки может не быть вовсе (урезанная выборка, старый кэш) —
    // отсутствие связи читается так же, как явный null
    expect(hasLegacySubcontracts([{}])).toBe(true);
  });
});
