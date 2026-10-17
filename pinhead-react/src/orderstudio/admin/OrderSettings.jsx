import { Link, useSearchParams } from 'react-router-dom';
/*
 * БЮДЖЕТ ОБОЛОЧКИ ERP (замер 17.10): `Tabs` тянет `erp/styles`. Если в этом
 * ленивом чанке нет и `ErpStates`, Rollup выносит `erp.module.css` из CSS-чанка
 * `ErpStates` в отдельный — CSS оболочки ERP +404 Б gzip, бюджет 16000 не
 * проходит. Раньше `ErpStates` тянула заглушка `tabs/TabStub`; с вехи 4 все
 * вкладки настоящие, и `EmptyState` держит здесь запасная панель неизвестной
 * вкладки. Убирая её, сверять `npm run bundle:budget`.
 */
import { Tabs, TabPanel } from '../../erp/components/Tabs';
import { EmptyState } from '../../erp/components/ErpStates';
import { useAuthStore } from '../../store/useAuthStore';
import { confirm } from '../../store/useConfirmStore';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { catalogHasUnsaved, CATALOG_LEAVE_TEXT } from '../leaveGuard';
import { ORDER_SETTINGS_TABS, tabFromSearch } from './orderSettingsTabs';
import base from '../screens/Sales.module.css';
import styles from './OrderSettings.module.css';
import SuppliersTab from './tabs/SuppliersTab';
import LabelsTab from './tabs/LabelsTab';
import PackagingTab from './tabs/PackagingTab';
import PricingRulesTab from './tabs/PricingRulesTab';
import TzTab from './tabs/TzTab';

/** Панель каждой вкладки реестра (`orderSettingsTabs.ts`); вкладка — `({ readOnly }) => JSX` */
const PANELS = {
  suppliers: SuppliersTab,
  labels: LabelsTab,
  packaging: PackagingTab,
  pricing: PricingRulesTab,
  tz: TzTab,
};

/** Телефон: справочники только для просмотра, правка — с компьютера */
const COMPACT = '(max-width: 760px)';

/** Каталог моделей и общий прайс (`/sku`) открыты только admin и director */
const SKU_ROLES = ['admin', 'director'];

/**
 * Справочники заказа (`/order-settings`): поставщики и палитры, бирки,
 * упаковка, правила цены, подвал ТЗ. Правят admin, director, rop — права
 * на сервере (`catalog_put`, `prices_patch`), экран только передаёт правку.
 * Вкладка — в адресе; смена вкладки и уход со страницы с несохранённым
 * справочником переспрашивают (`leaveGuard`).
 */
export default function OrderSettings() {
  const [params, setParams] = useSearchParams();
  const active = tabFromSearch(params.get('tab'));
  const readOnly = useMediaQuery(COMPACT);
  const role = useAuthStore((s) => s.user?.role);
  const Panel = PANELS[active];

  const select = async (id) => {
    if (id === active) return;
    if (catalogHasUnsaved()) {
      const ok = await confirm({
        title: 'Правки справочника не сохранены',
        message: CATALOG_LEAVE_TEXT,
        confirmLabel: 'Перейти без сохранения',
        cancelLabel: 'Остаться',
        variant: 'danger',
      });
      if (!ok) return;
    }
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('tab', id);
      return next;
    }, { replace: true });
  };

  return (
    <div className={base.page}>
      <div className={base.head}>
        <div>
          <h1 className={base.title}>Справочники заказа</h1>
          <p className={`${base.sub} ${styles.subLine}`}>
            {SKU_ROLES.includes(role) ? (
              <>Ткани и цены моделей — в <Link to="/sku">«Каталоге моделей и цен»</Link></>
            ) : (
              <>Ткани и цены моделей — в «Каталоге моделей и цен» (его правят администратор и директор)</>
            )}
          </p>
        </div>
      </div>

      {readOnly && (
        <p className={styles.readOnlyNote} role="note">
          На телефоне справочники только для просмотра. Править — с компьютера.
        </p>
      )}

      <div className={styles.tabs}>
        <Tabs
          idPrefix="order-settings"
          label="Справочники заказа"
          tabs={ORDER_SETTINGS_TABS}
          active={active}
          onSelect={select}
        />
      </div>
      <TabPanel idPrefix="order-settings" active={active} className={styles.panel}>
        {Panel ? (
          <Panel readOnly={readOnly} />
        ) : (
          <EmptyState icon="settings" title="Справочник не найден" text="Выберите вкладку выше." />
        )}
      </TabPanel>
    </div>
  );
}
