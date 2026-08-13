/**
 * Режим приложения: 🏭 Производство (ERP) или ✏️ ТЗ (Order Studio).
 *
 * ПОЧЕМУ ЭТОТ ФАЙЛ СУЩЕСТВУЕТ (блокер QA 13.08.2026).
 *
 * Режим хранился ТОЛЬКО в `localStorage.pinhead_feature_orderStudio`, а
 * переключался двумя кнопками, каждая из которых делала одно и то же руками:
 * `setFeature(...)` и следом `window.location.href = '/'`. Это давало три беды
 * сразу, и все три чинятся здесь:
 *
 * 1. Возврат из Studio МОЛЧА не срабатывал. `OrderStudioApp` вешает
 *    `beforeunload`-стража «визард не сохранён», и он не отличал уход с сайта
 *    от намеренного переключения раздела: браузер показывал нативное «Покинуть
 *    страницу?», отмена оставляла человека в Studio. Ни запроса, ни сообщения,
 *    ни записи в консоли — кнопка выглядела мёртвой. Автоматический обход
 *    (и QA во второй раз) отменяет такие диалоги сам, поэтому там «не
 *    происходило ничего» вообще. Отсюда `beginModeSwitch()`: намеренное
 *    переключение снимает стража на время перехода — черновик визарда всё
 *    равно автосохранён (`useDraft`).
 *
 * 2. `localStorage` общий на профиль, а адрес о режиме не знал: залипало во
 *    ВСЕХ вкладках сразу, перезагрузка не помогала, ссылку на экран дать было
 *    нельзя. Теперь переключение уходит на адрес с ЯВНЫМ параметром
 *    (`?studio=0` / `?studio=1`) — он старше localStorage (см. features.ts),
 *    поэтому работает и при чужом, и при недоступном (приватный режим)
 *    хранилище.
 *
 * 3. Выхода не было вовсе: при флаге = 1 ЛЮБОЙ адрес ERP редиректился на `/`
 *    и рисовал Studio. Теперь маршруты, которых в Studio нет физически
 *    (`/board`, `/queue`, `/plan`, …), всегда открывают ERP — адрес конкретнее
 *    запомненного выбора, поэтому он же и чинит память (`rememberMode`).
 *    Любая ссылка на производство — аварийный выход.
 */

import { isFeatureEnabled, setFeature } from './features';

export type AppMode = 'erp' | 'studio';

/**
 * Маршруты, которые существуют ТОЛЬКО в ERP.
 *
 * Общие адреса (`/`, `/orders`, `/admin`) сюда не входят намеренно: они есть
 * в обоих разделах, и по ним режим не определить. Список — аварийный выход,
 * а не карта маршрутов; он обязан оставаться однозначным.
 */
const ERP_ONLY = [
  '/board',
  '/queue',
  '/task',
  '/plan',
  '/load',
  '/purchasing',
  '/warehouse',
  '/subcontracting',
  '/experimental',
];

/** Адрес принадлежит разделу «Производство» и ничему больше */
export function isErpOnlyPath(pathname: string): boolean {
  return ERP_ONLY.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Какой раздел показывать. Адрес старше запомненного выбора: ERP-маршрут
 * открывает ERP даже при включённом флаге Studio.
 */
export function resolveAppMode(pathname: string): AppMode {
  if (isErpOnlyPath(pathname)) return 'erp';
  return isFeatureEnabled('orderStudio') ? 'studio' : 'erp';
}

/**
 * Привести запомненный выбор к тому, что реально показано.
 *
 * Без этого аварийный выход был бы половинчатым: `/board` открылся бы в ERP,
 * а первый же переход в «Заказы» вернул бы Studio — флаг-то остался единицей.
 * Пишем только при расхождении, чтобы не трогать хранилище на каждой отрисовке.
 */
export function rememberMode(mode: AppMode): void {
  const stored = isFeatureEnabled('orderStudio') ? 'studio' : 'erp';
  if (stored !== mode) setFeature('orderStudio', mode === 'studio');
}

/**
 * Идёт намеренное переключение раздела.
 *
 * Флаг живёт в модуле, а не в состоянии React: его спрашивает обработчик
 * `beforeunload`, который к этому моменту уже вне жизненного цикла компонента.
 */
let modeSwitchInFlight = false;

/** Страж «визард не сохранён» обязан пропустить намеренный переход */
export function isModeSwitchInFlight(): boolean {
  return modeSwitchInFlight;
}

/** Адрес, на который уходит переключение (вынесено ради теста) */
export function modeSwitchUrl(mode: AppMode): string {
  return mode === 'studio' ? '/?studio=1' : '/?studio=0';
}

/**
 * Переключить раздел.
 *
 * Полная перезагрузка здесь осознанна: разделы делят один Zustand-стор и
 * подписки realtime, а Order Studio при старте восстанавливает черновик и
 * тянет каталоги. Переключение «на месте» пришлось бы сопровождать ручной
 * уборкой обоих миров — перезагрузка делает это надёжнее и один раз.
 */
export function switchAppMode(mode: AppMode): void {
  modeSwitchInFlight = true;
  setFeature('orderStudio', mode === 'studio');
  // Параметр в адресе — не украшение: он старше localStorage и переживает
  // и чужую вкладку, и запрет на запись в хранилище.
  window.location.assign(modeSwitchUrl(mode));
}

/** Только для тестов: снять метку намеренного перехода */
export function resetModeSwitchForTests(): void {
  modeSwitchInFlight = false;
}
