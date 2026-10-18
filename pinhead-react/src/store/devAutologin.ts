import type { User } from '../types/auth';

/**
 * Dev-автологин: фиктивный администратор ВМЕСТО отсутствующей сессии.
 *
 * Раньше он включался от `import.meta.env.DEV`, то есть у любого, кто запустил
 * `npm run dev` — в том числе против боевой базы. Интерфейс показывал полный
 * доступ администратора и не показывал формы входа, а запросы уходили в Supabase
 * ролью `anon`: чтение возвращало пусто («Не удалось загрузить производственный
 * план», «…историю заказа», «…заказ»), запись отвечала `new row violates
 * row-level security policy`. Человек не мог понять, что он просто не вошёл.
 *
 * Проверено на проде 10.08.2026: под `authenticated` вставка в `storage.objects`
 * проходит, под `anon` — 42501 с этим самым текстом, который Storage отдаёт как
 * HTTP 400. На этом не загружалось ни одно ТЗ.
 *
 * Теперь режим включается ЯВНО (`VITE_DEV_AUTOLOGIN=1`) и только когда настоящей
 * сессии нет: сессия всегда важнее подделки. Модуль вынесен из `useAuthStore.ts`
 * в вехе 8 (задача 9) вместе с подменой профиля — стор упирался в потолок размера.
 *
 * Сам флаг `DEV_AUTOLOGIN` в прод-сборке есть (на нём держится `dist-e2e`) —
 * бэклог; подмена профиля — только под `import.meta.env.DEV`.
 */
export const DEV_AUTOLOGIN = import.meta.env.VITE_DEV_AUTOLOGIN === '1';

export const DEV_USER: User = {
  id: 'dev', email: 'dev@pinhead.ru', name: 'Dev Mode',
  role: 'admin', approved: true, active: true, is_sales: false, is_ms: false,
};

/** Вошедший — подделка dev-автологина (в том числе подменённый профиль) */
let active = false;

/**
 * Кем войти без сессии: на dev-сервере — профилем по ключу хранилища
 * (`store/devProfiles.ts`), иначе dev-админом.
 * Импорт ДИНАМИЧЕСКИЙ и под `DEV`: в прод-сборке ветка вырезается вместе
 * с модулем (сторож `checkNoDevProfiles` в `scripts/bundle-budget-m8.mjs`).
 */
export async function devLoginUser(): Promise<User> {
  let user = DEV_USER;
  if (import.meta.env.DEV) {
    const { devProfileFromStorage } = await import('./devProfiles');
    user = devProfileFromStorage() ?? DEV_USER;
  }
  active = true;
  return user;
}

/**
 * Вошедший — подменённый профиль автологина (настоящей сессии нет). Dev-админа
 * (`id 'dev'`) стор узнаёт сам; эту проверку зовёт только под `DEV`
 */
export function isDevLogin(user: User | null | undefined): boolean {
  return !!user && active;
}

/** Выход: следующий вошедший — уже не подделка, пока автологин не сработает снова */
export function endDevLogin(): void {
  active = false;
}
