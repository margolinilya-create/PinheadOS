import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { useErpStore } from '../store/useErpStore';
import { Button } from '../components/Button';
import {
  askPermission, desktopEnabled, notifyPermission, setDesktopEnabled,
  setSoundEnabled, soundEnabled,
} from '../utils/desktopNotify';
import styles from '../erp.module.css';

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

export function NotificationCenter({ onClose }) {
  const navigate = useNavigate();
  const { rows, markRead } = useErpStore(useShallow((s) => ({
    rows: s.notifications,
    markRead: s.markNotificationsRead,
  })));
  const [tab, setTab] = useState('unread');
  /**
   * Настройки читаются из localStorage ОДИН раз при открытии центра:
   * это личный выбор человека на этом устройстве, а не состояние стора —
   * общего у них ничего нет, и переживать выход из системы он должен.
   */
  const [desktop, setDesktop] = useState(() => desktopEnabled());
  const [sound, setSound] = useState(() => soundEnabled());
  const [perm, setPerm] = useState(() => notifyPermission());

  // Открыли центр — ничего не гасим: «очистка уведомления не означает,
  // что текст сообщения прочитан» (документ). Прочтение ставит человек
  const list = useMemo(
    () => (rows ?? []).filter((n) => matches(tab, n)),
    [rows, tab],
  );
  const unreadIds = useMemo(
    () => (rows ?? []).filter((n) => !n.read_at).map((n) => n.id),
    [rows],
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
          {tab === 'unread' ? 'Непрочитанных нет' : 'Пусто'}
        </p>
      ) : (
        <ul className={styles.noticeList}>
          {list.map((n) => (
            <li key={n.id} className={n.read_at ? undefined : styles.noticeUnread}>
              <button
                type="button"
                className={styles.noticeRow}
                onClick={() => {
                  /**
                   * Уведомление гасится ПРИ ПЕРЕХОДЕ: человек идёт читать,
                   * и оставлять его непрочитанным значит просить прочитать
                   * дважды. Само СООБЩЕНИЕ при этом прочитанным не считается —
                   * это решает видимая область ленты (документ разводит
                   * их прямо).
                   */
                  if (!n.read_at) void markRead([n.id]);
                  if (n.link) navigate(n.link);
                  onClose();
                }}
              >
                <span className={styles.noticeTitle}>{n.title}</span>
                {n.body && <span className={styles.subText}>{n.body}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}

      {/*
        БРАУЗЕРНЫЕ УВЕДОМЛЕНИЯ И ЗВУК (вторая очередь чата). Оба выключены
        по умолчанию — звук документ объявляет выключенным сам, а разрешение
        браузера спрашивается ТОЛЬКО по нажатию: отказ, полученный при входе,
        браузер помнит навсегда, и включить уведомления человек уже не сможет.

        Подпись честная: это уведомления, пока ERP ОТКРЫТА (хотя бы в фоне).
        Доставка при закрытом браузере — отдельная подсистема (service worker
        и VAPID), и называть это «push» значило бы обещать то, чего нет.
      */}
      <div className={styles.noticeSettings}>
        <label className={styles.noticeToggle}>
          <input
            type="checkbox"
            checked={desktop}
            disabled={perm === 'unsupported' || perm === 'denied'}
            onChange={async (e) => {
              const on = e.target.checked;
              if (on) {
                const got = await askPermission();
                setPerm(got);
                if (got !== 'granted') { setDesktop(false); setDesktopEnabled(false); return; }
              }
              setDesktop(on);
              setDesktopEnabled(on);
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
            checked={sound}
            onChange={(e) => { setSound(e.target.checked); setSoundEnabled(e.target.checked); }}
          />
          <span>Звук нового уведомления</span>
        </label>
      </div>

      {unreadIds.length > 0 && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => markRead(unreadIds)}
        >
          Отметить все прочитанными
        </Button>
      )}
    </div>
  );
}
