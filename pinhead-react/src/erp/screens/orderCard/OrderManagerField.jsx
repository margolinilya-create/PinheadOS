import { useEffect, useId, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useErpStore } from '../../store/useErpStore';
import styles from '../../styles';

/**
 * «Менеджер заказа (сотрудник)» — `erp_orders.manager_id` (правки 19.10,
 * п. 7, решение Р3). Не то же самое, что текстовый «Менеджер» рядом: тот —
 * подпись из формы заказа, этот — учётная запись, которая становится
 * наблюдателем бизнес-задач заказа и получателем их уведомлений.
 *
 * Правит `order.manage` (страж `erp_order_guard` охраняет новую колонку
 * по умолчанию), и только СОТРУДНИКОМ ERP: в списке — люди справочника чата
 * с карточкой `erp_employees` (`role` не пустой). Без права — только имя.
 */
export function OrderManagerField({ order, canManage, onSave }) {
  const id = useId();
  const { directory, loaded, load } = useErpStore(useShallow((s) => ({
    directory: s.chatDirectory,
    loaded: s.chatDirectoryLoaded,
    load: s.loadChatDirectory,
  })));
  useEffect(() => { if (!loaded) void load(); }, [loaded, load]);

  const staff = useMemo(
    () => (directory ?? []).filter((p) => p.role !== null)
      .sort((a, b) => a.name.localeCompare(b.name, 'ru')),
    [directory],
  );
  const current = order.manager_id ?? '';
  const name = (directory ?? []).find((p) => p.user_id === current)?.name;
  const [busy, setBusy] = useState(false);

  if (!canManage) {
    return (
      <span>
        <span className={styles.subText}>Менеджер заказа (сотрудник): </span>
        {name ?? (current ? 'сотрудник' : 'не назначен')}
      </span>
    );
  }
  return (
    <span>
      <label htmlFor={id} className={styles.subText}>Менеджер заказа (сотрудник)</label>{' '}
      <select
        id={id}
        className={`${styles.select} ${styles.inputSm}`}
        value={current}
        disabled={busy}
        onChange={async (e) => {
          setBusy(true);
          await onSave({ manager_id: e.target.value || null });
          setBusy(false);
        }}
      >
        <option value="">не назначен</option>
        {/* Назначенный, но уже без карточки сотрудника, не пропадает молча */}
        {current && !staff.some((p) => p.user_id === current) && (
          <option value={current}>{name ?? 'сотрудник'}</option>
        )}
        {staff.map((p) => <option key={p.user_id} value={p.user_id}>{p.name}</option>)}
      </select>
    </span>
  );
}
