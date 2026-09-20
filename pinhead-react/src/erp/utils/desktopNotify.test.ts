import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  askPermission, desktopEnabled, notifyDesktop, notifyPermission,
  setDesktopEnabled, setSoundEnabled, soundEnabled, playPing,
} from './desktopNotify';

/**
 * БРАУЗЕРНЫЕ УВЕДОМЛЕНИЯ И ЗВУК (вторая очередь чата, документ 20.09, п. 4).
 *
 * Каждое правило здесь ломается тихо и вредно:
 *
 *   · разрешение спрашивается ТОЛЬКО по нажатию — браузер помнит отказ
 *     навсегда, и «спросим при входе» лишает человека уведомлений насовсем;
 *   · уведомление не показывается, когда вкладка на экране: там уже есть
 *     всплывающая карточка ERP, и второе окно в углу — дубль;
 *   · звук звучит только ВМЕСТЕ с показанным уведомлением — сигнал ниоткуда
 *     заставляет искать, что произошло;
 *   · по умолчанию всё выключено.
 */

class FakeNotification {
  static permission = 'default';

  static requestPermission = vi.fn(async () => FakeNotification.permission);

  static made: { title: string; body?: string }[] = [];

  onclick: (() => void) | null = null;

  constructor(title: string, opts?: { body?: string }) {
    FakeNotification.made.push({ title, body: opts?.body });
  }

  close() {}
}

const g = globalThis as unknown as {
  Notification?: unknown;
  document: { visibilityState: string };
};

beforeEach(() => {
  localStorage.clear();
  FakeNotification.made = [];
  FakeNotification.permission = 'granted';
  FakeNotification.requestPermission.mockClear();
  g.Notification = FakeNotification;
  Object.defineProperty(document, 'visibilityState', {
    value: 'hidden', configurable: true,
  });
});

afterEach(() => {
  delete g.Notification;
});

describe('настройки по умолчанию', () => {
  it('и уведомления, и звук выключены', () => {
    expect(desktopEnabled()).toBe(false);
    expect(soundEnabled()).toBe(false);
  });

  it('переключение запоминается', () => {
    setDesktopEnabled(true);
    setSoundEnabled(true);
    expect(desktopEnabled()).toBe(true);
    expect(soundEnabled()).toBe(true);
  });
});

describe('разрешение браузера', () => {
  it('уже выданное разрешение не спрашивается повторно', async () => {
    FakeNotification.permission = 'granted';
    expect(await askPermission()).toBe('granted');
    expect(FakeNotification.requestPermission).not.toHaveBeenCalled();
  });

  /** Спросить у того, кто уже отказал, нельзя — браузер ответит отказом сам */
  it('после отказа не спрашивается снова', async () => {
    FakeNotification.permission = 'denied';
    expect(await askPermission()).toBe('denied');
    expect(FakeNotification.requestPermission).not.toHaveBeenCalled();
  });

  it('без поддержки API говорит об этом, а не падает', async () => {
    delete g.Notification;
    expect(notifyPermission()).toBe('unsupported');
    expect(await askPermission()).toBe('unsupported');
  });
});

describe('показ уведомления', () => {
  it('выключенные настройки — не показываем', () => {
    expect(notifyDesktop('Заголовок', 'Текст')).toBe(false);
    expect(FakeNotification.made).toHaveLength(0);
  });

  it('включённые и разрешённые — показываем', () => {
    setDesktopEnabled(true);
    expect(notifyDesktop('Мария в заказе 4821', 'Ткань приехала')).toBe(true);
    expect(FakeNotification.made).toEqual([
      { title: 'Мария в заказе 4821', body: 'Ткань приехала' },
    ]);
  });

  it('вкладка на экране — не показываем: там уже есть карточка ERP', () => {
    setDesktopEnabled(true);
    Object.defineProperty(document, 'visibilityState', {
      value: 'visible', configurable: true,
    });
    expect(notifyDesktop('Заголовок', null)).toBe(false);
    expect(FakeNotification.made).toHaveLength(0);
  });

  it('без разрешения браузера не показываем, даже если включено', () => {
    setDesktopEnabled(true);
    FakeNotification.permission = 'denied';
    expect(notifyDesktop('Заголовок', null)).toBe(false);
  });

  it('поломка API не роняет и не кричит', () => {
    setDesktopEnabled(true);
    g.Notification = class {
      static permission = 'granted';

      constructor() { throw new Error('нельзя'); }
    };
    expect(() => notifyDesktop('Заголовок', null)).not.toThrow();
    expect(notifyDesktop('Заголовок', null)).toBe(false);
  });
});

describe('звук', () => {
  it('выключенный не трогает аудио вовсе', () => {
    const Ctx = vi.fn();
    (window as unknown as { AudioContext: unknown }).AudioContext = Ctx;
    playPing();
    expect(Ctx).not.toHaveBeenCalled();
  });

  it('включённый синтезирует короткий сигнал, а не грузит файл', () => {
    setSoundEnabled(true);
    const stop = vi.fn();
    const osc = {
      frequency: { value: 0 },
      connect: vi.fn(() => ({ connect: vi.fn() })),
      start: vi.fn(),
      stop,
      onended: null,
    };
    const ctx = {
      currentTime: 0,
      createOscillator: () => osc,
      createGain: () => ({
        gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
        connect: vi.fn(() => ({ connect: vi.fn() })),
      }),
      destination: {},
      close: vi.fn(),
    };
    // Именно `function`, а не стрелка: стрелку нельзя вызвать через `new`,
    // и мок падал бы внутри try — то есть тест «проходил» бы на пустоте
    (window as unknown as { AudioContext: unknown }).AudioContext = vi.fn(function fake() {
      return ctx;
    });

    playPing();
    expect(osc.start).toHaveBeenCalled();
    // Не дольше доли секунды: рабочее место — цех, а не игровой автомат
    expect(stop.mock.calls[0][0]).toBeLessThanOrEqual(0.2);
  });
});
