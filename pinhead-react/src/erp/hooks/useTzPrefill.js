import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { loadAllCatalogs } from '../../lib/catalogs';
import { erpQuery } from '../store/shared';
import { toast } from '../../store/useToastStore';
import { factoryToday } from '../../utils/date';
import { tzToOrderForm } from '../utils/tzBridge';
import { findColorEntry } from '../../data/colors';

/**
 * Приём ТЗ в производстве: `/orders?fromTz=<id>` → черновик формы заказа.
 *
 * Вторая половина моста. Первая — кнопка «В производство» в Order Studio,
 * которая НЕ создаёт заказ, а переводит человека сюда: так у создания заказа
 * остаётся один путь со всей его валидацией, конструктором маршрута и правилом
 * «правка человека или расчёт».
 *
 * Возвращает `{ state, prefill, tz }`:
 *   · `loading` — идут ТЗ и каталоги (форму открывать рано: она откроется
 *     пустой, а данные приедут после — человек уже начнёт печатать);
 *   · `ready`   — есть чем заполнить форму;
 *   · `error`   — ТЗ не прочиталось. Молча открывать пустую форму нельзя:
 *     человек нажал «В производство» и вправе знать, что перенос не состоялся;
 *   · `done`    — по этому ТЗ заказ уже создан, показываем ссылку, а не форму.
 *
 * Каталоги нужны, чтобы код цвета, ткани, отделки и зоны превратились
 * в названия: в ТЗ они хранятся кодами, а цех читает слова.
 */
export function useTzPrefill(tzOrderId) {
  /**
   * Состояние ВЫЧИСЛЯЕТСЯ из результата, а не хранится отдельной фазой.
   * Отдельная фаза потребовала бы `setState` прямо в теле эффекта (сброс
   * в «загружаем» при смене ТЗ) — то, что ловит react-hooks и что в этом
   * проекте уже давало рассинхрон состояния с данными.
   */
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (!tzOrderId) return undefined;
    // Alive-гард: человек может уйти с экрана раньше ответа
    let alive = true;

    (async () => {
      const [{ data, error }, catalogs] = await Promise.all([
        // maybeSingle, а не single: отсутствие строки — это «ТЗ не нашлось»
        // (или его не видно по RLS), а не ошибка запроса
        erpQuery(() => supabase.from('orders').select('*').eq('id', tzOrderId).maybeSingle()),
        loadAllCatalogs().catch(() => ({})),
      ]);
      if (!alive) return;

      if (error || !data) {
        setResult({ id: tzOrderId, kind: 'error' });
        toast.error(error
          ? `Не удалось прочитать ТЗ: ${error.message}`
          : 'ТЗ не найдено — возможно, оно удалено или недоступно вам');
        return;
      }

      if (data.erp_order_id) {
        setResult({ id: tzOrderId, kind: 'done', tz: data });
        return;
      }

      const built = tzToOrderForm(data, {
        skuCatalog: catalogs.skuCatalog,
        trimCatalog: catalogs.trimCatalog,
        fabricsCatalog: catalogs.fabricsCatalog,
        zonesCatalog: catalogs.zonesCatalog,
        findColor: findColorEntry,
      }, factoryToday());
      setResult({
        id: tzOrderId,
        kind: 'ready',
        tz: data,
        prefill: { ...built, tzOrderId: data.id, tzNumber: data.order_number ?? null },
      });
    })();

    return () => { alive = false; };
  }, [tzOrderId]);

  if (!tzOrderId) return { state: 'idle', prefill: null, tz: null };
  // Результат от ПРЕДЫДУЩЕГО ТЗ читается как «ещё загружаем»: иначе при смене
  // адреса форма секунду показывала бы данные чужого задания
  if (!result || result.id !== tzOrderId) return { state: 'loading', prefill: null, tz: null };
  return { state: result.kind, prefill: result.prefill ?? null, tz: result.tz ?? null };
}

/**
 * Обратная ссылка «ТЗ → производственный заказ».
 *
 * Пишется ПОСЛЕ создания заказа и намеренно не считается критичной: правда
 * живёт в `erp_orders.tz_order_id` с уникальным индексом, а эта колонка —
 * подсказка интерфейсу. Не записалась — человек увидит кнопку ещё раз,
 * и повтор упрётся в 23505 с внятным объяснением, а не заведёт второй заказ.
 *
 * `.select()` обязателен: RLS на UPDATE запрещает через `USING`, то есть
 * отдаёт «обновлено 0 строк», а не ошибку. Без него зелёный ответ означал бы
 * «записал» там, где не записано ничего.
 */
export async function linkTzToOrder(tzOrderId, erpOrderId) {
  const { data, error } = await erpQuery(() => supabase
    .from('orders')
    .update({ erp_order_id: erpOrderId })
    .eq('id', tzOrderId)
    .select('id'));
  if (error || !data || data.length === 0) {
    console.warn('[tz-bridge] обратная ссылка не записана', error?.message);
    return false;
  }
  return true;
}
