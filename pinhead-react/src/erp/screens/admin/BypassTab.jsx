import { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useErpStore } from '../../store/useErpStore';
import { useErpAccess } from '../../store/useErpAccess';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { confirm } from '../../../store/useConfirmStore';
import { formatDateTimeShort } from '../../utils/format';
import { BYPASS_KINDS, BYPASS_KIND_HINTS, BYPASS_KIND_LABELS } from '../../types';
import { activeBypasses } from '../../utils/bypass';
import styles from '../../styles';

/**
 * Аварийный режим: временно снять блокирующую проверку.
 *
 * Заказчик просил механику на случай, когда обязательная проверка из-за бага
 * останавливает работу целиком: администратор снимает именно её и продолжает
 * процесс, не дожидаясь исправления.
 *
 * Экран намеренно неудобен для повседневного использования: причина обязательна,
 * снятие всегда видно в верхнем списке, а рядом с каждым — кто и когда его сделал.
 * Аварийный выход, которым пользуются каждый день, перестаёт быть аварийным
 * и превращается в тихо отключённый контроль.
 */
export function BypassTab() {
  const { bypasses, bypassesLoaded, loadBypasses, createBypass, restoreBypass, orders } = useErpStore(
    useShallow((s) => ({
      bypasses: s.bypasses,
      bypassesLoaded: s.bypassesLoaded,
      loadBypasses: s.loadBypasses,
      createBypass: s.createBypass,
      restoreBypass: s.restoreBypass,
      orders: s.orders,
    })),
  );
  const access = useErpAccess();
  const canManage = access.can('bypass.manage');

  const [kind, setKind] = useState(BYPASS_KINDS[0]);
  const [orderId, setOrderId] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!bypassesLoaded) loadBypasses();
  }, [bypassesLoaded, loadBypasses]);

  const active = useMemo(() => activeBypasses(bypasses), [bypasses]);
  const history = useMemo(() => bypasses.filter((b) => b.restored_at !== null), [bypasses]);
  const orderTitle = useMemo(() => {
    const map = new Map(orders.map((o) => [o.id, o.title || o.bitrix_id || o.id.slice(0, 8)]));
    return (id) => (id ? map.get(id) || 'заказ не в списке' : 'вся система');
  }, [orders]);

  const activeOrders = useMemo(
    () => orders.filter((o) => o.status === 'active'), [orders],
  );

  const submit = async () => {
    setBusy(true);
    const created = await createBypass(kind, orderId || null, reason);
    setBusy(false);
    if (created) {
      setReason('');
      setOrderId('');
    }
  };

  const restore = async (b) => {
    const ok = await confirm({
      title: 'Вернуть проверку?',
      message: `«${BYPASS_KIND_LABELS[b.kind]}» снова начнёт действовать для ${orderTitle(b.order_id)}.`,
      confirmLabel: 'Вернуть',
    });
    if (!ok) return;
    setBusy(true);
    await restoreBypass(b.id);
    setBusy(false);
  };

  return (
    <div className={styles.matSection}>
      <p className={styles.queueReason}>
        Снимайте проверку, только когда она мешает работать из-за ошибки в системе.
        Снятие видно всем, попадает в журнал и действует, пока его не вернут.
      </p>

      {active.length === 0 ? (
        <p className={styles.subText}>Все проверки действуют.</p>
      ) : (
        <div className={styles.matSection}>
          <h3 className={styles.fieldLabel}>Сейчас сняты</h3>
          {active.map((b) => (
            <div key={b.id} className={styles.matSectionHead}>
              <div>
                <strong>{BYPASS_KIND_LABELS[b.kind]}</strong>
                {' · '}
                {orderTitle(b.order_id)}
              </div>
              <div className={styles.subText}>
                {b.reason}
                {' — '}
                {b.created_by || 'неизвестно'}
                {', '}
                {formatDateTimeShort(b.created_at)}
              </div>
              {canManage && (
                <Button variant="secondary" disabled={busy} onClick={() => restore(b)}>
                  <Icon name="undo" size={14} /> Вернуть проверку
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {canManage && (
        <div className={styles.matSection}>
          <h3 className={styles.fieldLabel}>Снять проверку</h3>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Что снимаем</span>
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              {BYPASS_KINDS.map((k) => (
                <option key={k} value={k}>{BYPASS_KIND_LABELS[k]}</option>
              ))}
            </select>
            <span className={styles.queueReason}>{BYPASS_KIND_HINTS[kind]}</span>
          </label>

          <label className={styles.field}>
            <span className={styles.fieldLabel}>Где</span>
            <select value={orderId} onChange={(e) => setOrderId(e.target.value)}>
              <option value="">Вся система</option>
              {activeOrders.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.title || o.bitrix_id || o.id.slice(0, 8)}
                </option>
              ))}
            </select>
            <span className={styles.queueReason}>
              Один застрявший заказ лучше снимать точечно — остальное производство
              продолжит работать по обычным правилам.
            </span>
          </label>

          <label className={styles.field}>
            <span className={styles.fieldLabel}>Причина</span>
            <input
              className={styles.input}
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="напр. склад не может провести приёмку из-за ошибки"
            />
          </label>

          <Button
            variant="danger"
            disabled={busy || reason.trim().length === 0}
            onClick={submit}
          >
            Снять проверку
          </Button>
        </div>
      )}

      {history.length > 0 && (
        <div className={styles.matSection}>
          <h3 className={styles.fieldLabel}>Журнал</h3>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
            <thead>
              <tr>
                <th>Проверка</th>
                <th>Где</th>
                <th>Причина</th>
                <th>Снял</th>
                <th>Вернул</th>
              </tr>
            </thead>
            <tbody>
              {history.map((b) => (
                <tr key={b.id}>
                  <td>{BYPASS_KIND_LABELS[b.kind]}</td>
                  <td>{orderTitle(b.order_id)}</td>
                  <td>{b.reason}</td>
                  <td>{b.created_by || '—'}<br /><span className={styles.subText}>{formatDateTimeShort(b.created_at)}</span></td>
                  <td>{b.restored_by || '—'}<br /><span className={styles.subText}>{formatDateTimeShort(b.restored_at)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}
    </div>
  );
}
