/**
 * Переход в раздел «Производство»: кнопка в шапке, `LeaveToProduction`
 * (профиль без доступа к заказам v4) и ссылка «Открыть в производстве»
 * после запуска (веха 6+7, `path`).
 *
 * Запоминать ли выбор (веха 8, К1), решает профиль:
 *  - admin/director и профиль без доступа (`canUseSales` ложно) — флаг
 *    `orderStudio` гасится в localStorage (`'0'`), страница грузится заново:
 *    выбор оболочки читает его один раз за загрузку, петли нет;
 *  - продавец, МС, rop — НИЧЕГО не пишется, уход на один заход (`?studio=0`).
 *    Записанный `'0'` запер бы человека в «Производстве» при каждом `/`,
 *    а кнопки обратно там у него нет: следующий вход на `/` — снова раздел.
 *
 * Отдельным модулем, чтобы тест мог подменить навигацию (в jsdom её нет).
 * Путь — только внутренний (`/…`, не `//…` и не `/\…`): чужой адрес сюда не пройдёт.
 */
import { setFeature } from '../config/features';
import { isSalesFirst } from '../config/shellChoice';
import { useAuthStore } from '../store/useAuthStore';
import type { SalesProfile } from './layout/salesAccess';

/** Навигация — объектом, чтобы тест подменил `replace` */
export const nav = {
  replace(url: string): void {
    window.location.replace(url);
  },
};

/** Только внутренний путь: `/…`, но не `//хост` и не `/\хост` (браузер читает `\` как `/`) */
function safePath(path: string): string {
  return /^\/(?![/\\])/.test(path) ? path : '/';
}

/** Внутренний адрес с `studio=0`: ERP на эту загрузку, без записи в хранилище */
export function withStudioOff(path: string): string {
  const url = new URL(safePath(path), 'http://local.invalid');
  url.searchParams.set('studio', '0');
  return `${url.pathname}${url.search}${url.hash}`;
}

export function switchToProduction(
  path = '/',
  profile: SalesProfile | null | undefined = useAuthStore.getState().user,
): void {
  if (isSalesFirst(profile)) {
    nav.replace(withStudioOff(path));
    return;
  }
  setFeature('orderStudio', false);
  nav.replace(safePath(path));
}
