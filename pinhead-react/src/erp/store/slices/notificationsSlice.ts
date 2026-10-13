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
 * Писатель таблицы — `erp_chat_send` (упоминание, ответ, «все сообщения»).
 *
 * ПРОЧИТАННОСТЬ СТАВИТ ПОКАЗ СООБЩЕНИЯ, А НЕ КОЛОКОЛ (правка 01.10, п. 4):
 * «открытие колокольчика не отмечает сообщение прочитанным: это происходит,
 * когда сотрудник увидел его в чате». Гасит сервер — `erp_chat_mark_seen`,
 * — а здесь `noteMessagesSeen` лишь повторяет это в памяти, чтобы счётчик
 * упал сразу, без второго запроса.
 */

import type { StateCreator } from 'zustand';
import { supabase } from '../../../lib/supabase';
import type { ErpNotification } from '../../types';
import { currentUserId, erpError, erpQuery, erpRead } from '../shared';
import { mergePopups, newPopups, seenIds } from '../../utils/noticePopups';
import { openNoticeLink } from '../../utils/noticeNav';
import { storageGet, storageGetRaw, storageSet } from '../../../lib/storage';
import type { ErpStore, NotificationsSlice, NoticeSettings } from '../types';

/** Сколько уведомлений держим в памяти: лента центра, а не архив */
const LIMIT = 50;

/**
 * Колонки ленты — поимённо: `user_id` не читает никто (адресата отбирает RLS,
 * и в ленте всегда «я»). Новые колонки таблицы не поедут в колокол сами.
 * Имена сверяются со снимком схемы (`store/sliceColumns.test.ts`).
 */
export const NOTIFICATION_COLUMNS =
  'id, kind, order_id, title, body, link, message_id, created_at, read_at';

/**
 * Умолчание настроек — ТО ЖЕ, что у колонок `erp_user_settings`: строки нет,
 * значит человек ничего не выбирал, и показывать надо ровно то, что база
 * подставила бы при вставке.
 */
const DEFAULT_SETTINGS: NoticeSettings = { sound: true, desktop: false };

/**
 * Кэш настроек на устройстве — ТОЛЬКО КЭШ: первый кадр до ответа сервера
 * и запасной путь при его отказе. Помечен учётной записью: на общем
 * планшете чужой выбор звука следующей смене не принадлежит.
 */
const SETTINGS_KEY = 'erp_notice_settings';

interface CachedSettings extends NoticeSettings { user: string }

function cachedSettings(user: string): NoticeSettings | null {
  const c = storageGet<CachedSettings>(SETTINGS_KEY);
  if (c && c.user === user) return { sound: Boolean(c.sound), desktop: Boolean(c.desktop) };
  /**
   * До 01.10 выбор жил в двух ключах устройства. Пока у человека нет строки
   * в базе, он — лучшая подсказка о его желании, чем умолчание; при первом
   * же переключении настройка уедет в базу.
   */
  const sound = storageGetRaw('erp_chat_sound');
  const desktop = storageGetRaw('erp_chat_desktop_notify');
  if (sound == null && desktop == null) return null;
  return {
    sound: sound == null ? DEFAULT_SETTINGS.sound : sound === '1',
    desktop: desktop === '1',
  };
}

const cacheSettings = (user: string, v: NoticeSettings) => {
  storageSet(SETTINGS_KEY, { user, ...v });
};

/**
 * Сколько непрочитанных — ЧИСЛОМ С СЕРВЕРА, а не длиной загруженного списка:
 * лента держит 50 строк, а непрочитанных бывает больше. «Счётчики должны
 * показывать реальное число непрочитанных» (правка 01.10, п. 4). `head: true`
 * — без строк, только `count`; адресата ограничивает политика чтения.
 */
const unreadCountQuery = () => supabase
  .from('erp_notifications')
  .select('id', { count: 'exact', head: true })
  .is('read_at', null);

export const notificationsSlice: StateCreator<ErpStore, [], [], NotificationsSlice> = (
  set,
  get,
) => ({
  notifications: [],
  notificationsLoaded: false,
  noticePopups: [],
  noticeSeen: [],
  notificationsUnread: 0,
  noticeSettings: DEFAULT_SETTINGS,
  noticeSettingsLoaded: false,

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
        notifications: [],
        notificationsLoaded: true,
        noticePopups: [],
        noticeSeen: [],
        notificationsUnread: 0,
      });
      return;
    }
    const [{ data, error }, counted] = await Promise.all([
      erpRead(() => supabase
        .from('erp_notifications')
        .select(NOTIFICATION_COLUMNS)
        .order('created_at', { ascending: false })
        .limit(LIMIT)),
      // Счёт — отдельным запросом и fail-open: его отказ не должен
      // лишать человека самой ленты
      erpRead(unreadCountQuery) as Promise<{ data: unknown; error: unknown; count?: number | null }>,
    ]);
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
    /**
     * Прочитанное в другом месте (показ в чате, другое устройство) снимает
     * и висящую карточку: всплывающее о том, что человек уже видел, —
     * просьба прочитать дважды.
     */
    const readNow = new Set(rows.filter((n) => n.read_at).map((n) => n.id));
    const derived = rows.filter((n) => !n.read_at).length;
    set({
      notifications: rows,
      notificationsLoaded: true,
      // `seenIds` ДОПИСЫВАЕТ к прежним: уехавшее за пределы 50 строк иначе
      // забывалось бы, и переподключение могло бы показать его снова
      noticeSeen: seenIds(rows, get().noticeSeen),
      noticePopups: mergePopups(
        get().noticePopups.filter((n) => !readNow.has(n.id)),
        fresh,
      ),
      notificationsUnread: (!counted.error && typeof counted.count === 'number')
        ? Math.max(counted.count, derived)
        : derived,
    });

    /**
     * ЗВУК И УВЕДОМЛЕНИЕ ОПЕРАЦИОННОЙ СИСТЕМЫ — по тем же событиям, что
     * всплывающая карточка: первая загрузка и уже виденное молчат (это
     * решил `newPopups`), а между вкладками событие объявляется один раз
     * (`claimNotice`). Оба сигнала — по настройкам сотрудника.
     *
     * Показываем ОДНО, даже если пришло три: три окна подряд в углу экрана
     * человек закрывает не читая.
     *
     * МОДУЛЬ ПОДТЯГИВАЕТСЯ ПО СОБЫТИЮ, а не статикой: `desktopNotify` несёт
     * синтез звука на WebAudio и разбор разрешений браузера, а нужен он
     * в редкий момент прихода уведомления. Статический импорт отправлял его
     * в критический путь ВСЕХ входов — слайс живёт в ядре стора, потому что
     * колокол стоит в оболочке.
     */
    const top = fresh[0];
    const settings = get().noticeSettings;
    if (top && (settings.sound || settings.desktop)) {
      void import('../../utils/desktopNotify')
        .then(({ announceNotice }) => announceNotice(top, settings, openNoticeLink))
        .catch(() => { /* сигнал вспомогательный: его отказ работу не останавливает */ });
    }
  },

  /**
   * Сообщения показаны в чате (`markChatSeen` ответил успехом) — уведомления
   * о них сервер уже погасил тем же вызовом. Здесь это повторяется в памяти,
   * чтобы колокол упал СРАЗУ: realtime-событие UPDATE придёт следом и
   * перечитает список, но ждать его — показывать «1» над прочитанным.
   */
  noteMessagesSeen: (messageIds) => {
    const ids = new Set(messageIds);
    if (ids.size === 0) return;
    const at = new Date().toISOString();
    let dropped = 0;
    const next = get().notifications.map((n) => {
      if (n.read_at || !n.message_id || !ids.has(n.message_id)) return n;
      dropped += 1;
      return { ...n, read_at: at };
    });
    if (dropped === 0) return;
    set({
      notifications: next,
      notificationsUnread: Math.max(0, get().notificationsUnread - dropped),
      noticePopups: get().noticePopups.filter((n) => !(n.message_id && ids.has(n.message_id))),
    });
  },

  /**
   * Настройки звука и окна браузера (правка 01.10, п. 4) — из базы, чтобы
   * выбор шёл за человеком на любое устройство. Кэш даёт первый кадр;
   * отказ чтения — молча: настройка вспомогательная, полоса поверх входа
   * в раздел из-за неё была бы хуже, чем звук по умолчанию.
   */
  loadNoticeSettings: async () => {
    const me = currentUserId();
    if (!me) {
      set({ noticeSettings: DEFAULT_SETTINGS, noticeSettingsLoaded: true });
      return;
    }
    const cached = cachedSettings(me);
    if (cached) set({ noticeSettings: cached });
    const { data, error } = await erpRead(() => supabase
      .from('erp_user_settings')
      .select('chat_sound, chat_desktop')
      .eq('user_id', me)
      .limit(1));
    if (currentUserId() !== me) return;
    const row = (data as { chat_sound: boolean; chat_desktop: boolean }[] | null)?.[0];
    if (!error && row) {
      const v = { sound: row.chat_sound, desktop: row.chat_desktop };
      cacheSettings(me, v);
      set({ noticeSettings: v, noticeSettingsLoaded: true });
      return;
    }
    set({ noticeSettings: cached ?? DEFAULT_SETTINGS, noticeSettingsLoaded: true });
  },

  /** Оптимистично С ОТКАТОМ: переключатель не должен ждать сеть */
  saveNoticeSettings: async (patch) => {
    const me = currentUserId();
    if (!me) return false;
    const before = get().noticeSettings;
    const next = { ...before, ...patch };
    set({ noticeSettings: next });
    const { error } = await erpQuery(() => supabase
      .from('erp_user_settings')
      .upsert(
        { user_id: me, chat_sound: next.sound, chat_desktop: next.desktop },
        { onConflict: 'user_id' },
      ));
    if (error) {
      set({ noticeSettings: before });
      erpError('Не удалось сохранить настройки уведомлений', error);
      return false;
    }
    cacheSettings(me, next);
    return true;
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
    const unreadBefore = get().notificationsUnread;
    set({
      notifications: before.map((n) => (fresh.some((f) => f.id === n.id)
        ? { ...n, read_at: at }
        : n)),
      notificationsUnread: Math.max(0, unreadBefore - fresh.length),
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
      // Ответ не читается — нужен лишь сам факт ответа без ошибки
      .select('id'));
    if (error) {
      set({ notifications: before, notificationsUnread: unreadBefore });
      erpError('Не удалось отметить уведомления прочитанными', error);
      return false;
    }
    return true;
  },

  /**
   * «Отметить все прочитанными» — ВСЕ, а не 50 загруженных: кнопка обещает
   * погасить колокол, а в счётчике может стоять больше, чем видно в ленте.
   * Отбор по адресату — политикой (`erp_notifications_update`), правка
   * колонок — стражем (меняется ровно `read_at`).
   */
  markAllNotificationsRead: async () => {
    const me = currentUserId();
    if (!me) return false;
    const before = get().notifications;
    const unreadBefore = get().notificationsUnread;
    const at = new Date().toISOString();
    set({
      notifications: before.map((n) => (n.read_at ? n : { ...n, read_at: at })),
      notificationsUnread: 0,
      noticePopups: [],
    });
    const { error } = await erpQuery(() => supabase
      .from('erp_notifications')
      .update({ read_at: at })
      .eq('user_id', me)
      .is('read_at', null));
    if (error) {
      set({ notifications: before, notificationsUnread: unreadBefore });
      erpError('Не удалось отметить уведомления прочитанными', error);
      return false;
    }
    return true;
  },
});
