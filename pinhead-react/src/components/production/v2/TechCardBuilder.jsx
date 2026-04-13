// redesign/v2 — Tech Card Builder
//
// Full CRUD for a single order's tech card.

import { useEffect, useState, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '../../../lib/supabase';
import { useTechCardStore } from '../../../store/useTechCardStore';
import { useAuthStore } from '../../../store/useAuthStore';
import { toast } from '../../../store/useToastStore';
import { useUndoStore } from '../../../store/useUndoStore';
import { useDocumentTitle } from '../../../hooks/useDocumentTitle';
import s from './v2.module.css';

const STATUS_LABEL = {
  draft: 'Черновик',
  approved: 'Утверждена',
  locked: 'Заблокирована',
};

const STATUS_CLASS = {
  draft: s.badgeDraft,
  approved: s.badgeApproved,
  locked: s.badgeLocked,
};

export default function TechCardBuilder() {
  const { orderId } = useParams();
  const [orderNumber, setOrderNumber] = useState(null);
  useDocumentTitle(orderNumber ? `Tech Card · ${orderNumber}` : 'Tech Card');
  const role = useAuthStore((st) => st.effectiveRole());
  const canEdit = ['admin', 'director', 'production'].includes(role);

  const sections = useTechCardStore((st) => st.sections);
  const operationTypes = useTechCardStore((st) => st.operationTypes);
  const catalogLoaded = useTechCardStore((st) => st.catalogLoaded);
  const techCard = useTechCardStore((st) => st.techCard);
  const operations = useTechCardStore((st) => st.operations);
  const loading = useTechCardStore((st) => st.loading);

  const loadCatalog = useTechCardStore((st) => st.loadCatalog);
  const loadTechCardForOrder = useTechCardStore((st) => st.loadTechCardForOrder);
  const createDraftTechCard = useTechCardStore((st) => st.createDraftTechCard);
  const addOperation = useTechCardStore((st) => st.addOperation);
  const updateOperationQty = useTechCardStore((st) => st.updateOperationQty);
  const removeOperation = useTechCardStore((st) => st.removeOperation);
  const restoreOperation = useTechCardStore((st) => st.restoreOperation);
  const approveTechCard = useTechCardStore((st) => st.approveTechCard);
  const pushUndo = useUndoStore((st) => st.push);

  const [selectedSectionId, setSelectedSectionId] = useState('');
  const [selectedOpId, setSelectedOpId] = useState('');
  const [newQty, setNewQty] = useState('1');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    loadCatalog();
  }, [loadCatalog]);

  useEffect(() => {
    if (orderId) loadTechCardForOrder(orderId);
  }, [orderId, loadTechCardForOrder]);

  useEffect(() => {
    let alive = true;
    if (!orderId) return undefined;
    (async () => {
      const { data } = await supabase
        .from('orders')
        .select('order_number')
        .eq('id', orderId)
        .maybeSingle();
      if (alive && data?.order_number) setOrderNumber(data.order_number);
    })();
    return () => { alive = false; };
  }, [orderId]);

  const opsInSection = useMemo(
    () => operationTypes.filter((o) => o.section_id === selectedSectionId),
    [operationTypes, selectedSectionId]
  );

  const totals = useMemo(() => {
    let sum = 0;
    let minutes = 0;
    for (const op of operations) {
      sum += op.rate_snapshot * op.qty;
      minutes += op.minutes_snapshot * op.qty;
    }
    return { sum, minutes };
  }, [operations]);

  if (!orderId) {
    return (
      <div className={s.page}>
        <p>Не указан заказ. Перейдите со страницы <Link to="/tech-cards">списка</Link>.</p>
      </div>
    );
  }

  if (loading && !catalogLoaded) {
    return (
      <div className={s.page}>
        <h1>Tech Card</h1>
        <div className={s.skeletonRow}>
          <div className="skeleton" style={{ height: 200, borderRadius: 12 }} />
        </div>
      </div>
    );
  }

  const handleCreateDraft = async () => {
    setSubmitting(true);
    const card = await createDraftTechCard(orderId);
    setSubmitting(false);
    if (card) toast.success?.('Карта создана') ?? null;
  };

  const handleAdd = async () => {
    if (!selectedOpId) return;
    const qty = Number(newQty);
    if (!Number.isFinite(qty) || qty <= 0) {
      toast.error('Введите корректное количество');
      return;
    }
    setSubmitting(true);
    await addOperation(selectedOpId, qty);
    setSubmitting(false);
    setSelectedOpId('');
    setNewQty('1');
  };

  const handleApprove = async () => {
    if (!operations.length) {
      toast.error('Нельзя утвердить пустую карту');
      return;
    }
    setSubmitting(true);
    const ok = await approveTechCard();
    setSubmitting(false);
    if (ok) toast.success?.('Карта утверждена') ?? null;
  };

  const editable = canEdit && techCard?.status === 'draft';

  return (
    <div className={s.page}>
      <div className={s.header}>
        <h1>{orderNumber ? `Tech Card · ${orderNumber}` : 'Tech Card'}</h1>
        <Link to="/tech-cards" className="btn btn-ghost">← К списку</Link>
      </div>
      <p className={s.subtitle}>
        {orderNumber && <>Заказ <strong>{orderNumber}</strong> · </>}
        <span className={s.code}>{orderId.slice(0, 8)}…</span>
        {techCard && (
          <> · <span className={`${s.badge} ${STATUS_CLASS[techCard.status]}`}>
            {STATUS_LABEL[techCard.status]}
          </span></>
        )}
      </p>

      {!techCard && (
        <div className={s.emptyState}>
          <span className={s.emptyStateIcon}>📝</span>
          <div className={s.emptyStateTitle}>Tech card ещё не создана</div>
          <p style={{ marginBottom: 16 }}>Создайте черновик и добавьте операции по списку каталога.</p>
          {canEdit && (
            <button className="btn btn-primary" onClick={handleCreateDraft} disabled={submitting}>
              Создать черновик
            </button>
          )}
        </div>
      )}

      {techCard && (
        <>
          <section className={s.section}>
            <h2>Операции ({operations.length})</h2>
            {operations.length === 0 ? (
              <div className={s.emptyState}>
                <span className={s.emptyStateIcon}>✚</span>
                <div className={s.emptyStateTitle}>Карта пуста</div>
                <p>Добавьте операции из формы ниже.</p>
              </div>
            ) : (
              <table className={s.table}>
                <thead>
                  <tr>
                    <th>Операция</th>
                    <th>Участок</th>
                    <th className={s.numCol}>Тариф</th>
                    <th className={s.numCol}>Кол-во</th>
                    <th className={s.numCol}>Сумма</th>
                    <th className={s.numCol}>Мин</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {operations.map((op) => {
                    const section = sections.find((sec) => sec.id === op.section_id);
                    return (
                      <tr key={op.id}>
                        <td>{op.name_snapshot}</td>
                        <td style={{ color: section?.color ?? undefined }}>{section?.name ?? '—'}</td>
                        <td className={s.numCol}>{op.rate_snapshot}₽/{op.unit_snapshot}</td>
                        <td className={s.numCol}>
                          {editable ? (
                            <input
                              type="number"
                              min="1"
                              step="1"
                              value={op.qty}
                              onChange={(e) => updateOperationQty(op.id, Number(e.target.value))}
                              className={s.qtyInput}
                            />
                          ) : (
                            op.qty
                          )}
                        </td>
                        <td className={s.numCol}>{(op.rate_snapshot * op.qty).toFixed(2)}₽</td>
                        <td className={s.numCol}>{op.minutes_snapshot * op.qty}</td>
                        <td className={s.numCol}>
                          {editable && (
                            <button
                              type="button"
                              className={s.removeBtn}
                              onClick={async () => {
                                const removed = await removeOperation(op.id);
                                if (removed) {
                                  pushUndo({
                                    label: `Операция «${removed.name_snapshot}» удалена`,
                                    restore: () => restoreOperation(removed),
                                  });
                                }
                              }}
                              aria-label="Удалить"
                            >
                              ×
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  <tr className={s.totalsRow}>
                    <td colSpan={4} className={s.numCol}>Итого:</td>
                    <td className={s.numCol}>{totals.sum.toFixed(2)}₽</td>
                    <td className={s.numCol}>{totals.minutes}</td>
                    <td></td>
                  </tr>
                </tbody>
              </table>
            )}
          </section>

          {editable && (
            <section className={s.section}>
              <h3>Добавить операцию</h3>
              <div className={s.formRow}>
                <select
                  value={selectedSectionId}
                  onChange={(e) => { setSelectedSectionId(e.target.value); setSelectedOpId(''); }}
                >
                  <option value="">— Участок —</option>
                  {sections.map((sec) => (
                    <option key={sec.id} value={sec.id}>{sec.name}</option>
                  ))}
                </select>
                <select
                  value={selectedOpId}
                  onChange={(e) => setSelectedOpId(e.target.value)}
                  disabled={!selectedSectionId}
                >
                  <option value="">— Операция —</option>
                  {opsInSection.map((op) => (
                    <option key={op.id} value={op.id}>
                      {op.name} ({op.base_rate}₽/{op.unit})
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={newQty}
                  onChange={(e) => setNewQty(e.target.value)}
                  aria-label="Количество"
                />
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleAdd}
                  disabled={!selectedOpId || submitting}
                >
                  Добавить
                </button>
              </div>
            </section>
          )}

          {editable && (
            <section className={s.section}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleApprove}
                disabled={!operations.length || submitting}
                title="Замораживает rate/minutes snapshot навсегда"
              >
                Утвердить карту
              </button>
              <p className={s.subtitle} style={{ fontSize: 12, marginTop: 8 }}>
                После утверждения тарифы и нормы минут замораживаются. Изменения в каталоге
                операций на эту карту больше не повлияют.
              </p>
            </section>
          )}
        </>
      )}
    </div>
  );
}
