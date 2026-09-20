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
 * ПО УМОЛЧАНИЮ ВЫКЛЮЧЕНЫ, и звук тоже (документ объявляет звук выключенным
 * сам). Спрашивать разрешение при входе нельзя: браузер запоминает отказ
 * НАВСЕГДА для этого адреса, и человек, отмахнувшийся от всплывшего окна
 * в первую секунду, больше не сможет включить уведомления вовсе. Запрос идёт
 * ТОЛЬКО по нажатию переключателя.
 *
 * ЗВУК СИНТЕЗИРУЕТСЯ, а не грузится файлом: короткий сигнал в 0,15 с
 * не стоит ни бинарника в репозитории, ни запроса за ним на цеховом Wi-Fi.
 */

import { storageGetRaw, storageSetRaw } from '../../lib/storage';

const KEY_DESKTOP = 'erp_chat_desktop_notify';
const KEY_SOUND = 'erp_chat_sound';

export type NotifyPermission = 'granted' | 'denied' | 'default' | 'unsupported';

/** Что браузер думает о разрешении. `unsupported` — API нет вовсе */
export function notifyPermission(): NotifyPermission {
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission as NotifyPermission;
}

/** Включены ли уведомления В НАСТРОЙКАХ (отдельно от разрешения браузера) */
export function desktopEnabled(): boolean {
  return storageGetRaw(KEY_DESKTOP) === '1';
}

export function setDesktopEnabled(on: boolean): void {
  storageSetRaw(KEY_DESKTOP, on ? '1' : '0');
}

export function soundEnabled(): boolean {
  return storageGetRaw(KEY_SOUND) === '1';
}

export function setSoundEnabled(on: boolean): void {
  storageSetRaw(KEY_SOUND, on ? '1' : '0');
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
 * Показать уведомление, если ОНО ИМЕЕТ СМЫСЛ.
 *
 * Не показываем, когда вкладка на экране: человек и так видит и ленту,
 * и всплывающую карточку внутри ERP, а дубль в углу экрана — это два
 * сообщения об одном событии.
 *
 * Возвращает `true`, если показали, — по нему решается, звучать ли сигналу:
 * звук без уведомления это звук ниоткуда.
 */
export function notifyDesktop(title: string, body: string | null, onClick?: () => void): boolean {
  if (!desktopEnabled() || notifyPermission() !== 'granted') return false;
  if (typeof document !== 'undefined' && document.visibilityState === 'visible') return false;
  try {
    const n = new Notification(title, { body: body ?? undefined, tag: 'erp-chat' });
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

/** Короткий сигнал. Тихий и один: рабочее место — цех, а не игровой автомат */
export function playPing(): void {
  if (!soundEnabled()) return;
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
