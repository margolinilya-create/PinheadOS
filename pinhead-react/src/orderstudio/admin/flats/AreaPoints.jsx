import { useState } from 'react';
import { insertPoint, movePoint, removePoint } from '../../design/edit/flatEdit';
import { DesignIcon } from '../../design/ui/DesignIcon';
import { MAX_POLYGON_POINTS } from '../../design/limits';
import { MmField } from './flatFields';
import { areaFieldId } from './flatEditorView';
import styles from './FlatEditor.module.css';

const pointFieldId = (kind, areaId, i, axis) => `${areaFieldId(kind, areaId, 'polygon_mm')}-${i}-${axis}`;
const addPointId = (kind, areaId) => `${areaFieldId(kind, areaId, 'polygon_mm')}-add`;

/**
 * Точки многоугольника зоны (К12): X и Y каждой точки, «Добавить точку после
 * выбранной» и «Удалить точку N» (не меньше 3, не больше 256). После удаления
 * фокус — на соседнюю точку, если её нет — на «Добавить точку после выбранной».
 */
export default function AreaPoints({ ctx, kind, area, errors }) {
  const [selected, setSelected] = useState(0);
  const pts = area.polygon_mm;
  const at = Math.min(selected, pts.length - 1);

  const move = (i, axis, v) => {
    const p = [...pts[i]];
    p[axis === 'x' ? 0 : 1] = v;
    ctx.edit((f) => movePoint(f, kind, area.id, i, p));
  };

  const remove = (i) => {
    ctx.edit((f) => removePoint(f, kind, area.id, i));
    const next = Math.min(i, pts.length - 2);
    setSelected(next);
    ctx.focusSoon(pointFieldId(kind, area.id, next, 'x'), addPointId(kind, area.id));
  };

  const add = () => {
    ctx.edit((f) => insertPoint(f, kind, area.id, at));
    setSelected(at + 1);
    ctx.focusSoon(pointFieldId(kind, area.id, at + 1, 'x'));
  };

  return (
    <div className={styles.points} id={areaFieldId(kind, area.id, 'polygon_mm')} tabIndex={-1} role="group" aria-label={`Точки зоны «${area.name}»`}>
      <ol className={styles.pointList}>
        {pts.map(([x, y], i) => (
          // Точки без своих id — порядок и есть ключ (вставка сдвигает поля вместе с данными)
          <li key={i} className={styles.pointRow} data-selected={i === at || undefined}>
            <button type="button" className={styles.pick} aria-pressed={i === at} onClick={() => setSelected(i)}>
              {`Точка ${i + 1}`}
            </button>
            <MmField id={pointFieldId(kind, area.id, i, 'x')} label="X, мм" value={x} onCommit={(v) => move(i, 'x', v)} errors={i === 0 ? errors : undefined} />
            <MmField id={pointFieldId(kind, area.id, i, 'y')} label="Y, мм" value={y} onCommit={(v) => move(i, 'y', v)} />
            <button
              type="button"
              className={styles.iconBtn}
              aria-label={`Удалить точку ${i + 1}`}
              onClick={() => remove(i)}
              disabled={pts.length <= 3}
            >
              <DesignIcon name="trash" />
            </button>
          </li>
        ))}
      </ol>
      <button type="button" id={addPointId(kind, area.id)} className="btn" onClick={add} disabled={pts.length >= MAX_POLYGON_POINTS}>
        Добавить точку после выбранной
      </button>
    </div>
  );
}
