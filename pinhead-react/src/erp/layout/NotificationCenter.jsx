import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { useErpStore } from '../store/useErpStore';
import { Button } from '../components/Button';
import { OrderLink } from '../components/OrderLink';
import { groupNotices } from '../utils/notifications';
import { askPermission, notifyPermission } from '../utils/desktopNotify';
import styles from '../erp.module.css';
import local from './noticeCenter.module.css';

/**
 * ЦЕНТР УВЕДОМЛЕНИЙ В ШАПКЕ (правка заказчика 20.09, п. 4).
 *
 * «Обязательный минимум — уведомления внутри ERP в реальном времени:
 * глобальная кнопка с бейджем, центр уведомлений и всплывающие уведомления…
 * В центре уведомлений: „Все", „Непрочитанные", „Упоминания", „Ответы";
 * отметка отдельного уведомления или всех уведомлений прочитанными».
 *
 * ЧТО БЫЛО. Колокол уводил на дашборд (`/#notifications`), где список жил
 * виджетом. То есть, чтобы прочитать «вас упомянули», человек уходил
 * с экрана, на котором работал, — ровно то, чего документ просит не делать
 * («центр открывается из общей шапки ERP на любом экране»).
 *
 * НАЖАТИЕ ВЕДЁТ К СООБЩЕНИЮ, А НЕ К ЗАКАЗУ: ссылка уведомления уже несёт
 * `?tab=chat&msg=<id>`, и лента прокручивается к нему сама. «Открыть заказ»
 * на месте этого оставляло бы человека искать, ради чего его позвали.
 *
 * НАЖАТИЕ НЕ ГАСИТ (правка 01.10, п. 4): «открытие колокольчика не отмечает
 * сообщение прочитанным: это происходит, когда сотрудник увидел его в чате».
 * Гасит показ сообщения в ленте (`erp_chat_mark_seen` на сервере), то есть
 * ровно то событие, о котором уведомление, — на любом устройстве сразу.
 * Отметка руками осталась («✓» у строки и «Отметить все прочитанными»):
 * документ 20.09 её требует, и это решение человека, а не побочный эффект.
 *
 * ДВА РАЗДЕЛА (там же): «личные сообщения нужно отделить от напоминаний
 * о сроках». «Сообщения» — `erp_notifications` со своей прочитанностью;
 * «Сроки» — поводы `orderNotices`, у которых прочитанности нет по
 * построению: они уходят вместе с состоянием заказа.
 */
const TABS = [
  { id: 'all', label: 'Все' },
  { id: 'unread', label: 'Непрочитанные' },
  { id: 'mention', label: 'Упоминания' },
  { id: 'reply', label: 'Ответы' },
];

function matches(tab, n) {
  if (tab === 'unread') return !n.read_at;
  if (tab === 'mention') return n.kind === 'chat_mention';
  if (tab === 'reply') return n.kind === 'chat_reply';
  return true;
}

/** Сколько производственных поводов показывать в центре; остальное — на обзоре */
const ALERTS_SHOWN = 8;

/**
 * `alerts` — производственные поводы (`orderNotices`: просрочка, остановленный
 * этап, дозакупка), те же, что колокол считает меткой сроков.
 */
export function NotificationCenter({ alerts = [], onClose }) {
  const navigate = useNavigate();
  const {
    rows, unread, markRead, markAll, settings, saveSettings,
  } = useErpStore(useShallow((s) => ({
    rows: s.notifications,
    unread: s.notificationsUnread,
    markRead: s.markNotificationsRead,
    markAll: s.markAllNotificationsRead,
    settings: s.noticeSettings,
    saveSettings: s.saveNoticeSettings,
  })));
  /**
   * Какой раздел открыт первым: где есть непрочитанное личное — там
   * «Сообщения»; если писать некому, а сроки горят — «Сроки». Открыть
   * пустой раздел при непустом соседнем — заставить человека искать.
   */
  const [section, setSection] = useState(
    () => (unread === 0 && alerts.length > 0 ? 'deadlines' : 'messages'),
  );
  const [tab, setTab] = useState('unread');
  const [perm, setPerm] = useState(() => notifyPermission());

  const list = useMemo(
    () => (rows ?? []).filter((n) => matches(tab, n)),
    [rows, tab],
  );

  // Порядок срочности — тот же, что у виджета обзора (`groupNotices`)
  const alertRows = useMemo(
    () => groupNotices(alerts).flatMap((g) => g.items),
    [alerts],
  );

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className={styles.noticeCenter} role="dialog" aria-label="Уведомления">
      {/*
        БЕЗ `role="tab"` НАМЕРЕННО: в разделе этот паттерн объявляет ровно
        один примитив (`components/Tabs`), и сторож `Tabs.test.ts` на это
        смотрит. Полного таб-паттерна тут и нет — нет ни панелей, ни
        навигации стрелками, есть подбор списка. Группа кнопок с
        `aria-pressed` честнее: она обещает ровно то, что делает.
      */}
      <div className={styles.noticeTabs} role="group" aria-label="Раздел">
        {[
          { id: 'messages', label: 'Сообщения', count: unread },
          { id: 'deadlines', label: 'Сроки', count: alertRows.length },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            aria-pressed={section === t.id}
            className={`${styles.noticeTab} ${section === t.id ? styles.noticeTabActive : ''}`}
            onClick={() => setSection(t.id)}
          >
            {t.label}{t.count > 0 ? ` · ${t.count}` : ''}
          </button>
        ))}
      </div>

      {section === 'deadlines' && (
        <section className={styles.noticeSection} aria-label="Сроки">
          {alertRows.length === 0 ? (
            <p className={styles.subText}>Сроки в порядке — заказов, требующих внимания, нет</p>
          ) : (
            <ul className={styles.noticeList}>
              {alertRows.slice(0, ALERTS_SHOWN).map((n) => (
                <li key={n.id}>
                  <OrderLink orderId={n.orderId} className={styles.noticeRow} onClick={onClose}>
                    <span className={styles.noticeTitle}>
                      {n.text}
                      {n.overdueDays > 0 && ` · ${n.overdueDays} дн.`}
                    </span>
                    {n.sub && <span className={styles.subText}>{n.sub}</span>}
                  </OrderLink>
                </li>
              ))}
            </ul>
          )}
          {alertRows.length > ALERTS_SHOWN && (
            // Никаких тихих лимитов: сколько показано и где остальные
            <Link to="/#notifications" className={styles.noticeMore} onClick={onClose}>
              Показаны {ALERTS_SHOWN} из {alertRows.length} → все на обзоре
            </Link>
          )}
        </section>
      )}

      {section === 'messages' && (
        <>
          <div className={styles.noticeTabs} role="group" aria-label="Что показать">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                aria-pressed={tab === t.id}
                className={`${styles.noticeTab} ${tab === t.id ? styles.noticeTabActive : ''}`}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>

          {list.length === 0 ? (
            <p className={styles.subText}>
              {tab === 'unread' ? 'Непрочитанных сообщений нет' : 'Пусто'}
            </p>
          ) : (
            <ul className={styles.noticeList}>
              {list.map((n) => (
                <li
                  key={n.id}
                  className={`${local.item} ${n.read_at ? '' : styles.noticeUnread}`}
                >
                  <button
                    type="button"
                    className={styles.noticeRow}
                    onClick={() => {
                      /**
                       * Только переход: прочитанным уведомление станет, когда
                       * сообщение покажется в ленте (правка 01.10, п. 4).
                       * Погасить здесь — объявить прочитанным то, до чего
                       * человек мог и не долистать.
                       */
                      if (n.link) navigate(n.link);
                      onClose();
                    }}
                  >
                    <span className={styles.noticeTitle}>{n.title}</span>
                    {n.body && <span className={styles.subText}>{n.body}</span>}
                  </button>
                  {!n.read_at && (
                    <Button
                      variant="ghost"
                      size="sm"
                      icon="check"
                      iconOnly
                      aria-label="Отметить прочитанным"
                      title="Отметить прочитанным"
                      onClick={() => markRead([n.id])}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}

          {unread > 0 && (
            <Button variant="ghost" size="sm" onClick={() => markAll()}>
              Отметить все прочитанными
            </Button>
          )}
        </>
      )}

      {/*
        БРАУЗЕРНЫЕ УВЕДОМЛЕНИЯ И ЗВУК. С 01.10 (п. 4) — настройки СОТРУДНИКА
        в базе (`erp_user_settings`): выбор идёт за человеком на планшет цеха
        и на ноутбук. Разрешение браузера спрашивается ТОЛЬКО по нажатию:
        отказ, полученный при входе, браузер помнит навсегда.

        Подпись честная: это уведомления, пока ERP ОТКРЫТА (хотя бы в фоне).
        Доставка при закрытом браузере — отдельная подсистема (service worker
        и VAPID), и называть это «push» значило бы обещать то, чего нет.
      */}
      <div className={styles.noticeSettings}>
        <label className={styles.noticeToggle}>
          <input
            type="checkbox"
            checked={settings.desktop}
            disabled={perm === 'unsupported' || perm === 'denied'}
            onChange={async (e) => {
              const on = e.target.checked;
              if (on) {
                const got = await askPermission();
                setPerm(got);
                if (got !== 'granted') return;
              }
              void saveSettings({ desktop: on });
            }}
          />
          <span>Уведомления браузера, пока ERP открыта</span>
        </label>
        {perm === 'denied' && (
          <p className={styles.subText}>
            Браузер запретил уведомления для сайта — включите их в его настройках.
          </p>
        )}
        {perm === 'unsupported' && (
          <p className={styles.subText}>Этот браузер уведомлений не поддерживает.</p>
        )}
        <label className={styles.noticeToggle}>
          <input
            type="checkbox"
            checked={settings.sound}
            onChange={(e) => { void saveSettings({ sound: e.target.checked }); }}
          />
          <span>Звук нового уведомления</span>
        </label>
      </div>
    </div>
  );
}
