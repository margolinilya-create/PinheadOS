/**
 * ПЕРЕЧИТЫВАНИЕ ПОСЛЕ РАЗРЫВА РЕАЛТАЙМА — вынесено из `realtimeSlice`
 * (ратчет размера: новый модуль ≤ 500 строк, правка 01.10, п. 4)
 * и подмешивается в него: контракт `RealtimeSlice` не меняется.
 */
import { flushQueue } from '../offlineQueue';
import type { ErpStore, RealtimeSlice } from '../types';

type Set = (partial: Partial<ErpStore>) => void;
type Get = () => ErpStore;

/**
 * Перечитать данные после разрыва.
 *
 * Зовётся из трёх мест: возврат вкладки, появление сети, восстановление
 * канала. Всё это — «мы не знаем, что произошло, пока нас не было», и ответ
 * один: спросить сервер заново. `loadAll` намеренно без guard'а от повторного
 * вызова (правило в `ordersSlice`), поэтому лишний вызов безопаснее пропуска.
 */
export function resyncRealtime(set: Set, get: Get): RealtimeSlice['resyncRealtime'] {
  return async () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    // Уже перечитываем — второй запуск дал бы второй полный loadAll
    if (get().realtimeResyncing) return;
    set({ realtimeResyncing: true });
    try {
      /**
       * Сначала отдать накопленное, потом читать. Обратный порядок показал бы
       * человеку состояние БЕЗ его же приёмок, сделанных без связи, — и он
       * ввёл бы их заново, теперь уже вторым приходом.
       */
      await flushQueue();
      /**
       * Колокол — тоже «пока нас не было» (правка 01.10, п. 4: «новые
       * уведомления приходят без перезагрузки ERP»). Упоминание, пришедшее
       * в разрыв канала, иначе ждало бы следующего события или F5. Дублей
       * это не даёт: «что новое» решает накопительный `noticeSeen`, а звук
       * между вкладками — захват события. Не ждём: колокол не должен
       * задерживать полосу «обновляем» над заказами.
       */
      void get().loadNotifications();
      await get().loadAll();
      set({ realtimeLive: true });
    } finally {
      // В `finally`: сбой перезагрузки не должен оставить полосу «обновляем…»
      // навсегда — это ровно тот вечный индикатор, от которого её и ставят
      set({ realtimeResyncing: false });
    }
  };
}
