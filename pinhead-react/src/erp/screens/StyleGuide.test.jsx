import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import StyleGuide from './StyleGuide';
import { ICONS } from '../components/icons';
import { MECHANISMS } from './styleguide/mechanisms';

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

/**
 * РАЗДЕЛЫ-МЕХАНИЗМЫ — приём с bencho.dev: параметры объявлены декларативно,
 * ручки рисуются из объявления.
 *
 * Сторож держит ровно то, ради чего каталог и заведён: НОВЫЙ механизм
 * появляется на витрине САМ, и забыть дорисовать его нельзя. Перечисление
 * разделов по именам тут было бы тем же белым списком, от которого проект
 * уже уходил у вариантов `Badge`.
 */
describe('StyleGuide — механизмы из каталога', () => {
  it('каталог не пуст — иначе проверки ниже обходят пустоту', () => {
    expect(MECHANISMS.length).toBeGreaterThan(2);
  });

  it.each(MECHANISMS.map((m) => [m.title, m]))('«%s» есть на витрине', (title) => {
    renderGuide();
    expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
  });

  it('у каждого механизма объявлены id, заголовок и компонент', () => {
    for (const m of MECHANISMS) {
      expect(m.id, `${m.title}: нет id`).toBeTruthy();
      expect(m.title, `${m.id}: нет заголовка`).toBeTruthy();
      expect(typeof m.Demo, `${m.id}: Demo не компонент`).toBe('function');
      expect(Array.isArray(m.params), `${m.id}: params не массив`).toBe(true);
    }
  });

  /**
   * У КАЖДОЙ РУЧКИ ОБЪЯВЛЕН ВИД И ЗНАЧЕНИЕ ПО УМОЛЧАНИЮ. Без `default`
   * состояние стартует с `undefined`, и управляемое поле демонстрации
   * молча становится неуправляемым — React об этом только предупреждает.
   */
  it('у каждой ручки объявлены kind, label и default', () => {
    const kinds = new Set(['range', 'choice', 'toggle']);
    for (const m of MECHANISMS) {
      for (const p of m.params) {
        expect(kinds.has(p.kind), `${m.id}/${p.id}: неизвестный kind «${p.kind}»`).toBe(true);
        expect(p.label, `${m.id}/${p.id}: нет label`).toBeTruthy();
        expect(p.default, `${m.id}/${p.id}: нет default`).not.toBeUndefined();
        if (p.kind === 'choice') {
          expect(p.options, `${m.id}/${p.id}: choice без options`).toBeTruthy();
          expect(p.options, `${m.id}/${p.id}: default вне options`).toContain(p.default);
        }
        if (p.kind === 'range') {
          expect(p.default >= p.min && p.default <= p.max,
            `${m.id}/${p.id}: default вне диапазона`).toBe(true);
        }
      }
    }
  });

  it('ручка-ползунок МЕНЯЕТ значение, а не только рисуется', () => {
    renderGuide();
    // Шаг степпера: 1 по умолчанию, крутим на 4 и проверяем, что шаг дошёл
    const step = screen.getByLabelText(/^Шаг/);
    fireEvent.change(step, { target: { value: '4' } });

    const plus = screen.getByRole('button', { name: 'Увеличить' });
    fireEvent.pointerDown(plus);
    // Начальное значение демонстрации — 3, шаг 4 → 7
    expect(screen.getByLabelText('Демонстрация числового поля')).toHaveValue(7);
  });

  it('ручка-переключатель МЕНЯЕТ подпись действия у протяжки', () => {
    renderGuide();

    /*
     * ⚠️ ИМЯ «Завершить» НЕОДНОЗНАЧНО: его несут и чип-ручка, и сам трек.
     * Различает их не текст, а СОСТОЯНИЕ: чип-переключатель обязан нести
     * `aria-pressed` (правило проекта о `FilterChip`), у трека его нет.
     * Первая редакция искала по имени и падала на «found multiple elements» —
     * то есть проверяла бы неизвестно что, если бы прошла.
     */
    const trackOf = (name) => screen
      .getAllByRole('button', { name })
      .find((el) => !el.hasAttribute('aria-pressed'));

    expect(trackOf('Завершить')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'В переделку', pressed: false }));

    // Трек переименовался: доступное имя — это ДЕЙСТВИЕ, а не жест
    expect(trackOf('В переделку')).toBeTruthy();
    expect(trackOf('Завершить')).toBeUndefined();
  });
});
