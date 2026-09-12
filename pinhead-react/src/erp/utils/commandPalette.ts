import { NAV_GROUPS } from '../layout/navGroups';
import { canOpenScreen } from './screenAccess';
import { matchesOrderQuery } from './orderSearch';
import { deptShortName, isProductionDept } from '../data/departments';
import type { ErpPermission } from '../types';

/** Сколько заказов показываем: палитра — это переход, а не список заказов. */
export const ORDER_LIMIT = 6;

export type CommandEntry = {
  /** Уникальный ключ: он же id опции для `aria-activedescendant`. */
  key: string;
  /** Что видит человек. */
  label: string;
  /** Пояснение справа: раздел, цех, заказчик. */
  hint?: string;
  /** Куда ведёт. */
  to: string;
  /** Имя иконки из своего набора. */
  icon: string;
  group: 'Разделы' | 'Цеха' | 'Заказы';
};

type Access = {
  can: (p: ErpPermission) => boolean;
  isAdmin: boolean;
};

/** Нормализация запроса: регистр и лишние пробелы не должны ничего решать. */
const norm = (s: string) => s.toLowerCase().trim();

/**
 * ЧТО ПРЕДЛОЖИТЬ ПО ЗАПРОСУ — чистой функцией, отдельно от разметки.
 *
 * ─── ГЕЙТ ПО ПРАВУ ОБЯЗАТЕЛЕН ─────────────────────────────────────────────
 * Палитра — это ещё один вход в разделы, и он обязан быть закрыт ровно так же,
 * как меню и как маршрут: `canOpenScreen` плюс `admin`. Иначе получится
 * «декоративное право» наоборот — предложение, ведущее в отказ. В проекте
 * этот дефект уже был: 10.08 разделы «Операции» гейтились ролью учётной
 * записи двумя независимыми списками, и выданные права оказались недостижимы.
 *
 * ─── РАЗДЕЛЫ БЕРУТСЯ ИЗ МЕНЮ, ЦЕХА — ИЗ ДАННЫХ ────────────────────────────
 * `NAV_GROUPS` — тот же список, что рисует сайдбар. Цеха не перечисляются
 * вовсе: участок заводится в админке, и константа «какие бывают цеха»
 * не показала бы новый (правило проекта о `is_production`).
 *
 * ─── ЗАКАЗЫ ИЩЕТ ТОТ ЖЕ МАТЧЕР, ЧТО И СПИСОК ──────────────────────────────
 * `matchesOrderQuery` — он же стоит за поиском в шапке и на экране заказов.
 * Своё сравнение здесь означало бы, что поиск в двух местах находит разное.
 */
export function buildCommandEntries(
  query: string,
  {
    access,
    departments,
    orders,
  }: {
    access: Access;
    departments: Array<{ id: string; code: string; name: string; active?: boolean; is_production?: boolean }>;
    orders: Array<{ id: string; order_number?: string | null; bitrix_id?: string | null; title?: string | null; customer?: string | null }>;
  },
): CommandEntry[] {
  const q = norm(query);
  const out: CommandEntry[] = [];

  for (const group of NAV_GROUPS) {
    for (const item of group.items) {
      // Оба условия, и ровно те же, что у сайдбара
      if (item.admin && !access.isAdmin) continue;
      if (!canOpenScreen(access.can, item.to)) continue;
      if (q && !norm(item.label).includes(q)) continue;
      out.push({
        key: `screen:${item.to}`,
        label: item.label,
        hint: group.title,
        to: item.to,
        icon: item.icon,
        group: 'Разделы',
      });
    }
  }

  for (const dept of departments) {
    if (dept.active === false) continue;
    if (!isProductionDept(dept)) continue;
    const short = deptShortName(dept.code, dept.name);
    if (q && !norm(short).includes(q) && !norm(dept.name).includes(q)) continue;
    out.push({
      key: `dept:${dept.id}`,
      label: short,
      hint: 'Очередь участка',
      to: `/queue/${dept.code}`,
      icon: 'board',
      group: 'Цеха',
    });
  }

  /**
   * ЗАКАЗЫ — ТОЛЬКО ПО ЗАПРОСУ. Пустой `matchesOrderQuery` совпадает со всем,
   * и без этой проверки открытая палитра сразу показывала бы шесть случайных
   * заказов — то есть отвечала бы на вопрос, которого не задавали.
   */
  if (q) {
    for (const order of orders) {
      if (out.filter((e) => e.group === 'Заказы').length >= ORDER_LIMIT) break;
      if (!matchesOrderQuery(order, query)) continue;
      const num = order.bitrix_id || order.order_number || '—';
      out.push({
        key: `order:${order.id}`,
        label: `№${num}${order.title ? ` · ${order.title}` : ''}`,
        hint: order.customer || 'Заказ',
        to: `/orders/${order.id}`,
        icon: 'orders',
        group: 'Заказы',
      });
    }
  }

  return out;
}

/**
 * Следующий выбранный по стрелке — С ЗАВОРОТОМ по кругу.
 *
 * Выделено функцией, потому что у списка ДВА конца и оба легко сделать
 * тупиком: без заворота «вниз» на последнем не делает ничего, и человек
 * решает, что палитра зависла. Пустой список отдаёт 0 — индекс, которым
 * нечего выбрать, и `Enter` на нём ничего не откроет.
 */
export function nextIndex(current: number, total: number, delta: 1 | -1): number {
  if (total <= 0) return 0;
  return (current + delta + total) % total;
}
