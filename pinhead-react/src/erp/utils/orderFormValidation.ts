/**
 * Валидация формы создания заказа — с привязкой ошибок к полям.
 * Вынесена из `orderForm.ts` (08.10); снаружи читается через его реэкспорт.
 */

import { factoryToday } from '../../utils/date';
import { itemNeedsPurchase } from './garmentSource';
import { effectiveQty } from './orderFormGrid';
import { isItemEmpty, type DraftForm, type DraftItem } from './orderForm';

export interface OrderFormValidation {
  /** Ошибки по ключам полей: title, launch_date, due_date, item_{i}_product_type, item_{i}_qty, item_{i}_prints */
  errors: Record<string, string>;
  /** Короткие названия незаполненных полей — для строки «Осталось заполнить: …» */
  missing: string[];
  /**
   * Поля, которые заполнены, но неверно. Раньше они попадали в `missing`, и
   * восстановленный назавтра черновик с вчерашней датой запуска блокировал кнопку
   * подсказкой «Осталось заполнить: Дата запуска» — при заполненном поле.
   */
  invalid: string[];
}

/**
 * ЗНАЧИМЫЕ позиции формы: те, по которым спрашивают и проверяют.
 *
 * Правило дословно то же, каким `validateOrderForm` пропускает пустую
 * дополнительную строку. Вынесено, потому что читателей стало двое:
 * второй — `orderNeedsPurchase`, и на пустой строке (у неё тип производства
 * по умолчанию «Пошив») он ответил бы «закупка нужна» у заказа, где все
 * настоящие позиции давальческие.
 */
function meaningfulItems(items: DraftItem[]): DraftItem[] {
  if (items.length <= 1) return items;
  return items.filter((it) => !(isItemEmpty(it) && !it.has_branding));
}

/**
 * Нужна ли по заказу закупка (правки 07.09, п. 4).
 *
 * ДВА УСЛОВИЯ, И ВТОРОЕ НОВОЕ. Первое — отметка менеджера «Закупка
 * не требуется» (правка 20.08), свойство заказа. Второе — есть ли хоть одна
 * позиция, которую вообще надо покупать: у давальческого готового изделия
 * покупать нечего по построению, и требовать под него лист закупки значило бы
 * просить отметить галочкой то, что уже сказано выбором сценария. Ровно тот же
 * довод, по которому `buildItemRoute` вырезает у такой позиции этап «Закупка».
 *
 * Заказ БЕЗ позиций вовсе закупку требует: пустая форма не должна проходить
 * проверку листа закупки «потому что покупать нечего».
 */
export function orderNeedsPurchase(form: DraftForm, items: DraftItem[]): boolean {
  if (form.purchase_required === false) return false;
  const meaningful = meaningfulItems(items);
  if (meaningful.length === 0) return true;
  return meaningful.some((it) => itemNeedsPurchase(it));
}

export function validateOrderForm(
  form: DraftForm,
  items: DraftItem[],
  today: string = factoryToday(),
  /**
   * Приложен ли ФАЙЛ листа закупки (правки 20.08).
   *
   * БЫЛ ПЯТЫМ, СТАЛ ЧЕТВЁРТЫМ (правки 07.09, п. 14): между ним и `today`
   * стоял список строк-подсказок, а строк больше нет. Сдвиг безопасен —
   * вызывающих у функции два, оба в `CreateOrderModal`, и оба правятся тем же
   * коммитом; забытый вызывающий получил бы `hasPurchaseList = []`, то есть
   * истинное значение, и правило «лист либо отметка» замолчало бы. Сторож —
   * `orderForm.test.ts`, блок «лист закупки».
   */
  hasPurchaseList = false,
): OrderFormValidation {
  const errors: Record<string, string> = {};
  const missing: string[] = [];
  const invalid: string[] = [];

  if (!form.title.trim()) {
    errors.title = 'Укажите название заказа';
    missing.push('Название');
  }
  /**
   * ДАТА ЗАПУСКА В ПРОШЛОМ — НЕ ОШИБКА (правка заказчика 30.08, п. 10).
   *
   * Проверки здесь больше нет, и это не пропуск: заказ, запущенный в цеху
   * раньше, чем его завели в ERP, переносится задним числом, и прежнее
   * правило запрещало такой перенос совсем — вместе с `min` у поля. Дата
   * запуска описывает ФАКТ и участвует в расчёте сроков и в плане; момент
   * появления записи ведёт `created_at` и он не подменяется.
   *
   * У срока клиента правило остаётся: там прошедшая дата — ошибка ввода.
   */
  if (form.due_date && form.due_date < today) {
    errors.due_date = 'Срок клиента в прошлом — проверьте дату';
    invalid.push('Срок клиента');
  } else if (form.due_date && form.launch_date && form.due_date < form.launch_date) {
    /**
     * СРОК РАНЬШЕ ЗАПУСКА — противоречие, и проверить его стало нужно
     * ИМЕННО СЕЙЧАС (правка 30.08, п. 10). Пока прошедший запуск запрещался,
     * запуск был не раньше сегодняшнего дня, а срок — не раньше запуска
     * по построению: проверка ничего бы не поймала. Сняв ограничение, мы
     * открыли и опечатку «21.08» вместо «21.09» у заказа, запущенного
     * задним числом.
     *
     * Это же и есть участие даты запуска в расчёте сроков: от неё считается
     * подстановка плана этапа (`defaultPlannedEnd`), и срок, стоящий раньше
     * запуска, уехал бы в маршрут молча.
     */
    errors.due_date = 'Срок клиента раньше даты запуска — проверьте даты';
    invalid.push('Срок клиента');
  }

  items.forEach((it, i) => {
    // пустую дополнительную строку пропускаем (как раньше)
    if (items.length > 1 && isItemEmpty(it) && !it.has_branding) return;
    const pos = items.length > 1 ? ` (поз. ${i + 1})` : '';
    if (!it.product_type.trim()) {
      errors[`item_${i}_product_type`] = 'Укажите изделие';
      missing.push(`Изделие${pos}`);
    }
    if (!(effectiveQty(it) > 0)) {
      errors[`item_${i}_qty`] = 'Количество должно быть больше 0';
      missing.push(`Кол-во${pos}`);
    }
    if (it.has_branding && it.prints.length === 0) {
      errors[`item_${i}_prints`] = 'Добавьте хотя бы одно нанесение';
      missing.push(`Нанесения${pos}`);
    }
    /**
     * РАЗМЕР НАНЕСЕНИЯ — ЦЕЛЫЕ МИЛЛИМЕТРЫ (ошибка с боя 08.10): колонки
     * `erp_item_prints.width_mm/height_mm` — integer, и «1.4» в одном
     * нанесении из восемнадцати роняло создание всего заказа сырым
     * «invalid input syntax for type integer». Ошибка — у поля, до отправки.
     */
    it.prints.forEach((p, pi) => {
      const bad = [p.height_mm, p.width_mm]
        .map((v) => String(v ?? '').trim())
        .find((v) => v !== '' && !/^\d+$/.test(v));
      if (bad === undefined) return;
      errors[`item_${i}_print_${pi}_size`] = `Размер — целое число миллиметров (введено ${bad})`;
      invalid.push(`Размер нанесения №${pi + 1}${pos}`);
    });
    // Следующий участок после операции подряда. Раньше это была отдельная проверка
    // в сабмите с тостом: поле не подсвечивалось, автоскролл к нему не работал,
    // а само оно спрятано в глубине блока за двумя условиями.
    if (
      it.production_type === 'outsource'
      && (it.subcontract_kind ?? 'finished_product') === 'operation'
      && it.needs_further
      && !it.return_dept
    ) {
      errors[`item_${i}_return_dept`] = 'Выберите участок для доработки';
      missing.push(`Следующий участок${pos}`);
    }
  });

  /**
   * ОДНО ИЗ ДВУХ ОБЯЗАТЕЛЬНО (документ 20.08): либо приложен файл листа
   * закупки, либо явно отмечено «Закупка не требуется». «Если не выполнено
   * ни одно условие — заказ создать нельзя».
   *
   * Проверка стоит ЗДЕСЬ, а не в сабмите: только отсюда работают рамка,
   * `aria-invalid`, автоскролл и раскрытие секции. Тост для этого не годится —
   * правило волны UX-4.
   */
  if (orderNeedsPurchase(form, items) && !hasPurchaseList) {
    errors.purchase_list = 'Приложите лист закупки или отметьте «Закупка не требуется»';
    missing.push('Лист закупки');
  }

  return { errors, missing, invalid };
}
