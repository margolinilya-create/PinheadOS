/**
 * Эталон гейтов экрана «ТЗ и цена» / «К запуску» — зеркало миграции J
 * (`…_order_v4_launch.sql`): кто отправляет, отмечает оплату, запускает,
 * возвращает и завершает. Сторож `orderV4Launch.test.ts` сверяет с ним
 * `layout/orderNav.ts` (задача 4) по всей таблице «роль × признаки × автор × статус».
 *
 * Правила J:
 *   · действующий профиль — active и approved (все хелперы `sales_is_*`);
 *   · руководство продаж (lead) — admin, director, rop; руководство производства
 *     (boss) — admin, director;
 *   · автор — `sales_is_seller() and created_by = auth.uid()` (признак `is_sales`, К20);
 *   · отправка `draft → ready_to_launch` — автор или lead;
 *   · оплата — автор или lead в `draft`/`ready_to_launch`; МС — только
 *     `ready_to_launch` и не свой заказ (право ERP `order.manage` проверяет сервер);
 *   · «без оплаты» — lead; запуск, возврат, завершение — МС или boss (rop — нет, К17).
 */

export interface GateProfile {
  id: string;
  role: string;
  is_sales: boolean;
  is_ms: boolean;
  active: boolean;
  approved: boolean;
}

export interface GateOrder {
  status: string;
  created_by: string | null;
}

export interface GateModule {
  canSendToWork: (p: GateProfile, o: GateOrder) => boolean;
  canSetPayment: (p: GateProfile, o: GateOrder) => boolean;
  canSetPaymentOverride: (p: GateProfile) => boolean;
  canLaunch: (p: GateProfile, o: GateOrder) => boolean;
  canReturn: (p: GateProfile, o: GateOrder) => boolean;
  canFinish: (p: GateProfile, o: GateOrder) => boolean;
  canSeeLaunchQueue: (p: GateProfile) => boolean;
}

export const GATE_NAMES: (keyof GateModule)[] = [
  'canSendToWork', 'canSetPayment', 'canSetPaymentOverride', 'canLaunch', 'canReturn', 'canFinish',
  'canSeeLaunchQueue',
];

const live = (p: GateProfile) => p.active && p.approved;
const lead = (p: GateProfile) => live(p) && ['admin', 'director', 'rop'].includes(p.role);
const boss = (p: GateProfile) => live(p) && ['admin', 'director'].includes(p.role);
const ms = (p: GateProfile) => live(p) && p.is_ms;
const author = (p: GateProfile, o: GateOrder) => live(p) && p.is_sales && o.created_by === p.id;
const msOrBoss = (p: GateProfile) => ms(p) || boss(p);

export const expectedGates: GateModule = {
  canSendToWork: (p, o) => o.status === 'draft' && (lead(p) || author(p, o)),
  canSetPayment: (p, o) =>
    (['draft', 'ready_to_launch'].includes(o.status) && (lead(p) || author(p, o)))
    || (o.status === 'ready_to_launch' && ms(p) && o.created_by !== p.id),
  canSetPaymentOverride: (p) => lead(p),
  canLaunch: (p, o) => o.status === 'ready_to_launch' && msOrBoss(p),
  canReturn: (p, o) => o.status === 'ready_to_launch' && msOrBoss(p),
  canFinish: (p, o) => o.status === 'production' && msOrBoss(p),
  canSeeLaunchQueue: (p) => msOrBoss(p),
};

const ROLES = ['admin', 'director', 'rop', 'manager', 'production', 'designer'];
const STATUSES = ['draft', 'ready_to_launch', 'production', 'done', 'archived'];
const ME = '00000000-0000-4000-8000-000000000001';
const OTHER = '00000000-0000-4000-8000-000000000002';

/** Все сочетания профиля и заказа: роль × is_sales × is_ms × одобрен × автор × статус */
function* cases(): Generator<[GateProfile, GateOrder]> {
  for (const role of ROLES) {
    for (const is_sales of [false, true]) {
      for (const is_ms of [false, true]) {
        for (const approved of [false, true]) {
          for (const mine of [false, true]) {
            for (const status of STATUSES) {
              yield [
                { id: ME, role, is_sales, is_ms, active: true, approved },
                { status, created_by: mine ? ME : OTHER },
              ];
            }
          }
        }
      }
    }
  }
}

/** Расхождения гейтов модуля с эталоном J: «гейт: профиль / заказ → было, ждали» */
export function gateParityViolations(mod: GateModule): string[] {
  const out: string[] = [];
  for (const [p, o] of cases()) {
    for (const name of GATE_NAMES) {
      const got = Boolean((mod[name] as (pp: GateProfile, oo: GateOrder) => boolean)(p, o));
      const want = (expectedGates[name] as (pp: GateProfile, oo: GateOrder) => boolean)(p, o);
      if (got !== want) {
        out.push(`${name}: ${p.role} sales=${p.is_sales} ms=${p.is_ms} approved=${p.approved} `
          + `${o.created_by === p.id ? 'автор' : 'чужой'} ${o.status} → ${got}, ждали ${want}`);
      }
    }
  }
  return out;
}
