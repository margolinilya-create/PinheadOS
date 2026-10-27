import { useId, useMemo, useState } from 'react';
import { useAuthStore } from '../../../../store/useAuthStore';
import { confirm } from '../../../../store/useConfirmStore';
import { toast } from '../../../../store/useToastStore';
import { pluralize } from '../../../../utils/i18n';
import {
  LAYOUT_NAME_MAX, deleteLayoutTemplate, listLayoutTemplates, saveLayoutTemplate,
} from '../../../api/layoutTemplates';
import { useDesignStore } from '../../store/useDesignStore';
import { MSG_ADD_BLOCKED_MISMATCH } from '../useArtworkActions';
import { applyTemplate, templateFromPrints } from './templateOps';
import styles from '../DesignTab.module.css';

export const MSG_PICK_PRINT = 'Выберите размещённое нанесение на холсте — его логотип и разложим';
export const MSG_NOTHING_TO_SAVE = 'На холсте нет нанесений — сохранять нечего';
export const MSG_NO_PLACE = 'Ни одно место раскладки не подходит к этому силуэту';

const printsText = (n) => `${n} ${pluralize(n, 'нанесение', 'нанесения', 'нанесений')}`;

/**
 * «Мои раскладки» (веха 5в, Э8): сохранить раскладку позиции под своим именем
 * и разложить по ней выбранный логотип — в этом или другом заказе, на этом или
 * другом силуэте (по зонам). Список грузится при первом раскрытии; открытие
 * вкладки ничего не пишет. Только черновик и «Дизайн» 2.0 (решает `DesignSide`);
 * силуэт другой модели — «Разложить» недоступно с причиной (правило Э1).
 */
export default function MyLayouts({ d, item, selected }) {
  const uid = useAuthStore((s) => s.user?.id ?? null);
  const [rows, setRows] = useState(null);
  const [pick, setPick] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const pickId = useId();
  const nameId = useId();
  const applyReasonId = useId();
  const saveReasonId = useId();

  const snapshot = useMemo(() => templateFromPrints(item.prints, d.ctx), [item.prints, d.ctx]);
  const chosen = rows?.find((r) => r.id === pick) ?? rows?.[0] ?? null;
  const applyBlock = d.addBlocked ? MSG_ADD_BLOCKED_MISMATCH : !selected ? MSG_PICK_PRINT : null;
  const saveBlock = snapshot ? null : MSG_NOTHING_TO_SAVE;

  const load = async () => {
    if (!uid || busy) return null;
    setBusy(true);
    const list = await listLayoutTemplates(uid);
    setBusy(false);
    if (list) setRows(list);
    return list;
  };

  const apply = () => {
    if (applyBlock || !chosen) return;
    let res = null;
    d.commitPrints('Раскладка', (prints) => {
      res = applyTemplate(prints, selected.print.key, chosen.data, d.ctx);
      return res?.prints ?? null;
    });
    if (!res) {
      toast.error(MSG_NO_PLACE);
      return;
    }
    useDesignStore.getState().select(res.key);
    const skips = [
      res.skipped.zone ? `${res.skipped.zone} — на этом силуэте нет такой зоны` : '',
      res.skipped.method ? `${res.skipped.method} — техника в зоне не разрешена` : '',
    ].filter(Boolean);
    toast.success(`«${chosen.name}»: разложено мест — ${res.placed}${skips.length ? `; пропущено: ${skips.join(', ')}` : ''}`);
  };

  const save = async (e) => {
    e.preventDefault();
    if (saveBlock || busy || !uid) return;
    setBusy(true);
    const row = await saveLayoutTemplate(uid, name, snapshot);
    setBusy(false);
    if (!row) return;
    setName('');
    setRows((list) => [row, ...(list ?? []).filter((r) => r.id !== row.id)]);
    setPick(row.id);
    toast.success(`Раскладка «${row.name}» сохранена`);
  };

  const remove = async () => {
    if (!chosen || busy) return;
    const ok = await confirm({
      title: `Удалить раскладку «${chosen.name}»?`,
      message: 'Нанесения в заказах не изменятся',
      confirmLabel: 'Удалить',
    });
    if (!ok) return;
    setBusy(true);
    const done = await deleteLayoutTemplate(chosen.id);
    setBusy(false);
    if (done) setRows((list) => (list ?? []).filter((r) => r.id !== chosen.id));
  };

  return (
    <details className={styles.details} onToggle={(e) => { if (e.currentTarget.open && rows === null) load(); }}>
      <summary>Мои раскладки</summary>
      <div className={styles.section}>
        {rows === null && <p className={styles.muted} role="status">{busy ? 'Загружаю раскладки…' : ''}</p>}
        {rows?.length === 0 && <p className={styles.muted}>Сохраните раскладку позиции — и раскладывайте по ней логотип в других заказах.</p>}
        {chosen && (
          <>
            <label className={styles.field} htmlFor={pickId}>Раскладка
              <select id={pickId} className={styles.select} value={chosen.id} onChange={(e) => setPick(e.target.value)}>
                {rows.map((r) => <option key={r.id} value={r.id}>{r.name} · {printsText(r.data.prints.length)}</option>)}
              </select>
            </label>
            <div className={styles.row}>
              <button
                type="button"
                className={styles.btn}
                aria-disabled={applyBlock ? 'true' : undefined}
                aria-describedby={applyBlock ? applyReasonId : undefined}
                onClick={apply}
              >
                Разложить по раскладке
              </button>
              <button type="button" className={styles.btn} disabled={busy} onClick={remove}>Удалить раскладку</button>
            </div>
            {applyBlock && <p id={applyReasonId} className={styles.muted}>{applyBlock}</p>}
          </>
        )}
        <form className={styles.section} onSubmit={save}>
          <label className={styles.field} htmlFor={nameId}>Название новой раскладки
            <input
              id={nameId}
              className={styles.input}
              value={name}
              maxLength={LAYOUT_NAME_MAX}
              placeholder="Например: грудь и спина"
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <button
            type="submit"
            className={styles.btn}
            disabled={busy}
            aria-disabled={saveBlock ? 'true' : undefined}
            aria-describedby={saveBlock ? saveReasonId : undefined}
          >
            Сохранить раскладку позиции{snapshot ? ` (${printsText(snapshot.prints.length)})` : ''}
          </button>
          {saveBlock && <p id={saveReasonId} className={styles.muted}>{saveBlock}</p>}
        </form>
      </div>
    </details>
  );
}
