/**
 * Персональные уведомления — «система позвала конкретного человека».
 *
 * ЗАЧЕМ ОТДЕЛЬНО ОТ `utils/notifications`. Тот модуль ВЫЧИСЛЯЕТ поводы
 * вмешаться из загруженных заказов (остановленный этап, просрочка,
 * дозакупка) — они одинаковы для всех и живут ровно столько, сколько длится
 * состояние. Здесь — ФАКТЫ с адресатом: «вас упомянули», «вам ответили».
 * Их нельзя пересчитать: событие произошло один раз, и у него есть
 * прочитанность.
 *
 * СЛАЙС В ЯДРЕ, а не в доменной части. Счётчик показывает колокол оболочки
 * (`layout/ErpLayout`), то есть до открытия любого экрана: доменный чанк
 * к этому моменту ещё не приехал.
 *
 * ПИСАТЕЛЯ У ТАБЛИЦЫ ПОКА НЕТ — им станет `erp_chat_send` в правке чата.
 * Загрузка при этом заводится сразу: она понадобится тем же днём, а завести
 * её потом значило бы переписывать оболочку ради одного запроса.
 */

import type { StateCreator } from 'zustand';
import { supabase } from '../../../lib/supabase';
import type { ErpNotification } from '../../types';
import { currentUserId, erpError, erpQuery, erpRead } from '../shared';
import { mergePopups, newPopups, seenIds } from '../../utils/noticePopups';
import type { ErpStore, NotificationsSlice } from '../types';

/** Сколько уведомлений держим в памяти: лента центра, а не архив */
const LIMIT = 50;

export const notificationsSlice: StateCreator<ErpStore, [], [], NotificationsSlice> = (
  set,
  get,
) => ({
  notifications: [],
  notificationsLoaded: false,
  noticePopups: [],
  noticeSeen: [],

  dismissNoticePopup: (id) => {
    set({ noticePopups: get().noticePopups.filter((n) => n.id !== id) });
  },

  loadNotifications: async () => {
    if (!currentUserId()) {
      /**
       * Без учётной записи спрашивать нечего: RLS отдаст пусто, а флаг
       * «загружено» поднять надо — иначе колокол будет ждать вечно.
       */
      set({
        notifications: [], notificationsLoaded: true, noticePopups: [], noticeSeen: [],
      });
      return;
    }
    const { data, error } = await erpRead(() => supabase
      .from('erp_notifications')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(LIMIT));
    if (error) {
      /**
       * Fail-open и МОЛЧА. Уведомления — вспомогательный сигнал: их отказ
       * не должен ни останавливать работу, ни выдавать полосу поверх экрана,
       * на который человек пришёл делать своё дело. Флаг поднимается, чтобы
       * оболочка не ждала ответа, которого не будет.
       */
      set({ notificationsLoaded: true });
      return;
    }
    const rows = (data ?? []) as ErpNotification[];
    /**
     * ВСПЛЫВАЮЩИЕ СЧИТАЮТСЯ ЗДЕСЬ, а не в оболочке: список перечитывается
     * целиком на каждый звонок realtime, и «что из этого новое» знает только
     * тот, кто держит предыдущий снимок. Первая загрузка сессии молчит —
     * иначе накопившееся за ночь высыпалось бы карточками при каждом входе
     * (разбор правила — в `utils/noticePopups`).
     */
    const first = !get().notificationsLoaded;
    const fresh = newPopups(rows, get().noticeSeen, first);
    set({
      notifications: rows,
      notificationsLoaded: true,
      noticeSeen: seenIds(rows),
      noticePopups: mergePopups(get().noticePopups, fresh),
    });

    /**
     * УВЕДОМЛЕНИЕ ОПЕРАЦИОННОЙ СИСТЕМЫ И ЗВУК (вторая очередь чата) — по тем
     * же событиям, что всплывающая карточка, и по одному разу. Оба выключены
     * по умолчанию; `notifyDesktop` сам молчит, когда вкладка на экране:
     * человек и так видит карточку внутри ERP, а дубль в углу экрана — это
     * два сообщения об одном событии.
     *
     * Звук звучит ТОЛЬКО вместе с показанным уведомлением: сигнал ниоткуда
     * заставляет искать, что произошло.
     *
     * Показываем ОДНО, даже если пришло три: три окна подряд в углу экрана
     * человек закрывает не читая.
     */
    /**
     * МОДУЛЬ ПОДТЯГИВАЕТСЯ ПО СОБЫТИЮ, а не статикой: `desktopNotify` несёт
     * синтез звука на WebAudio и разбор разрешений браузера, а нужен он
     * в редкий момент прихода уведомления. Статический импорт отправлял его
     * в критический путь ВСЕХ входов — слайс живёт в ядре стора, потому что
     * колокол стоит в оболочке.
     */
    const top = fresh[0];
    if (top) {
      void import('../../utils/desktopNotify').then(({ notifyDesktop, playPing }) => {
        if (notifyDesktop(top.title, top.body)) playPing();
      });
    }
  },

  /**
   * Отметить прочитанными. Оптимистично С ОТКАТОМ: человек уже уходит
   * по ссылке, и ждать ответа сервера, чтобы погасить счётчик, — значит
   * показывать «1» на экране, который он открыл.
   *
   * Уже прочитанные не перезаписываются: повторная отметка сдвинула бы
   * `read_at` и соврала о том, когда человек это увидел.
   */
  markNotificationsRead: async (ids) => {
    const fresh = get().notifications.filter((n) => ids.includes(n.id) && !n.read_at);
    if (fresh.length === 0) return true;
    const at = new Date().toISOString();
    const before = get().notifications;
    set({
      notifications: before.map((n) => (fresh.some((f) => f.id === n.id)
        ? { ...n, read_at: at }
        : n)),
      /**
       * Прочитанное со всплывающей карточки её и гасит: оставить висеть
       * то, по чему человек только что нажал, — предложить прочитать дважды.
       */
      noticePopups: get().noticePopups.filter((n) => !ids.includes(n.id)),
    });
    const { error } = await erpQuery(() => supabase
      .from('erp_notifications')
      .update({ read_at: at })
      .in('id', fresh.map((n) => n.id))
      .select());
    if (error) {
      set({ notifications: before });
      erpError('Не удалось отметить уведомления прочитанными', error);
      return false;
    }
    return true;
  },
});
