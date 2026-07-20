import { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { PageHead } from '../components/PageHead';
import { SearchInput } from '../components/SearchInput';
import { useErpStore } from '../store/useErpStore';
import { toast } from '../../store/useToastStore';
import { formatDateShort } from '../utils/time';
import { matchesOrderQuery } from '../utils/orderSearch';
import {
  EXPERIMENTAL_PHASE_LABELS,
  EXPERIMENTAL_OUTCOME_LABELS,
  EXPERIMENTAL_OP_KIND_LABELS,
  EXPERIMENTAL_OP_STATUS_LABELS,
} from '../types';
import styles from '../erp.module.css';

/**
 * Экспериментальный цех (правка 6): отдельная воронка разработки.
 * Фазы: Построение лекал (конструктор) → Проработка (технолог) → Финальная примерка → Готов к серии.
 * Из «Проработки» — передачи в швейку/на нанесения с обязательным авто-возвратом.
 */

const PHASE_CHIP = {
  patterns: 'chipNeutral',
  development: 'chipProgress',
  final_fitting: 'chipProgress',
  returned_to_constructor: 'chipBlocked',
  done: 'chipReady',
};

/** Форма передачи из «Проработки» (в швейку или на нанесение) */
function OpForm({ onCreate }) {
  const [kind, setKind] = useState('to_sewing');
  const [form, setForm] = useState({ operation: '', qty: '', responsible: '', planned_date: '', comment: '',
    branding_method: '', mockup: '', zone: '', size_mm: '', colors: '' });
  const set = (patch) => setForm({ ...form, ...patch });

  const submit = async () => {
    const base = {
      kind,
      qty: form.qty ? Number(form.qty) : null,
      responsible: form.responsible.trim() || null,
      planned_date: form.planned_date || null,
      comment: form.comment.trim() || null,
    };
    const payload = kind === 'to_sewing'
      ? { ...base, operation: form.operation.trim() || null }
      : { ...base,
          branding_method: form.branding_method.trim() || null, mockup: form.mockup.trim() || null,
          zone: form.zone.trim() || null, size_mm: form.size_mm.trim() || null, colors: form.colors.trim() || null };
    const row = await onCreate(payload);
    if (row) setForm({ operation: '', qty: '', responsible: '', planned_date: '', comment: '',
      branding_method: '', mockup: '', zone: '', size_mm: '', colors: '' });
  };

  return (
    <div className={styles.addMatRow}>
      <select className={styles.select} value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Тип передачи">
        {Object.entries(EXPERIMENTAL_OP_KIND_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      {kind === 'to_sewing' ? (
        <input className={styles.input} placeholder="Операция" value={form.operation} onChange={(e) => set({ operation: e.target.value })} aria-label="Операция" />
      ) : (
        <>
          <input className={styles.input} placeholder="Вид нанесения" value={form.branding_method} onChange={(e) => set({ branding_method: e.target.value })} aria-label="Вид нанесения" style={{ maxWidth: 130 }} />
          <input className={styles.input} placeholder="Макет" value={form.mockup} onChange={(e) => set({ mockup: e.target.value })} aria-label="Макет" style={{ maxWidth: 120 }} />
          <input className={styles.input} placeholder="Место" value={form.zone} onChange={(e) => set({ zone: e.target.value })} aria-label="Место" style={{ maxWidth: 100 }} />
          <input className={styles.input} placeholder="Размер" value={form.size_mm} onChange={(e) => set({ size_mm: e.target.value })} aria-label="Размер" style={{ maxWidth: 90 }} />
          <input className={styles.input} placeholder="Цветность" value={form.colors} onChange={(e) => set({ colors: e.target.value })} aria-label="Цветность" style={{ maxWidth: 90 }} />
        </>
      )}
      <input type="number" min="1" className={styles.input} placeholder="шт" value={form.qty} onChange={(e) => set({ qty: e.target.value })} aria-label="Количество" style={{ maxWidth: 80 }} />
      <input className={styles.input} placeholder="Ответственный" value={form.responsible} onChange={(e) => set({ responsible: e.target.value })} aria-label="Ответственный" style={{ maxWidth: 130 }} />
      <label className={styles.subText}>план<input type="date" className={styles.input} value={form.planned_date} onChange={(e) => set({ planned_date: e.target.value })} aria-label="Плановый срок" /></label>
      <button type="button" className="btn btn-secondary" onClick={submit}>Передать</button>
    </div>
  );
}

function ExperimentalCard({ exp, onUpdate, onCreateOp, onCompleteOp }) {
  const [ret, setRet] = useState('');
  const ops = exp.ops ?? [];
  const canAdvancePatterns = Boolean(exp.tech_name && exp.measurement_table);
  const openOps = ops.filter((o) => o.status !== 'returned' && o.status !== 'cancelled');

  const setOutcome = (outcome) => {
    if (outcome === 'needs_pattern_change') {
      onUpdate(exp.id, { final_outcome: outcome }); // фаза сменится по кнопке ниже с комментарием
      return;
    }
    const phase = outcome === 'ready_for_serial' || outcome === 'approved' ? 'done' : 'development';
    onUpdate(exp.id, { final_outcome: outcome, phase });
  };

  return (
    <section className={styles.matSection}>
      <div className={styles.matSectionHead}>
        <div>
          <strong>№{exp.order?.bitrix_id || '—'} · {exp.order?.title || 'Заказ'}</strong>
        </div>
        <span className={`${styles.chip} ${styles[PHASE_CHIP[exp.phase]]}`}>{EXPERIMENTAL_PHASE_LABELS[exp.phase]}</span>
      </div>

      {exp.phase === 'patterns' && (
        <div className={styles.tzBlock}>
          <div className={styles.checkRow}>
            <input className={styles.input} placeholder="Тех. название лекал (для Bitrix)" defaultValue={exp.tech_name || ''}
              onBlur={(e) => { const v = e.target.value.trim() || null; if (v !== (exp.tech_name || null)) onUpdate(exp.id, { tech_name: v }); }}
              aria-label="Тех. название лекал" />
            <input className={styles.input} placeholder="Табель мер" defaultValue={exp.measurement_table || ''}
              onBlur={(e) => { const v = e.target.value.trim() || null; if (v !== (exp.measurement_table || null)) onUpdate(exp.id, { measurement_table: v }); }}
              aria-label="Табель мер" />
            <input className={styles.input} placeholder="Конструктор" defaultValue={exp.constructor || ''}
              onBlur={(e) => { const v = e.target.value.trim() || null; if (v !== (exp.constructor || null)) onUpdate(exp.id, { constructor: v }); }}
              aria-label="Конструктор" style={{ maxWidth: 140 }} />
            <label className={styles.checkLabel}>
              <input type="checkbox" checked={exp.has_3d} onChange={(e) => onUpdate(exp.id, { has_3d: e.target.checked })} />
              3D-модель
            </label>
          </div>
          <button type="button" className="btn btn-primary" disabled={!canAdvancePatterns}
            onClick={() => onUpdate(exp.id, { phase: 'development' })}
            title={canAdvancePatterns ? '' : 'Заполните тех. название лекал и табель мер'}>
            → Проработка
          </button>
          {!canAdvancePatterns && <span className={styles.subText}> Нужны тех. название лекал и табель мер</span>}
        </div>
      )}

      {exp.phase === 'development' && (
        <div className={styles.tzBlock}>
          <div className={styles.checkRow}>
            <input className={styles.input} placeholder="Технолог" defaultValue={exp.technologist || ''}
              onBlur={(e) => { const v = e.target.value.trim() || null; if (v !== (exp.technologist || null)) onUpdate(exp.id, { technologist: v }); }}
              aria-label="Технолог" style={{ maxWidth: 140 }} />
          </div>
          <div className={styles.fieldLabel}>Передачи (авто-возврат на «Проработку»)</div>
          <OpForm onCreate={(op) => onCreateOp(exp.id, op)} />
          {ops.length > 0 && (
            <ul className={styles.tzMatList}>
              {ops.map((o) => (
                <li key={o.id}>
                  {EXPERIMENTAL_OP_KIND_LABELS[o.kind]}: {o.kind === 'to_sewing' ? (o.operation || 'операция') : (o.branding_method || 'нанесение')}
                  {o.qty ? ` · ${o.qty} шт` : ''}
                  <span className={styles.subText}>
                    {o.responsible ? ` · ${o.responsible}` : ''}
                    {o.planned_date ? ` · план ${formatDateShort(o.planned_date)}` : ''}
                    {' · '}{EXPERIMENTAL_OP_STATUS_LABELS[o.status]}
                  </span>
                  {o.status !== 'returned' && o.status !== 'cancelled' && (
                    <button type="button" className="btn btn-ghost" onClick={() => onCompleteOp(o.id)}>Вернулось</button>
                  )}
                </li>
              ))}
            </ul>
          )}
          <button type="button" className="btn btn-primary" disabled={openOps.length > 0}
            onClick={() => onUpdate(exp.id, { phase: 'final_fitting' })}
            title={openOps.length > 0 ? 'Дождитесь возврата всех передач' : ''}>
            → Финальная примерка
          </button>
          {openOps.length > 0 && <span className={styles.subText}> Есть незавершённые передачи</span>}
        </div>
      )}

      {exp.phase === 'final_fitting' && (
        <div className={styles.tzBlock}>
          <div className={styles.fieldLabel}>Итог примерки</div>
          <div className={styles.checkRow}>
            {Object.entries(EXPERIMENTAL_OUTCOME_LABELS).map(([v, l]) => (
              <button key={v} type="button"
                className={`${styles.chip} ${exp.final_outcome === v ? styles.chipProgress : styles.chipNeutral}`}
                style={{ cursor: 'pointer', font: 'inherit' }}
                onClick={() => setOutcome(v)}>
                {l}
              </button>
            ))}
          </div>
          {exp.final_outcome === 'needs_pattern_change' && (
            <div className={styles.checkRow}>
              <input className={styles.input} placeholder="Комментарий конструктору (что изменить)" value={ret} onChange={(e) => setRet(e.target.value)} aria-label="Комментарий конструктору" />
              <button type="button" className="btn btn-danger" disabled={!ret.trim()}
                onClick={() => { onUpdate(exp.id, { phase: 'returned_to_constructor', constructor_return_comment: ret.trim() }); setRet(''); }}>
                Вернуть конструктору
              </button>
            </div>
          )}
        </div>
      )}

      {exp.phase === 'returned_to_constructor' && (
        <div className={styles.tzBlock}>
          <div className={styles.queueReason}>↩ Конструктору: {exp.constructor_return_comment || '—'}</div>
          <button type="button" className="btn btn-secondary" onClick={() => onUpdate(exp.id, { phase: 'patterns' })}>
            → К лекалам (доработка)
          </button>
        </div>
      )}

      {exp.phase === 'done' && (
        <div className={styles.subText}>
          ✅ Готов к серии. Тех. название лекал: <strong>{exp.tech_name || '—'}</strong>
          {exp.final_outcome ? ` · ${EXPERIMENTAL_OUTCOME_LABELS[exp.final_outcome]}` : ''}
        </div>
      )}
    </section>
  );
}

export default function Experimental() {
  const {
    orders, loaded, loadAll,
    experimental, experimentalLoaded, loadExperimental,
    createExperimental, updateExperimental, createExperimentalOp, completeExperimentalOp,
  } = useErpStore(
    useShallow((s) => ({
      orders: s.orders,
      loaded: s.loaded,
      loadAll: s.loadAll,
      experimental: s.experimental,
      experimentalLoaded: s.experimentalLoaded,
      loadExperimental: s.loadExperimental,
      createExperimental: s.createExperimental,
      updateExperimental: s.updateExperimental,
      createExperimentalOp: s.createExperimentalOp,
      completeExperimentalOp: s.completeExperimentalOp,
    })),
  );
  const [query, setQuery] = useState('');
  const [newOrderId, setNewOrderId] = useState('');

  useEffect(() => { if (!loaded) loadAll(); }, [loaded, loadAll]);
  useEffect(() => { if (!experimentalLoaded) loadExperimental(); }, [experimentalLoaded, loadExperimental]);

  // Заказы-образцы без разработки — для создания
  const availableOrders = useMemo(() => {
    const withExp = new Set(experimental.map((e) => e.order_id));
    return orders.filter((o) => o.status === 'active' && !withExp.has(o.id));
  }, [orders, experimental]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return experimental;
    return experimental.filter((e) => {
      const o = orders.find((x) => x.id === e.order_id) || {
        title: e.order?.title, bitrix_id: e.order?.bitrix_id,
      };
      return matchesOrderQuery(o, q);
    });
  }, [experimental, orders, query]);

  const addExperimental = async () => {
    if (!newOrderId) { toast.error('Выберите заказ'); return; }
    const row = await createExperimental(newOrderId);
    if (row) setNewOrderId('');
  };

  return (
    <>
      <PageHead
        title="Экспериментальный цех"
        sub="Разработка образцов: лекала → проработка → примерка. Возвраты и передачи с авто-возвратом."
      />

      <div className={styles.toolbar}>
        <SearchInput value={query} onChange={setQuery} placeholder="Поиск: заказ, № сделки, изделие" ariaLabel="Поиск в эксперим. цехе" />
        <div className={styles.spacer} />
        <select className={styles.select} value={newOrderId} onChange={(e) => setNewOrderId(e.target.value)} aria-label="Заказ для разработки">
          <option value="">Заказ…</option>
          {availableOrders.map((o) => (
            <option key={o.id} value={o.id}>№{o.bitrix_id || '—'} · {o.title}</option>
          ))}
        </select>
        <button type="button" className="btn btn-primary" onClick={addExperimental}>+ Разработка</button>
      </div>

      {experimentalLoaded && experimental.length === 0 && (
        <div className={styles.emptyState}>Эксперим. разработок пока нет — добавьте заказ-образец выше.</div>
      )}

      {rows.map((exp) => (
        <ExperimentalCard
          key={exp.id}
          exp={exp}
          onUpdate={updateExperimental}
          onCreateOp={createExperimentalOp}
          onCompleteOp={completeExperimentalOp}
        />
      ))}
    </>
  );
}
