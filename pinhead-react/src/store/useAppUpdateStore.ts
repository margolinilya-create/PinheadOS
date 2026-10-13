import { create } from 'zustand';

/** На сколько «Позже» прячет плашку. Потом она вернётся: выкатка никуда не делась */
export const SNOOZE_MS = 30 * 60_000;

interface AppUpdateStore {
  /** На сервере лежит другая сборка, чем та, что работает во вкладке */
  available: boolean;
  /** До какого момента плашка спрятана по «Позже»; 0 — не спрятана */
  snoozedUntil: number;
  markAvailable: () => void;
  snooze: (ms?: number) => void;
}

let snoozeTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * «Вышло обновление» — состояние на всё приложение.
 *
 * Пишет сюда наблюдатель версии (`lib/appVersion`), читает плашка
 * (`components/shared/UpdateBanner`). Признак ставится один раз и не
 * снимается до перезагрузки: другой сборки, чем выложенная, уже не будет,
 * а перезагрузка сама обнулит стор вместе со всей страницей.
 */
export const useAppUpdateStore = create<AppUpdateStore>((set) => ({
  available: false,
  snoozedUntil: 0,
  markAvailable: () => set({ available: true }),
  snooze: (ms = SNOOZE_MS) => {
    if (snoozeTimer) clearTimeout(snoozeTimer);
    set({ snoozedUntil: Date.now() + ms });
    // Возврат плашки — по таймеру, а не по чьему-то рендеру: если человек
    // полчаса не трогал ничего, что перерисовывает хост, она всё равно вернётся
    snoozeTimer = setTimeout(() => {
      snoozeTimer = null;
      set({ snoozedUntil: 0 });
    }, ms);
  },
}));

/** Для тестов: исходное состояние и снятый таймер */
export function resetAppUpdateStore(): void {
  if (snoozeTimer) clearTimeout(snoozeTimer);
  snoozeTimer = null;
  useAppUpdateStore.setState({ available: false, snoozedUntil: 0 });
}
