import { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useErpStore } from '../../store/useErpStore';
import { useErpAccess } from '../../store/useErpAccess';
import { LoadFailed } from '../../components/ErpStates';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { confirm } from '../../../store/useConfirmStore';
import { formatDateTimeShort } from '../../utils/format';
import { BYPASS_KINDS, BYPASS_KIND_HINTS, BYPASS_KIND_LABELS } from '../../types';
import { activeBypasses } from '../../utils/bypass';
import styles from '../../styles';

/** Сентинел «вся система» в селекте: в базе это `null`, а пустая строка — «не выбрано» */
const ALL_ORDERS = 'ALL';

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
  const {
    bypasses, bypassesLoaded, bypassesError, loadBypasses, createBypass, restoreBypass, orders,
  } = useErpStore(
    useShallow((s) => ({
      bypasses: s.bypasses,
      bypassesLoaded: s.bypassesLoaded,
      bypassesError: s.bypassesError,
      loadBypasses: s.loadBypasses,
      createBypass: s.createBypass,
      restoreBypass: s.restoreBypass,
      orders: s.orders,
    })),
  );
  const access = useErpAccess();
  const canManage = access.can('bypass.manage');

  const [kind, setKind] = useState(BYPASS_KINDS[0]);
  /**
   * Область снятия. Пустая строка — «человек ещё не выбрал», и это НЕ то же
   * самое, что «вся система»: в базе система обозначена `null`, а до выбора
   * действие заблокировано.
   */
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
    /**
     * ПОДТВЕРЖДЕНИЕ СТОИТ НА СНЯТИИ, А НЕ ТОЛЬКО НА ВОЗВРАТЕ (обход 04.09).
     * Было наоборот: возврат проверки — действие безопасное, «стало как
     * задумано» — спрашивал, а снятие, открывающее производству работу
     * без материалов или без ТЗ, выполнялось с первого нажатия. Диалог
     * называет ПОСЛЕДСТВИЕ и область, а не механику: «вся система» —
     * это все заказы разом, и увидеть это человек обязан до нажатия,
     * а не в списке снятых после.
     */
    const scope = orderId === ALL_ORDERS
      ? 'ВСЕЙ СИСТЕМЕ — всем заказам разом'
      : `заказу «${orderTitle(orderId)}»`;
    const ok = await confirm({
      title: 'Снять проверку?',
      message: `${BYPASS_KIND_HINTS[kind]}. Действует по ${scope}. Снятие видно цеху в очереди и остаётся в журнале.`,
      confirmLabel: 'Снять проверку',
      variant: 'danger',
    });
    if (!ok) return;
    setBusy(true);
    // `null` в базе означает «вся система»; сентинел живёт только в форме
    const created = await createBypass(kind, orderId === ALL_ORDERS ? null : orderId, reason);
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

      {/*
        «ВСЕ ПРОВЕРКИ ДЕЙСТВУЮТ» — ЭТО УТВЕРЖДЕНИЕ, А НЕ ЗАГЛУШКА (правка 03.09).
        Экран отвечает ровно на вопрос «не снята ли где-то проверка», и до
        загрузки он отвечал «нет» — не зная. При отказе загрузки отвечал так же
        и навсегда: fail-open ставит `bypassesLoaded = true` даже при ошибке,
        то есть пустой список неотличим от «не привезли».
      */}
      {bypassesError && (
        <LoadFailed onRetry={loadBypasses} what="снятые проверки" />
      )}
      {!bypassesLoaded && !bypassesError && (
        <p className={styles.subText}>Проверяем, не снята ли где-то блокировка…</p>
      )}
      {/*
        ГЛАВНЫЙ ОТВЕТ ЭКРАНА НАБРАН КАК ГЛАВНЫЙ (обход 04.09). «Все проверки
        действуют» — то, ради чего сюда и заходят, — стояло 12-м кеглем
        служебного `subText`, вровень со строкой загрузки. Состояние системы
        безопасности не бывает примечанием.
      */}
      {bypassesLoaded && !bypassesError && active.length === 0 ? (
        <p className={styles.bypassOk}>
          <Icon name="checkCircle" size={16} /> Все проверки действуют
        </p>
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
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value)}
              aria-describedby="bypass-kind-hint"
            >
              {BYPASS_KINDS.map((k) => (
                <option key={k} value={k}>{BYPASS_KIND_LABELS[k]}</option>
              ))}
            </select>
          </label>
          {/*
            ПОДСКАЗКА ВЫНЕСЕНА ИЗ ЯРЛЫКА (обход 04.09): внутри `<label>` она
            становилась частью доступного имени поля, и скринридер читал
            «Что снимаем Цех сможет взять задание, пока склад…» вместо
            названия поля. Связь — `aria-describedby`: подсказка остаётся
            прочитанной, но после имени и как описание.
          */}
          <p id="bypass-kind-hint" className={styles.queueReason}>{BYPASS_KIND_HINTS[kind]}</p>

          <label className={styles.field}>
            <span className={styles.fieldLabel}>Где</span>
            {/*
              ПО УМОЛЧАНИЮ ВЫБОР НЕ СДЕЛАН (обход 04.09). Стояла «Вся система» —
              самый широкий из возможных вариантов, при том что подсказка рядом
              советует снимать точечно. Умолчание — это рекомендация, и оно
              не должно рекомендовать худшее; пустое значение заставляет назвать
              область явно, а submit заблокирован, пока она не названа.
            */}
            <select
              value={orderId}
              onChange={(e) => setOrderId(e.target.value)}
              aria-describedby="bypass-scope-hint"
            >
              <option value="">— выберите —</option>
              <option value={ALL_ORDERS}>Вся система (все заказы)</option>
              {activeOrders.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.title || o.bitrix_id || o.id.slice(0, 8)}
                </option>
              ))}
            </select>
          </label>
          <p id="bypass-scope-hint" className={styles.queueReason}>
            Один застрявший заказ лучше снимать точечно — остальное производство
            продолжит работать по обычным правилам.
          </p>

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
            disabled={busy || reason.trim().length === 0 || orderId === ''}
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
