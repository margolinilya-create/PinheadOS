// redesign/v2 — Tech Card Builder (W3 Day-2)
//
// Full CRUD for a single order's tech card:
//   - Load existing card or offer to create a draft
//   - Add operations from the operation_types catalog
//   - Edit qty inline / remove
//   - Approve (freezes snapshots via useTechCardStore.approveTechCard)
//
// Expects `:orderId` URL param. Admin + technologist can write; foreman
// read-only (enforced in RLS + buttons disabled).

import { useEffect, useState, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useTechCardStore } from '../../../store/useTechCardStore';
import { useAuthStore } from '../../../store/useAuthStore';
import { toast } from '../../../store/useToastStore';

const STATUS_LABEL = {
  draft: 'Черновик',
  approved: 'Утверждена',
  locked: 'Заблокирована',
};

export default function TechCardBuilder() {
  const { orderId } = useParams();
  const role = useAuthStore((s) => s.effectiveRole());
  const canEdit = ['admin', 'director', 'production'].includes(role);

  const sections = useTechCardStore((s) => s.sections);
  const operationTypes = useTechCardStore((s) => s.operationTypes);
  const catalogLoaded = useTechCardStore((s) => s.catalogLoaded);
  const techCard = useTechCardStore((s) => s.techCard);
  const operations = useTechCardStore((s) => s.operations);
  const loading = useTechCardStore((s) => s.loading);

  const loadCatalog = useTechCardStore((s) => s.loadCatalog);
  const loadTechCardForOrder = useTechCardStore((s) => s.loadTechCardForOrder);
  const createDraftTechCard = useTechCardStore((s) => s.createDraftTechCard);
  const addOperation = useTechCardStore((s) => s.addOperation);
  const updateOperationQty = useTechCardStore((s) => s.updateOperationQty);
  const removeOperation = useTechCardStore((s) => s.removeOperation);
  const approveTechCard = useTechCardStore((s) => s.approveTechCard);

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
      <div className="container">
        <p>
          Не указан заказ. Перейдите со страницы <Link to="/tech-cards">списка</Link>.
        </p>
      </div>
    );
  }

  if (loading && !catalogLoaded) {
    return <div className="panel-loading">Загрузка каталога…</div>;
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
    <div className="container" style={{ maxWidth: 900 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>Tech Card</h1>
        <Link to="/tech-cards" className="btn btn-ghost">← К списку</Link>
      </div>
      <p style={{ opacity: 0.7 }}>
        Заказ: <code>{orderId}</code>
        {techCard && (
          <> · Статус: <strong>{STATUS_LABEL[techCard.status]}</strong></>
        )}
      </p>

      {!techCard && (
        <div className="panel">
          <p>Для этого заказа tech card ещё не создана.</p>
          {canEdit && (
            <button className="btn btn-primary" onClick={handleCreateDraft} disabled={submitting}>
              Создать черновик
            </button>
          )}
        </div>
      )}

      {techCard && (
        <>
          <section style={{ marginTop: 'var(--space-4)' }}>
            <h2>Операции ({operations.length})</h2>
            {operations.length === 0 ? (
              <p style={{ opacity: 0.6 }}>Пока нет операций.</p>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--color-border)' }}>
                    <th>Операция</th>
                    <th>Участок</th>
                    <th style={{ textAlign: 'right' }}>Тариф</th>
                    <th style={{ textAlign: 'right' }}>Кол-во</th>
                    <th style={{ textAlign: 'right' }}>Сумма</th>
                    <th style={{ textAlign: 'right' }}>Мин</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {operations.map((op) => {
                    const section = sections.find((s) => s.id === op.section_id);
                    return (
                      <tr key={op.id} style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
                        <td>{op.name_snapshot}</td>
                        <td style={{ color: section?.color ?? undefined }}>{section?.name ?? '—'}</td>
                        <td style={{ textAlign: 'right' }}>
                          {op.rate_snapshot}₽/{op.unit_snapshot}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          {editable ? (
                            <input
                              type="number"
                              min="1"
                              step="1"
                              value={op.qty}
                              onChange={(e) => updateOperationQty(op.id, Number(e.target.value))}
                              style={{ width: 70, textAlign: 'right' }}
                            />
                          ) : (
                            op.qty
                          )}
                        </td>
                        <td style={{ textAlign: 'right' }}>{(op.rate_snapshot * op.qty).toFixed(2)}₽</td>
                        <td style={{ textAlign: 'right' }}>{op.minutes_snapshot * op.qty}</td>
                        <td style={{ textAlign: 'right' }}>
                          {editable && (
                            <button
                              className="btn btn-ghost btn-danger"
                              onClick={() => removeOperation(op.id)}
                              aria-label="Удалить"
                            >
                              ×
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  <tr style={{ fontWeight: 600 }}>
                    <td colSpan={4} style={{ textAlign: 'right' }}>Итого:</td>
                    <td style={{ textAlign: 'right' }}>{totals.sum.toFixed(2)}₽</td>
                    <td style={{ textAlign: 'right' }}>{totals.minutes}</td>
                    <td></td>
                  </tr>
                </tbody>
              </table>
            )}
          </section>

          {editable && (
            <section style={{ marginTop: 'var(--space-4)' }}>
              <h3>Добавить операцию</h3>
              <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap' }}>
                <select
                  value={selectedSectionId}
                  onChange={(e) => { setSelectedSectionId(e.target.value); setSelectedOpId(''); }}
                >
                  <option value="">— Участок —</option>
                  {sections.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
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
                  style={{ width: 80 }}
                  aria-label="Количество"
                />
                <button
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
            <section style={{ marginTop: 'var(--space-4)' }}>
              <button
                className="btn btn-primary"
                onClick={handleApprove}
                disabled={!operations.length || submitting}
                title="Замораживает rate/minutes snapshot навсегда"
              >
                Утвердить карту
              </button>
              <p style={{ opacity: 0.6, fontSize: '0.9em', marginTop: 4 }}>
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
