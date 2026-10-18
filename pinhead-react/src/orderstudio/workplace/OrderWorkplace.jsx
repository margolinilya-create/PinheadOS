import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { useAuthStore } from '../../store/useAuthStore';
import { useStore } from '../../store/useStore';
import { factoryDate } from '../../utils/date';
import ErrorBoundary from '../../components/shared/ErrorBoundary';
import { EmptyState } from '../../erp/components/ErpStates';
/*
 * Скелет загрузки — тот же примитив, что у списка заказов. Импорт держит
 * ErpStates и ErpSkeletons в ОДНОМ общем чанке: с одним ErpStates сборка
 * выносила ErpSkeletons отдельным чанком, и оболочка ERP прибавляла ~270 Б.
 */
import { ScreenSkeleton } from '../../erp/components/ErpSkeletons';
import { useSalesStore, isTerminalSaveState } from '../store/useSalesStore';
import { isEditable } from '../model/editable';
import { newSalesItem } from '../model/factory';
import { duplicateInColor, splitByColor } from '../model/itemOps';
import { rulesFromPrices, useOrderPrice } from '../screens/useOrderPrice';
import { STATUS_LABELS } from '../screens/labels';
import { useTzCatalogs } from '../tz/tzCatalogs';
import { useSendChecklist } from '../tz/useSendChecklist';
import ReturnBanner from '../tz/ui/ReturnBanner';
import HeadActions from './HeadActions';
import ItemList from './ItemList';
import ItemTab from './ItemTab';
import ClientTab from './ClientTab';
import SummaryTab from './SummaryTab';
import SaveIndicator from './SaveIndicator';
import { TabMarker } from './TabMarker';
import { revealTab } from './tabState';
import { confirmSplit } from './confirmSplit';
import sales from '../screens/Sales.module.css';
import styles from './Workplace.module.css';

/**
 * Вкладка «Дизайн» — ленивый чанк холста (konva, панель, стор дизайна):
 * в оболочку Order он не попадает (страж `bundle-budget`, маркер `data-design-canvas`)
 */
const DesignTab = lazy(() => import('../design/ui/DesignTab'));

const TABS = [
  { key: 'item', label: 'Изделие' },
  { key: 'design', label: 'Дизайн' },
  { key: 'client', label: 'Клиент' },
  { key: 'summary', label: 'ТЗ и цена' },
];
const TAB_KEYS = TABS.map((t) => t.key);

/**
 * Рабочее место заказа v4 `/sales/:id` (веха 3): список изделий и вкладки —
 * «Изделие», «Дизайн» (веха 5а: холст, ленивый чанк), «Клиент», «ТЗ и цена».
 * Вкладка и позиция — в адресе (`?tab=item|design|client|summary&item=<key>`).
 *
 * Открытие заказа ничего не пишет: новая позиция — только по кнопке.
 * Уход с экрана сохраняет несохранённое сразу (`flush`).
 *
 * Веха 6+7 (задача 5): в шапке — бейдж оплаты, «Отправить в работу» (навигация
 * к разделу отправки «ТЗ и цена» с числом блокирующих пунктов) и «Отметить:
 * заказ сдан»; над вкладками — плашки «отправлен» и «вернули». Пока идёт
 * отправка, содержимое вкладок — в `fieldset disabled` (вкладки для просмотра
 * остаются), уход спрашивает `leaveGuard`.
 */
export default function OrderWorkplace() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const compact = useMediaQuery('(max-width: 760px)');
  const { order, loading, saveState, sending, open, flush, edit } = useSalesStore(useShallow((s) => ({
    order: s.current,
    loading: s.currentLoading,
    saveState: s.saveState,
    sending: s.sending,
    open: s.open,
    flush: s.flush,
    edit: s.edit,
  })));
  const user = useAuthStore((s) => s.user);
  const prices = useStore((s) => s.prices);
  const price = useOrderPrice(order);
  const { catalogs, failed: catalogsFailed } = useTzCatalogs();
  const minMarginPct = rulesFromPrices(prices ?? {}).minMarginPct;
  const marginPct = price?.margin_pct ?? null;
  /** Чек-лист отправки (T2, модель — ленивым чанком) — один на шапку и раздел «Отправить в работу» */
  const checklist = useSendChecklist(order, catalogs, { marginPct, minMarginPct: minMarginPct ?? null });
  const blocking = (checklist ?? []).filter((i) => i.blocking && !i.ok).length;
  /** Фокус на заголовок раздела отправки — после кнопки шапки */
  const [focusSend, setFocusSend] = useState(false);
  const onSendFocused = useCallback(() => setFocusSend(false), []);
  const tabRefs = useRef(new Map());
  /*
   * Фокус в первое поле «Клиента» — только после «Далее: клиент и доставка».
   * Переход стрелками или кликом по вкладке оставляет фокус на tablist
   * (образец WAI-ARIA Tabs), поэтому `autoFocus` у поля нет.
   */
  const [focusClient, setFocusClient] = useState(false);

  useEffect(() => {
    if (id) open(id);
  }, [id, open]);
  // Уход с экрана сохраняет несохранённое, не дожидаясь паузы
  useEffect(() => () => { flush(); }, [flush]);

  const tab = TAB_KEYS.includes(params.get('tab')) ? params.get('tab') : 'item';
  const wantedItem = params.get('item');
  // На ≤ 480 px ряд вкладок может прокручиваться: активная — всегда в видимой
  // части; и после загрузки заказа (до неё вместо вкладок — скелет)
  const hasOrder = !!order;
  useEffect(() => { revealTab(tabRefs.current.get(tab)); }, [tab, hasOrder]);

  /** Сменить вкладку и/или позицию в адресе; прочие параметры остаются */
  const go = useCallback((next) => {
    setParams((prev) => {
      const p = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(next)) {
        if (v == null) p.delete(k);
        else p.set(k, v);
      }
      return p;
    }, { replace: true });
  }, [setParams]);

  /** Кнопка шапки: только навигация к разделу отправки (`?tab=summary#send`) */
  const goSend = () => {
    const p = new URLSearchParams(params);
    p.set('tab', 'summary');
    navigate({ search: `?${p}`, hash: '#send' }, { replace: true });
    setFocusSend(true);
  };

  if (loading) return <div className={sales.page}><ScreenSkeleton /></div>;
  if (!order && id) {
    return <div className={sales.page}><div className={sales.empty}>Заказ не найден</div></div>;
  }
  if (!order) return null;

  const readOnly = !isEditable(order) || isTerminalSaveState(saveState);
  const items = order.items;
  const selected = items.find((it) => it.key === wantedItem) ?? items[0] ?? null;
  const itemPrice = selected ? price?.items.find((p) => p.key === selected.key) ?? null : null;

  const set = (patch) => edit((o) => ({ ...o, ...patch }));
  const setItem = (key, patch) => edit((o) => ({
    ...o,
    items: o.items.map((it) => (it.key === key ? { ...it, ...patch } : it)),
  }));
  const addItem = () => {
    const item = newSalesItem();
    edit((o) => ({ ...o, items: [...o.items, item] }));
    go({ tab: 'item', item: item.key });
  };
  const copyColor = (key, color) => {
    const src = items.find((it) => it.key === key);
    if (!src) return;
    const copy = duplicateInColor(src, color);
    edit((o) => {
      const i = o.items.findIndex((it) => it.key === key);
      return { ...o, items: [...o.items.slice(0, i + 1), copy, ...o.items.slice(i + 1)] };
    });
    go({ item: copy.key });
  };
  const split = (key) => edit((o) => ({
    ...o,
    items: o.items.flatMap((it) => (it.key === key ? splitByColor(it) : [it])),
  }));
  const remove = (key) => {
    const i = items.findIndex((it) => it.key === key);
    const neighbour = items[i + 1] ?? items[i - 1];
    edit((o) => ({ ...o, items: o.items.filter((it) => it.key !== key) }));
    go({ item: neighbour?.key ?? null });
  };
  const splitFromNotice = async (key) => {
    const it = items.find((x) => x.key === key);
    if (it && await confirmSplit(it)) split(key);
  };

  const onTabKey = (e, index) => {
    const last = TABS.length - 1;
    const to = {
      ArrowRight: index === last ? 0 : index + 1,
      ArrowLeft: index === 0 ? last : index - 1,
      Home: 0,
      End: last,
    }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    const key = TABS[to].key;
    go({ tab: key });
    tabRefs.current.get(key)?.focus();
  };

  const itemHref = (key) => `/sales/${id}?tab=item&item=${encodeURIComponent(key)}`;

  return (
    <div className={`${sales.page} ${styles.workplace}`}>
      <header className={styles.head}>
        <button type="button" className={sales.back} onClick={() => navigate('/sales')}>← Заказы</button>
        <h1 className={sales.title}>{order.number || 'Новый заказ'}{order.customer ? ` · ${order.customer}` : ''}</h1>
        <div className={styles.headRow}>
          <span className={sales.badge}>{STATUS_LABELS[order.status]}</span>
          <SaveIndicator order={order} saveState={saveState} />
          <HeadActions order={order} user={user} blocking={blocking} onGoSend={goSend} />
        </div>
      </header>

      <ReturnBanner order={order} />

      <div role="tablist" aria-label="Разделы заказа" className={styles.tabs}>
        {TABS.map((t, i) => {
          const active = t.key === tab;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              id={`wp-tab-${t.key}`}
              ref={(el) => { if (el) tabRefs.current.set(t.key, el); else tabRefs.current.delete(t.key); }}
              aria-selected={active}
              aria-controls={`wp-panel-${t.key}`}
              tabIndex={active ? 0 : -1}
              className={`${styles.tab} ${active ? styles.tabActive : ''}`.trim()}
              onClick={() => go({ tab: t.key })}
              onKeyDown={(e) => onTabKey(e, i)}
            >
              {t.label}<TabMarker tabKey={t.key} order={order} />
            </button>
          );
        })}
      </div>

      <div role="tabpanel" id={`wp-panel-${tab}`} aria-labelledby={`wp-tab-${tab}`} className={styles.panel}>
        {/* Отправка в работу: правка закрыта и в интерфейсе, вкладки выше — для просмотра */}
        <fieldset className={styles.fieldset} disabled={sending} aria-busy={sending || undefined}>
          {(tab === 'item' || tab === 'design') && items.length === 0 && (
            <EmptyState
              icon="inbox"
              title="В заказе пока нет изделий"
              text={readOnly ? undefined : 'Добавьте первое изделие — модель, ткань, цвет и размеры.'}
              action={!readOnly && (
                <button type="button" className="btn btn-primary" onClick={addItem}>Добавить изделие</button>
              )}
            />
          )}
          {tab === 'design' && selected && (
            <div className={styles.designLayout}>
              <ItemList
                order={order}
                selectedKey={selected.key}
                onSelect={(key) => go({ item: key })}
                onAdd={addItem}
                onCopyColor={copyColor}
                onRemove={remove}
                onSplit={split}
                readOnly={readOnly}
                compact
              />
              <ErrorBoundary
                key={selected.key}
                fallback={<p className={sales.empty}>Холст не открылся — обновите страницу. Нанесения можно править на вкладке «Изделие».</p>}
              >
                <Suspense fallback={<p className={sales.empty} role="status">Загружаю холст…</p>}>
                  <DesignTab
                    order={order}
                    item={selected}
                    price={itemPrice}
                    readOnly={readOnly}
                    compact={compact}
                    onOpenItem={() => go({ tab: 'item' })}
                  />
                </Suspense>
              </ErrorBoundary>
              <div className={styles.next}>
                <button type="button" className="btn btn-primary" onClick={() => { setFocusClient(true); go({ tab: 'client' }); }}>
                  Далее: клиент и доставка
                </button>
              </div>
            </div>
          )}
          {tab === 'item' && selected && (
            <div className={styles.itemLayout}>
              <ItemList
                order={order}
                selectedKey={selected?.key}
                onSelect={(key) => go({ item: key })}
                onAdd={addItem}
                onCopyColor={copyColor}
                onRemove={remove}
                onSplit={split}
                readOnly={readOnly}
                compact={compact}
              />
              <div className={styles.itemMain}>
                <ItemTab
                  key={selected.key}
                  item={selected}
                  price={itemPrice}
                  readOnly={readOnly}
                  compact={compact}
                  onChange={(patch) => setItem(selected.key, patch)}
                  onSplit={splitFromNotice}
                  onOpenDesign={() => go({ tab: 'design' })}
                />
                <div className={styles.next}>
                  <button type="button" className="btn btn-primary" onClick={() => { setFocusClient(true); go({ tab: 'client' }); }}>
                    Далее: клиент и доставка
                  </button>
                </div>
              </div>
            </div>
          )}
          {tab === 'client' && (
            <ClientTab
              order={order}
              readOnly={readOnly}
              onChange={set}
              focusFirst={focusClient}
              onFocused={() => setFocusClient(false)}
            />
          )}
          {tab === 'summary' && (
            <SummaryTab
              order={order}
              price={price}
              readOnly={readOnly}
              itemHref={itemHref}
              onDiscount={(discount) => set({ discount })}
              user={user}
              catalogs={catalogs}
              catalogsFailed={catalogsFailed}
              checklist={checklist}
              today={factoryDate(new Date())}
              focusSend={focusSend}
              onSendFocused={onSendFocused}
            />
          )}
        </fieldset>
      </div>
    </div>
  );
}
