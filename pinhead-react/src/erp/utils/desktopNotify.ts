/**
 * БРАУЗЕРНЫЕ УВЕДОМЛЕНИЯ И ЗВУК (вторая очередь чата, документ 20.09, п. 4).
 *
 * ЧЕСТНАЯ ГРАНИЦА. Здесь — уведомление операционной системы, пока вкладка ERP
 * ОТКРЫТА (хотя бы в фоне) через `Notification`. Это НЕ web push: доставка
 * при закрытом браузере требует service worker, VAPID-ключей, хранения
 * подписок и своего отправителя — отдельная подсистема, и документ прямо
 * предупреждает не считать её сделанной по наличию уведомлений в открытой
 * ERP. Поэтому в интерфейсе это называется «Уведомления браузера, пока ERP
 * открыта», а не «push».
 *
 * НАСТРОЙКИ — У СОТРУДНИКА, А НЕ У УСТРОЙСТВА (правка 01.10, п. 4): «звук
 * и уведомления браузера работают по настройкам сотрудника». Они живут
 * в `erp_user_settings` и приходят сюда аргументом из стора
 * (`notificationsSlice.noticeSettings`); прежние ключи localStorage
 * (`erp_chat_sound`/`erp_chat_desktop_notify`) читаются только как
 * подсказка, пока у человека нет строки в базе.
 *
 * Разрешение браузера по-прежнему спрашивается ТОЛЬКО по нажатию
 * переключателя: браузер запоминает отказ НАВСЕГДА для этого адреса,
 * и человек, отмахнувшийся от окна в первую секунду, больше не сможет
 * включить уведомления вовсе.
 *
 * ЗВУК СИНТЕЗИРУЕТСЯ, а не грузится файлом: короткий сигнал в 0,15 с
 * не стоит ни бинарника в репозитории, ни запроса за ним на цеховом Wi-Fi.
 */

import { storageGet, storageSet } from '../../lib/storage';
import type { NoticeSettings } from '../store/types';

export type NotifyPermission = 'granted' | 'denied' | 'default' | 'unsupported';

/** Что браузер думает о разрешении. `unsupported` — API нет вовсе */
export function notifyPermission(): NotifyPermission {
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission as NotifyPermission;
}

/**
 * Спросить разрешение. Вызывается ТОЛЬКО из обработчика нажатия: браузеры
 * отклоняют запрос без жеста человека, а отказ запоминают навсегда.
 */
export async function askPermission(): Promise<NotifyPermission> {
  if (typeof Notification === 'undefined') return 'unsupported';
  if (Notification.permission !== 'default') return Notification.permission as NotifyPermission;
  try {
    return (await Notification.requestPermission()) as NotifyPermission;
  } catch {
    // Старые Safari возвращают разрешение колбэком и бросают на промисе
    return notifyPermission();
  }
}

/**
 * Показать уведомление, если ОНО ИМЕЕТ СМЫСЛ. Включено ли оно в настройках,
 * решает вызывающий (`announceNotice`): настройка — свойство сотрудника
 * из базы, а не этого модуля.
 *
 * Не показываем, когда вкладка на экране: человек и так видит и ленту,
 * и всплывающую карточку внутри ERP, а дубль в углу экрана — это два
 * сообщения об одном событии.
 *
 * `tag` — по уведомлению, а не общий: два окна с одним тегом операционная
 * система СКЛЕИВАЕТ, и второе событие затирало бы первое. А одинаковый тег
 * одного события из двух вкладок, наоборот, склеится в одно окно — вторая
 * линия защиты от дубля поверх захвата (`claimNotice`).
 */
export function notifyDesktop(
  title: string,
  body: string | null,
  onClick?: () => void,
  tag = 'erp-chat',
): boolean {
  if (notifyPermission() !== 'granted') return false;
  if (typeof document !== 'undefined' && document.visibilityState === 'visible') return false;
  try {
    const n = new Notification(title, { body: body ?? undefined, tag });
    if (onClick) {
      n.onclick = () => {
        window.focus();
        onClick();
        n.close();
      };
    }
    return true;
  } catch {
    /**
     * Fail-open и молча: уведомление — вспомогательный сигнал, и полоса
     * «не смогли показать уведомление» поверх работы была бы хуже, чем
     * непоказанное уведомление.
     */
    return false;
  }
}

/**
 * Короткий сигнал. Тихий и один: рабочее место — цех, а не игровой автомат.
 * Звучит ли он, решает вызывающий по настройке сотрудника.
 */
export function playPing(): void {
  const Ctx = typeof window !== 'undefined'
    ? (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext)
    : undefined;
  if (!Ctx) return;
  try {
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.05, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.15);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.16);
    osc.onended = () => { void ctx.close(); };
  } catch {
    // Автовоспроизведение может быть запрещено до первого жеста — это
    // не повод показывать человеку ошибку
  }
}

/**
 * ОДНО СОБЫТИЕ — ОДИН ЗВУК НА ВСЕ ВКЛАДКИ (правка 01.10, п. 4: «повторное
 * подключение не создаёт дубли»).
 *
 * Realtime звонит КАЖДОЙ открытой вкладке, и у каждой свой список «уже
 * видела» (`noticeSeen` живёт в памяти вкладки). Без захвата три вкладки
 * ERP — обычное дело у менеджера — давали три сигнала и три окна на одно
 * упоминание. Захват — запись «это событие уже объявлено» в общем для
 * вкладок localStorage.
 *
 * Проверка и запись идут ПОД БЛОКИРОВКОЙ Web Locks: она одна на источник
 * и исключает гонку «обе прочитали пусто, обе записали». Где API нет
 * (старый Safari), остаётся та же проверка без блокировки — окно гонки
 * в миллисекунды, и дубль там лучше, чем тишина.
 *
 * Запись живёт десять минут: этого с запасом хватает на переподключение
 * и на всплеск событий, а список не копится неделями.
 */
const CLAIMS_KEY = 'erp_notice_claims';
const CLAIM_TTL_MS = 10 * 60 * 1000;

function takeClaim(id: string): boolean {
  const now = Date.now();
  const all = storageGet<Record<string, number>>(CLAIMS_KEY, {}) ?? {};
  if (typeof all[id] === 'number' && now - all[id] < CLAIM_TTL_MS) return false;
  const kept: Record<string, number> = {};
  for (const [k, at] of Object.entries(all)) {
    if (typeof at === 'number' && now - at < CLAIM_TTL_MS) kept[k] = at;
  }
  kept[id] = now;
  storageSet(CLAIMS_KEY, kept);
  return true;
}

export async function claimNotice(id: string): Promise<boolean> {
  const locks = typeof navigator !== 'undefined'
    ? (navigator as Navigator & { locks?: LockManager }).locks
    : undefined;
  if (locks?.request) {
    try {
      return await locks.request('erp-notice-claim', () => takeClaim(id));
    } catch {
      // Блокировку не дали (частный режим, политика браузера) — без неё
    }
  }
  return takeClaim(id);
}

/**
 * Насколько скрытая вкладка уступает видимой. Видимая объявляет событие
 * карточкой и звуком; скрытая, успей она первой, показала бы окно
 * операционной системы поверх экрана, где человек уже видит то же самое.
 */
export const HIDDEN_TAB_DELAY_MS = 400;

/**
 * Объявить пришедшее уведомление: звук и окно браузера — по настройкам
 * сотрудника и один раз на все вкладки.
 *
 * Звук НЕ привязан к окну браузера: «звук и уведомления браузера работают
 * по настройкам сотрудника» — это два выбора, а не один. Прежняя редакция
 * звучала только вместе с окном, то есть при видимой вкладке не звучала
 * никогда, сколько бы человек ни включал звук.
 *
 * @param open переход по ссылке уведомления — роутер раздела, не перезагрузка
 */
export async function announceNotice(
  notice: { id: string; title: string; body: string | null; link: string | null },
  settings: NoticeSettings,
  open: (link: string) => void,
): Promise<boolean> {
  if (!settings.sound && !settings.desktop) return false;
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
    await new Promise((resolve) => { setTimeout(resolve, HIDDEN_TAB_DELAY_MS); });
  }
  if (!(await claimNotice(notice.id))) return false;
  if (settings.desktop) {
    const { link } = notice;
    notifyDesktop(
      notice.title,
      notice.body,
      link ? () => open(link) : undefined,
      `erp-notice-${notice.id}`,
    );
  }
  if (settings.sound) playPing();
  return true;
}
