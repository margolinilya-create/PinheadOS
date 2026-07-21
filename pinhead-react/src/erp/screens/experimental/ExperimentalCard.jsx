import { useState } from 'react';
import { formatDateShort } from '../../utils/time';
import {
  EXPERIMENTAL_PHASE_LABELS,
  EXPERIMENTAL_OUTCOME_LABELS,
  EXPERIMENTAL_OP_KIND_LABELS,
  EXPERIMENTAL_OP_STATUS_LABELS,
} from '../../types';
import styles from '../../erp.module.css';
import { OpForm } from './OpForm';

const PHASE_CHIP = {
  patterns: 'chipNeutral',
  development: 'chipProgress',
  final_fitting: 'chipProgress',
  returned_to_constructor: 'chipBlocked',
  done: 'chipReady',
};

/** Куда сейчас передан образец (открытая передача) — для бейджа локации */
const OP_LOCATION = { to_sewing: 'в швейном цехе', to_branding: 'на нанесениях' };

export function ExperimentalCard({ exp, onUpdate, onCreateOp, onCompleteOp, materialReady = true }) {
  const [ret, setRet] = useState('');
  const ops = exp.ops ?? [];
  // Гейт «Проработки»: лекала (тех. название + табель мер) И материал принят складом (волна 4.3)
  const canAdvancePatterns = Boolean(exp.tech_name && exp.measurement_table) && materialReady;
  const openOps = ops.filter((o) => o.status !== 'returned' && o.status !== 'cancelled');
  const location = openOps.length > 0 ? (OP_LOCATION[openOps[0].kind] || 'на передаче') : null;

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
        <div className={styles.checkRow}>
          {location && <span className={`${styles.chip} ${styles.chipProgress}`}>сейчас: {location}</span>}
          <span className={`${styles.chip} ${styles[PHASE_CHIP[exp.phase]]}`}>{EXPERIMENTAL_PHASE_LABELS[exp.phase]}</span>
        </div>
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
            title={canAdvancePatterns ? '' : 'Нужны лекала (тех. название + табель мер) и приёмка материала складом'}>
            → Проработка
          </button>
          {!canAdvancePatterns && (
            <span className={styles.subText}>
              {' '}
              {!(exp.tech_name && exp.measurement_table)
                ? 'Нужны тех. название лекал и табель мер'
                : 'Ожидает приёмки материала складом'}
            </span>
          )}
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
