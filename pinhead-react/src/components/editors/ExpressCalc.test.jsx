import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ExpressCalc from './ExpressCalc';
import { useStore } from '../../store/useStore';
import { SKU_CATALOG_DEFAULT } from '../../data';

const DEFAULT_SKUS = SKU_CATALOG_DEFAULT;

function renderExpress() {
  return render(
    <MemoryRouter>
      <ExpressCalc />
    </MemoryRouter>,
  );
}

const pick = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const zone = (name) => screen.getByRole('region', { name: new RegExp(name) });
const radio = (scope, group, name) => within(within(scope).getByRole('radiogroup', { name: group })).getByRole('radio', { name });
const total = () => screen.getByRole('status');

beforeEach(() => {
  useStore.setState({ usdRate: 90, skuCatalog: DEFAULT_SKUS });
});

describe('ExpressCalc — шапка и поля', () => {
  it('заголовок страницы — «Экспресс-расчёт», без логотипа и «EXPRESS»', () => {
    renderExpress();
    expect(screen.getByRole('heading', { level: 1, name: 'Экспресс-расчёт' })).toBeInTheDocument();
    expect(screen.queryByText(/EXPRESS/)).not.toBeInTheDocument();
    expect(document.querySelector('svg.logo-mark, .logo')).toBeNull();
  });

  it('поля подписаны и связаны с контролом; тираж по умолчанию 100', () => {
    renderExpress();
    expect(screen.getByLabelText('Изделие').tagName).toBe('SELECT');
    expect(screen.getByLabelText('Ткань').tagName).toBe('SELECT');
    expect(screen.getByLabelText('Тираж, шт')).toHaveValue(100);
  });

  it('пустое состояние до выбора изделия', () => {
    renderExpress();
    expect(screen.getByText('Выберите изделие')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('инлайн-стилей в разметке нет', () => {
    const { container } = renderExpress();
    pick('Изделие', 'T-003');
    expect(container.querySelectorAll('[style]')).toHaveLength(0);
  });
});

describe('ExpressCalc — суммы старого экрана, цена за штуку вверх до 5 ₽ (обход, M-3)', () => {
  it('футболка, кулирка, спина DTF A3, две обработки, 40 шт → 84 200 ₽', () => {
    renderExpress();
    pick('Изделие', 'T-003');
    pick('Ткань', 'medas-kulirnaya-100-160');
    expect(within(total()).getByText('127 000 ₽')).toBeInTheDocument();

    fireEvent.click(within(screen.getByRole('group', { name: 'Зоны нанесения' })).getByRole('button', { name: 'Спина' }));
    fireEvent.click(radio(zone('Спина'), 'Техника', 'DTF'));
    fireEvent.click(radio(zone('Спина'), 'Формат', 'A3'));
    expect(within(total()).getByText('176 000 ₽')).toBeInTheDocument();

    const extras = screen.getByRole('group', { name: 'Обработки' });
    fireEvent.click(within(extras).getByRole('button', { name: /Петля для вешалки/ }));
    fireEvent.click(within(extras).getByRole('button', { name: /Двойная отстрочка/ }));
    pick('Тираж, шт', '40');

    expect(total()).toHaveTextContent('Итого за 40 шт');
    expect(within(total()).getByText('84 200 ₽')).toBeInTheDocument();
    expect(screen.getByText('Нанесение × 2 зоны')).toBeInTheDocument();
    expect(screen.getByText('2 105 ₽')).toBeInTheDocument();
  });
});

describe('ExpressCalc — доступный выбор параметров', () => {
  it('выбранный вариант — aria-checked; стрелки двигают выбор и фокус', () => {
    renderExpress();
    pick('Изделие', 'T-003');
    const front = zone('Лицевая сторона|Грудь');
    const a4 = radio(front, 'Формат', 'A4');
    expect(a4).toHaveAttribute('aria-checked', 'true');
    expect(a4).toHaveAttribute('tabindex', '0');
    expect(radio(front, 'Формат', 'A3')).toHaveAttribute('tabindex', '-1');

    a4.focus();
    fireEvent.keyDown(a4, { key: 'ArrowRight' });
    const a3 = radio(front, 'Формат', 'A3');
    expect(a3).toHaveAttribute('aria-checked', 'true');
    expect(a3).toHaveFocus();
    fireEvent.keyDown(a3, { key: 'End' });
    expect(radio(front, 'Формат', 'Max')).toHaveAttribute('aria-checked', 'true');
  });

  it('техника — радиогруппа; вышивка показывает «Область» и «Нити»', () => {
    renderExpress();
    pick('Изделие', 'T-003');
    const front = zone('Лицевая сторона|Грудь');
    fireEvent.click(radio(front, 'Техника', 'Вышивка'));
    expect(radio(front, 'Техника', 'Вышивка')).toHaveAttribute('aria-checked', 'true');
    expect(radio(front, 'Область', 'до 7 см')).toHaveAttribute('aria-checked', 'true');
    expect(within(front).getByRole('radiogroup', { name: 'Нити' })).toBeInTheDocument();
    expect(within(front).queryByRole('radiogroup', { name: 'Формат' })).not.toBeInTheDocument();
  });

  it('обработка — кнопка с aria-pressed, выбирается с клавиатуры; цена «+15 ₽/шт»', () => {
    renderExpress();
    pick('Изделие', 'T-003');
    const btn = within(screen.getByRole('group', { name: 'Обработки' })).getByRole('button', { name: /Петля для вешалки/ });
    expect(btn.tagName).toBe('BUTTON');
    expect(btn).toHaveAttribute('aria-pressed', 'false');
    expect(btn).toHaveTextContent('+15 ₽/шт');
    btn.focus();
    fireEvent.click(btn); // Enter/Space у нативной <button> — тот же click
    expect(btn).toHaveAttribute('aria-pressed', 'true');
  });

  it('последнюю включённую зону не выключить', () => {
    renderExpress();
    pick('Изделие', 'T-003');
    const zones = screen.getByRole('group', { name: 'Зоны нанесения' });
    const on = within(zones).getAllByRole('button').filter((b) => b.getAttribute('aria-pressed') === 'true');
    expect(on).toHaveLength(1);
    expect(on[0]).toBeDisabled();
  });

  it('склонение: «Нанесение × 5 зон»', () => {
    useStore.setState({
      skuCatalog: [{ ...DEFAULT_SKUS[2], code: 'Z-5', zones: ['front', 'back', 'sleeve-l', 'sleeve-r', 'chest'] }],
    });
    renderExpress();
    pick('Изделие', 'Z-5');
    const zones = screen.getByRole('group', { name: 'Зоны нанесения' });
    for (const name of ['Спина', 'Лев. рукав', 'Прав. рукав', 'Грудь']) {
      fireEvent.click(within(zones).getByRole('button', { name }));
    }
    expect(screen.getByText('Нанесение × 5 зон')).toBeInTheDocument();
  });
});
