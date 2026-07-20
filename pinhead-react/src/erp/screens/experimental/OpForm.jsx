import { useState } from 'react';
import { EXPERIMENTAL_OP_KIND_LABELS } from '../../types';
import styles from '../../erp.module.css';

/** Форма передачи из «Проработки» (в швейку или на нанесение) */
export function OpForm({ onCreate }) {
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
