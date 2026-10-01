import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  announceNotice, askPermission, claimNotice, notifyDesktop, notifyPermission, playPing,
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
 *   · включено ли — решает настройка СОТРУДНИКА (правка 01.10, п. 4), она
 *     приходит аргументом из стора; модуль её не хранит;
 *   · одно событие объявляется один раз на все вкладки (`claimNotice`);
 *   · звук не привязан к окну браузера — это два выбора, а не один.
 */

class FakeNotification {
  static permission = 'default';

  static requestPermission = vi.fn(async () => FakeNotification.permission);

  static made: { title: string; body?: string }[] = [];

  static last: FakeNotification | null = null;

  onclick: (() => void) | null = null;

  constructor(title: string, opts?: { body?: string }) {
    FakeNotification.made.push({ title, body: opts?.body });
    FakeNotification.last = this;
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
  it('разрешённое — показываем', () => {
    expect(notifyDesktop('Мария в заказе 4821', 'Ткань приехала')).toBe(true);
    expect(FakeNotification.made).toEqual([
      { title: 'Мария в заказе 4821', body: 'Ткань приехала' },
    ]);
  });

  it('вкладка на экране — не показываем: там уже есть карточка ERP', () => {
    Object.defineProperty(document, 'visibilityState', {
      value: 'visible', configurable: true,
    });
    expect(notifyDesktop('Заголовок', null)).toBe(false);
    expect(FakeNotification.made).toHaveLength(0);
  });

  it('без разрешения браузера не показываем, даже если включено', () => {
    FakeNotification.permission = 'denied';
    expect(notifyDesktop('Заголовок', null)).toBe(false);
  });

  it('поломка API не роняет и не кричит', () => {
    g.Notification = class {
      static permission = 'granted';

      constructor() { throw new Error('нельзя'); }
    };
    expect(() => notifyDesktop('Заголовок', null)).not.toThrow();
    expect(notifyDesktop('Заголовок', null)).toBe(false);
  });
});

describe('звук', () => {
  it('синтезирует короткий сигнал, а не грузит файл', () => {
    const { osc, stop } = fakeAudio();
    playPing();
    expect(osc.start).toHaveBeenCalled();
    // Не дольше доли секунды: рабочее место — цех, а не игровой автомат
    expect(stop.mock.calls[0][0]).toBeLessThanOrEqual(0.2);
  });
});

function fakeAudio() {
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
  const Ctx = vi.fn(function fake() { return ctx; });
  (window as unknown as { AudioContext: unknown }).AudioContext = Ctx;
  return { osc, stop, Ctx };
}

const NOTICE = { id: 'n1', title: 'Вас упомянули — сделка 4821', body: 'Ткань', link: '/orders/o1?tab=chat&msg=m1' };

describe('объявление уведомления: настройки сотрудника', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  /** Ждать задержку скрытой вкладки — это таймер, а не сеть */
  const run = async (p: Promise<boolean>) => {
    await vi.advanceTimersByTimeAsync(1000);
    return p;
  };

  it('всё выключено — ни звука, ни окна, и событие не захватывается', async () => {
    const { Ctx } = fakeAudio();
    expect(await run(announceNotice(NOTICE, { sound: false, desktop: false }, vi.fn()))).toBe(false);
    expect(Ctx).not.toHaveBeenCalled();
    expect(FakeNotification.made).toHaveLength(0);
    // Соседняя вкладка с включённым звуком всё ещё вправе объявить
    expect(await claimNotice('n1')).toBe(true);
  });

  it('звук звучит и при видимой вкладке — без окна браузера', async () => {
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    const { osc } = fakeAudio();
    expect(await announceNotice(NOTICE, { sound: true, desktop: false }, vi.fn())).toBe(true);
    expect(osc.start).toHaveBeenCalled();
    expect(FakeNotification.made).toHaveLength(0);
  });

  it('окно браузера в скрытой вкладке; нажатие ведёт к сообщению', async () => {
    const { Ctx } = fakeAudio();
    const open = vi.fn();
    const focus = vi.spyOn(window, 'focus').mockImplementation(() => {});
    expect(await run(announceNotice(NOTICE, { sound: false, desktop: true }, open))).toBe(true);
    expect(FakeNotification.made).toEqual([{ title: NOTICE.title, body: 'Ткань' }]);
    expect(Ctx).not.toHaveBeenCalled();
    FakeNotification.last?.onclick?.();
    expect(focus).toHaveBeenCalled();
    expect(open).toHaveBeenCalledWith('/orders/o1?tab=chat&msg=m1');
  });

  it('одно событие объявляется один раз — вторая вкладка молчит', async () => {
    const { osc } = fakeAudio();
    const settings = { sound: true, desktop: true };
    const first = run(announceNotice(NOTICE, settings, vi.fn()));
    const second = run(announceNotice(NOTICE, settings, vi.fn()));
    expect([await first, await second].sort()).toEqual([false, true]);
    expect(osc.start).toHaveBeenCalledTimes(1);
    expect(FakeNotification.made).toHaveLength(1);
  });

  it('захват переживает перезапуск вкладки, но не вечен', async () => {
    expect(await claimNotice('n2')).toBe(true);
    expect(await claimNotice('n2')).toBe(false);
    vi.setSystemTime(Date.now() + 11 * 60 * 1000);
    expect(await claimNotice('n2')).toBe(true);
  });
});
