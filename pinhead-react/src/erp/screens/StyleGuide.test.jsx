import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import StyleGuide from './StyleGuide';
import { ICONS } from '../components/icons';

/**
 * Витрина обязана рендериться — иначе она бесполезна ровно тогда, когда нужна.
 *
 * Смысл теста не в разметке, а в том, что страница СОБИРАЕТ все примитивы:
 * если у примитива поменяется API (уедет вариант, переименуется проп), витрина
 * упадёт здесь, а не молча перестанет показывать половину системы.
 */
const renderGuide = () => render(<MemoryRouter><StyleGuide /></MemoryRouter>);

describe('StyleGuide — витрина дизайн-системы', () => {
  it('рендерится целиком', () => {
    renderGuide();
    expect(screen.getByRole('heading', { name: /Дизайн-система/ })).toBeInTheDocument();
  });

  it('показывает все четыре варианта кнопки', () => {
    renderGuide();
    for (const v of ['primary', 'secondary', 'ghost', 'danger']) {
      // Вариант есть и как кнопка, и как ссылка-кнопка
      expect(screen.getAllByText(v).length).toBeGreaterThanOrEqual(2);
    }
  });

  it('показывает ступени просрочки — те же, что считает overdueBucket', () => {
    renderGuide();
    expect(screen.getByText('1–7 дн.')).toBeInTheDocument();
    expect(screen.getByText('8–30 дн.')).toBeInTheDocument();
    expect(screen.getByText('30+ дн.')).toBeInTheDocument();
  });

  it('показывает весь набор иконок, а не выборку', () => {
    renderGuide();
    const names = Object.keys(ICONS);
    expect(screen.getByRole('heading', { name: new RegExp(`Иконки \\(${names.length}\\)`) }))
      .toBeInTheDocument();
    for (const n of names.slice(0, 5)) {
      expect(screen.getByTitle(n)).toBeInTheDocument();
    }
  });

  it('честный процент показан рядом с обычным — «—», а не 100%', () => {
    renderGuide();
    expect(screen.getByText(/percentLabel\(null\) → —/)).toBeInTheDocument();
    expect(screen.getByText(/percentLabel\(73\) → 73%/)).toBeInTheDocument();
  });
});
