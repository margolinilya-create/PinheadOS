import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { CutRollsSection } from './CutRollsSection';

/**
 * ИТОГ ЗАКРОЯ И ПЛЮСЫ (правки заказчика 21.09, пп. 3 и 4).
 *
 * П. 4 дословно: «текущая строка „Всего скроено: 50 шт · расход: 20 кг ·
 * XS 50 · размеры выбраны из стандартной шкалы: у позиции нет размерной
 * сетки" перегружена и непонятна. Техническое сообщение смешано
 * с производственным итогом».
 */

const ORDER = {
  id: 'o-1',
  materials: [{
    id: 'm-1',
    kind: 'fabric',
    name: 'кулирка',
    item_id: null,
    accept_status: 'accepted_full',
    rolls: [
      { id: 'r-1', seq: 1, label: 'Рулон №1', status: 'in_stock', qty: 20, length_m: 46.3, length_source: 'calc', kg_per_m: 0.432 },
      { id: 'r-2', seq: 2, label: 'Рулон №2', status: 'in_stock', qty: 20, length_m: 46.3, length_source: 'calc', kg_per_m: 0.432 },
    ],
  }],
};

const ITEM = { id: 'it-1', qty: 200, size_grid: [{ color: '—', sizes: { XS: 50 } }] };

const entry = (rollId, lengthUsedM, sizes) => ({
  rollId,
  lengthUsedM,
  finished: false,
  sizes: sizes.map(([size, qty]) => ({ size, color: '—', qty })),
});

function renderSection(props = {}) {
  return render(
    <CutRollsSection
      order={ORDER}
      item={ITEM}
      entries={[entry('r-1', 20, [['XS', 50]])]}
      onChange={vi.fn()}
      {...props}
    />,
  );
}

describe('итог закроя', () => {
  it('короткий итог — два числа, разбивка отдельной строкой', () => {
    renderSection();
    expect(screen.getByText(/Скроено:/)).toHaveTextContent('Скроено: 50 шт · Расход: 20,00 м');
    expect(screen.getByText(/По размерам:/)).toHaveTextContent('По размерам: XS — 50 шт');
  });

  it('технической фразы про стандартную шкалу в итоге нет', () => {
    renderSection();
    expect(screen.queryByText(/размеры выбраны из стандартной шкалы/)).not.toBeInTheDocument();
  });

  /**
   * «Если размерная сетка действительно отсутствует… показывать отдельное
   * предупреждение „Размерная сетка заказа не найдена", а не добавлять
   * технический текст в итог».
   */
  it('без сетки — отдельное предупреждение, а не приписка к итогу', () => {
    renderSection({ item: { id: 'it-1', qty: 200, size_grid: null } });
    expect(screen.getByText(/нет размерной сетки. Стандартные размеры не подставляются/)).toBeInTheDocument();
    expect(screen.getByText(/Скроено:/)).toHaveTextContent('Скроено: 50 шт · Расход: 20,00 м');
  });

  it('с заполненной сеткой предупреждения нет', () => {
    renderSection();
    expect(screen.queryByText(/нет размерной сетки/)).not.toBeInTheDocument();
  });
});

describe('производственный плюс', () => {
  /** Пример из документа: в заказе XS 50, скроено 55 → плюс 5 */
  it('скроено больше заказа — плюс показан отдельной строкой', () => {
    renderSection({ entries: [entry('r-1', 20, [['XS', 55]])] });
    expect(screen.getByText(/Плюс:/)).toHaveTextContent('Плюс: XS — 5 шт');
    // Фактический раскрой сохраняется целиком, а не срезается до плана
    expect(screen.getByText(/Скроено:/)).toHaveTextContent('Скроено: 55 шт');
  });

  it('скроено по заказу — строки плюса нет вовсе', () => {
    renderSection();
    expect(screen.queryByText(/Плюс:/)).not.toBeInTheDocument();
  });

  /** «Плюсы считать отдельно по каждому размеру и суммарно по позиции» */
  it('плюс по нескольким размерам показывает и разбивку, и сумму', () => {
    render(
      <CutRollsSection
        order={ORDER}
        item={{ id: 'it-1', qty: 80, size_grid: [{ color: '—', sizes: { XS: 50, S: 30 } }] }}
        entries={[entry('r-1', 20, [['XS', 52], ['S', 33]])]}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText(/Плюс:/)).toHaveTextContent('Плюс: XS — 2 шт · S — 3 шт · всего 5 шт');
  });

  /** Закрой сдаёт частями: 30 сегодня, 25 завтра при плане 50 — это плюс 5 */
  it('прежние сдачи учтены: плюс появляется на второй части', () => {
    renderSection({
      entries: [entry('r-2', 15, [['XS', 25]])],
      reported: { '—\u0000XS': 30 },
    });
    expect(screen.getByText(/Плюс:/)).toHaveTextContent('Плюс: XS — 5 шт');
  });

  it('у позиции без сетки плюсов не бывает — сравнивать не с чем', () => {
    renderSection({
      item: { id: 'it-1', qty: 200, size_grid: null },
      entries: [entry('r-1', 20, [['XS', 500]])],
    });
    expect(screen.queryByText(/Плюс:/)).not.toBeInTheDocument();
  });
});

/**
 * ЗАВЕРШЕНИЕ РУЛОНА — ОТДЕЛЬНО ОТ ЗАПИСИ РЕЗУЛЬТАТА (правка 05.10, п. 5):
 * «В форме смешаны выпуск, расход и завершение рулона». Галочки «Работа
 * по рулону закончена» и выбора судьбы в строке расхода больше нет;
 * у рулона в работе — своя кнопка «Завершить рулон», окно решает судьбу.
 */
describe('завершение рулона вынесено из формы', () => {
  const STAGE = { id: 's-cut', department_id: 'd-cut' };
  const orderWithPending = {
    ...ORDER,
    items: [{ id: 'it-1', stages: [{ id: 's-cut', status: 'in_progress', department_id: 'd-cut' }] }],
    materials: [{
      ...ORDER.materials[0],
      rolls: [
        { id: 'r-1', seq: 1, label: 'Рулон №1', status: 'in_use', qty: 20, qty_left: 5, leftover_kind: null, unit: 'кг' },
        { id: 'r-2', seq: 2, label: 'Рулон №2', status: 'in_stock', qty: 20, qty_left: 20, length_m: 46.3, length_source: 'calc', kg_per_m: 0.432 },
      ],
    }],
  };

  it('в строке расхода нет галочки завершения и выбора судьбы', () => {
    renderSection({ order: orderWithPending, stage: STAGE, onFinishRoll: vi.fn() });
    expect(screen.queryByText(/Работа по рулону закончена/)).not.toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  });

  it('рулон в работе — кнопка «Завершить рулон» открывает окно без предвыбора', () => {
    const onFinishRoll = vi.fn(async () => true);
    renderSection({
      order: orderWithPending, stage: STAGE, onFinishRoll,
      entries: [entry('r-2', 10, [['XS', 20]])],
    });
    const group = screen.getByRole('group', { name: 'Рулоны в работе' });
    expect(group).toHaveTextContent('Рулон №1');
    expect(group).toHaveTextContent('остаток 5 кг');
    fireEvent.click(within(group).getByRole('button', { name: 'Завершить рулон' }));
    const dialog = screen.getByRole('dialog', { name: /Завершить рулон — Рулон №1/ });
    for (const radio of within(dialog).getAllByRole('radio')) expect(radio).not.toBeChecked();
    fireEvent.click(within(dialog).getByRole('radio', { name: /Оставить пригодный остаток/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Завершить рулон' }));
    expect(onFinishRoll).toHaveBeenCalledWith('r-1', expect.objectContaining({ kind: 'usable', itemId: 'it-1' }));
  });

  it('без права завершать (нет обработчика) кнопки нет', () => {
    renderSection({ order: orderWithPending, stage: STAGE });
    expect(screen.queryByRole('button', { name: 'Завершить рулон' })).not.toBeInTheDocument();
  });
});

/**
 * ДАННЫЕ РУЛОНА В ЗАКРОЙКЕ (правка 05.10, п. 5): «номер, материал, цвет,
 * исходный метраж и откуда он взят, записанный расход, доступный остаток».
 * Сценарий заказчика: из рулона 111,11 м списали 40 — при следующем
 * открытии доступно 71,11; расход 100 м блокируется.
 */
describe('метраж рулона в строке расхода', () => {
  const ROLL = {
    id: 'r-9', seq: 9, label: 'Рулон №9', status: 'in_use', qty: 50,
    length_m: 111.11, length_source: 'calc', length_left_m: 71.11, kg_per_m: 0.45,
  };
  const order = {
    ...ORDER,
    materials: [{ ...ORDER.materials[0], color: 'чёрный', rolls: [ROLL] }],
  };

  it('исходный метраж с источником, записанный расход и доступно', () => {
    renderSection({ order, entries: [entry('r-9', '', [['XS', 10]])] });
    const info = screen.getByText(/Исходный метраж/);
    expect(info).toHaveTextContent('Исходный метраж 111,11 м (расчёт) · записано расходом 40,00 м · доступно 71,11 м');
    // Номер, материал и цвет — в подписи рулона
    expect(screen.getByRole('option', { name: /Рулон №9 · кулирка · чёрный/ })).toBeInTheDocument();
  });

  it('после записи останется — от доступного, а не от исходного', () => {
    renderSection({ order, entries: [entry('r-9', 40, [['XS', 10]])] });
    expect(screen.getByText(/после записи останется/)).toHaveTextContent('после записи останется 31,11 м');
  });

  it('поле расхода — «Расход сейчас, м»', () => {
    renderSection({ order, entries: [entry('r-9', '', [['XS', 10]])] });
    expect(screen.getByLabelText('Расход сейчас, м, строка 1')).toBeInTheDocument();
  });
});

/**
 * УЖЕ ЗАПИСАННЫЙ ВЫПУСК И НОВАЯ ПАРТИЯ — ОТДЕЛЬНО (правка 05.10, п. 5).
 */
describe('записанный выпуск по размерам', () => {
  it('у строки размера — сколько уже записано, в итоге — отдельной строкой', () => {
    renderSection({ reported: { '—\u0000XS': 30 } });
    expect(screen.getByText('записано 30')).toBeInTheDocument();
    expect(screen.getByText(/Записано ранее:/)).toHaveTextContent('Записано ранее: XS — 30 шт');
    expect(screen.getByText(/Эта запись/)).toHaveTextContent('Скроено: 50 шт');
  });
});

/**
 * ПЕРЕРАСХОД — ПРЕДЛОЖЕНИЕ УТОЧНИТЬ МЕТРАЖ (правка 28.09): «если измеренный
 * расход превышает расчётный запас, предложить уточнить метраж рулона
 * и подтвердить корректировку, затем сохранить расход». Прежде был только
 * отказ, а форма уточнения показывалась лишь рулону совсем без метража.
 */
describe('уточнение метража', () => {
  it('расход больше доступного — форма уточнения открывается сама', () => {
    renderSection({ entries: [entry('r-1', 50, [['XS', 50]])], onRollParams: vi.fn() });
    expect(screen.getByRole('group', { name: /Параметры рулона Рулон №1/ })).toBeInTheDocument();
    expect(screen.getByText(/Расход больше доступного/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Причина уточнения/)).toBeInTheDocument();
  });

  it('в пределах метража — уточнение по кнопке, а не всегда', () => {
    renderSection({ onRollParams: vi.fn() });
    expect(screen.queryByRole('group', { name: /Параметры рулона/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Уточнить метраж рулона' }));
    expect(screen.getByRole('group', { name: /Параметры рулона Рулон №1/ })).toBeInTheDocument();
  });

  it('рядом с доступным метражом — цена за метр, только для чтения', () => {
    renderSection({
      order: { ...ORDER, materials: [{ ...ORDER.materials[0], price_per_unit: 950 }] },
    });
    expect(screen.getByText(/410,40 ₽\/м/)).toBeInTheDocument();
  });
});

/**
 * ТКАНЬ ПРИНЯТА БЕЗ РУЛОНОВ (правка 01.10, п. 1): закрой говорит, почему
 * расход записать не с чего и кто это снимает, — без ложного «сдайте числом».
 */
describe('нет рулонов', () => {
  it('ткань принята общим весом — «Ткань принята без разбивки по рулонам»', () => {
    renderSection({
      order: { ...ORDER, materials: [{ ...ORDER.materials[0], rolls: [] }] },
      entries: [],
    });
    expect(screen.getByRole('status')).toHaveTextContent('Ткань принята без разбивки по рулонам');
    expect(screen.getByRole('status')).not.toHaveTextContent(/сдать числом/);
  });

  it('ткань ещё не принята — ждём приёмку', () => {
    renderSection({
      order: { ...ORDER, materials: [{ ...ORDER.materials[0], accept_status: null, rolls: [] }] },
      entries: [],
    });
    expect(screen.getByRole('status')).toHaveTextContent(/ещё не принял ткань/);
  });
});
