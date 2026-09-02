import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DevFinalPackage } from './DevFinalPackage';

/**
 * Финальный этап разработки после правок заказчика 24.08 (пп. 4.5 и 4.6).
 *
 * ЧТО ИМЕННО СТОРОЖИТСЯ. Правило («что обязательно») живёт в
 * `utils/finalPackage` и проверено там же вместе с серверным стражем.
 * Здесь — то, чего чистая функция не видит: что форма СПРАШИВАЕТ ровно
 * это, а не что-то соседнее. Дефект «поле пишется, но нигде не читается»
 * (и обратный ему) в проекте уже случался четырежды за одну сверку.
 */

const DEV = {
  id: 'e1',
  pattern_tech_name: 'PH-HOODIE-01',
  pattern_version: 'v1.2',
  // Правка 30.08, п. 4: условий завершения ДВА — образец и техдокументация.
  // Фикстура «собранного пакета» обязана нести оба, иначе она проверяет
  // не то состояние, которое называет
  sample_approved_at: '2026-08-28T10:00:00Z',
  final_package: {},
  outcome: null,
};

function setup(devPatch = {}, attachments = [], canManage = true) {
  const onUpdate = vi.fn(async () => true);
  const onReady = vi.fn(async () => true);
  render(
    <DevFinalPackage
      dev={{ ...DEV, ...devPatch }}
      attachments={attachments}
      canManage={canManage}
      onUpdate={onUpdate}
      onUpload={vi.fn()}
      onRemoveFile={vi.fn()}
      onReady={onReady}
    />,
  );
  return { onUpdate, onReady };
}

const FILES = [
  { id: 'a1', kind: 'dev_passport', file_name: 'passport.pdf' },
  { id: 'a2', kind: 'dev_photo', file_name: 'sample.jpg' },
];

describe('финальный этап: обязательная техдокументация (п. 4.5)', () => {
  it('спрашивает ровно четыре обязательных поля документа', () => {
    setup();
    expect(screen.getByLabelText('Техническое название лекал')).toBeInTheDocument();
    expect(screen.getByLabelText('Версия лекал')).toBeInTheDocument();
    expect(screen.getByLabelText('Технический паспорт')).toBeInTheDocument();
    expect(screen.getByLabelText('Фото утверждённого образца')).toBeInTheDocument();
  });

  /**
   * «Комментарии и особенности производства при необходимости» — поле есть,
   * но в перечне недостающего его нет. Проверяем оба конца: без него пакет
   * считается полным.
   */
  it('комментарии производства спрашиваются, но завершению не мешают', () => {
    setup({}, FILES);
    expect(screen.getByLabelText('Комментарии и особенности производства'))
      .toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Завершить разработку' })).toBeEnabled();
  });

  /**
   * «ПОЛЕ „ФАЙЛ ЛЕКАЛ ИЛИ ССЫЛКА" НЕ НУЖНО». Сторожим отсутствие ВВОДА
   * поимённо: вернувшееся поле снова закрыло бы завершение разработки тем,
   * что заказчик просил убрать.
   */
  it('ввода лекал нет — ни файлом, ни ссылкой', () => {
    setup({}, FILES);
    expect(screen.queryByLabelText('Ссылка на лекала')).toBeNull();
    expect(screen.queryByLabelText('Файл лекал')).toBeNull();
  });

  /**
   * ПОКАЗ ПРИЛОЖЕННОГО РАНЬШЕ ОСТАЁТСЯ. На проде 24.08 лежат один файл лекал
   * и две ссылки: исчезнувший файл читался бы как потеря данных.
   */
  it('лекала, приложенные раньше, показываются на чтение', () => {
    setup(
      { final_package: { pattern_link: 'https://disk/patterns' } },
      [...FILES, { id: 'a3', kind: 'dev_pattern', file_name: 'lekala.dxf' }],
    );
    expect(screen.getByText(/Лекала \(приложены ранее\)/)).toBeInTheDocument();
    expect(screen.getByText('https://disk/patterns')).toBeInTheDocument();
    expect(screen.getByText(/lekala\.dxf/)).toBeInTheDocument();
  });

  it('у новой разработки блока лекал нет вовсе', () => {
    setup({}, FILES);
    expect(screen.queryByText(/Лекала \(приложены ранее\)/)).toBeNull();
  });

  it('кнопка названа словом документа и объясняет исход', () => {
    setup({}, FILES);
    expect(screen.getByRole('button', { name: 'Завершить разработку' })).toBeInTheDocument();
    expect(screen.getByText(/закроется как «Готово к серии»/)).toBeInTheDocument();
  });
});

describe('переключатель «Добавить модель в каталог SKU» (п. 4.6)', () => {
  const toggle = () => screen.getByLabelText('Добавить модель в каталог SKU');

  it('по умолчанию выключен, и полей карточки на экране нет', () => {
    setup({}, FILES);
    expect(toggle()).not.toBeChecked();
    expect(screen.queryByLabelText('Описание')).toBeNull();
    expect(screen.queryByLabelText('Доступные ткани')).toBeNull();
    expect(screen.queryByLabelText('Ценовая вилка от')).toBeNull();
  });

  /**
   * ГЛАВНОЕ ИЗМЕНЕНИЕ: «если переключатель выключен, технолог заполняет
   * ТОЛЬКО обязательную техническую документацию и завершает разработку».
   * До правки такая разработка не закрывалась вовсе.
   */
  it('выключен — техдокументации достаточно для завершения', () => {
    setup({}, FILES);
    expect(screen.getByRole('button', { name: 'Завершить разработку' })).toBeEnabled();
    expect(screen.getByText(/Пакет заполнен/)).toBeInTheDocument();
  });

  it('включён — карточка раскрывается и снова держит кнопку', () => {
    setup({ final_package: { add_to_sku: true } }, FILES);
    expect(toggle()).toBeChecked();
    expect(screen.getByLabelText('Описание')).toBeInTheDocument();
    expect(screen.getByLabelText('Ценовая вилка от')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Завершить разработку' })).toBeDisabled();
    expect(screen.getByText('Описание изделия')).toBeInTheDocument();
  });

  it('переключение пишется в пакет, а не в соседнее поле', () => {
    const { onUpdate } = setup({}, FILES);
    fireEvent.click(toggle());
    expect(onUpdate).toHaveBeenCalledWith('e1', { final_package: { add_to_sku: true } });
  });

  it('без права раздела переключатель не трогается', () => {
    setup({}, FILES, false);
    expect(toggle()).toBeDisabled();
  });

  /**
   * Знаменатель прогресса считается В ТОМ ЖЕ РЕЖИМЕ: «5 / 12» на собранной
   * техдокументации врало бы ровно там, где человек ждёт подтверждения,
   * что всё готово.
   */
  it('прогресс считается по своему режиму', () => {
    setup({}, FILES);
    expect(screen.getByText('5 / 5')).toBeInTheDocument();
  });
});

/**
 * ТЕХНИЧЕСКОЕ НАЗВАНИЕ ЛЕКАЛ ПОДТЯГИВАЕТСЯ (правки заказчика 02.09, п. 4).
 *
 * «Поле не заполняется повторно. Значение автоматически подтягивается
 * из этапа „Построение лекал“». Колонка одна на оба места, и подстановка
 * работала — не работало объяснение: заполненное поле среди пустых читается
 * как «кто-то ввёл, надо проверить», а пустое — как «поле новое, вводите».
 */
describe('техническое название лекал', () => {
  it('подставлено значением разработки и подписано источником', () => {
    setup();
    expect(screen.getByLabelText('Техническое название лекал')).toHaveValue('PH-HOODIE-01');
    expect(screen.getByText(/Подтянуто с этапа «Построение лекал»/)).toBeInTheDocument();
  });

  it('пустое поле говорит, что на этапе лекал его не записали', () => {
    setup({ pattern_tech_name: null });
    expect(screen.getByLabelText('Техническое название лекал')).toHaveValue('');
    expect(screen.getByText(/На этапе «Построение лекал» не записано/)).toBeInTheDocument();
    // Подпись про подстановку при пустом значении была бы неправдой
    expect(screen.queryByText(/Подтянуто с этапа/)).not.toBeInTheDocument();
  });
});
