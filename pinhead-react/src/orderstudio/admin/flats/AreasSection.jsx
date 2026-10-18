import { addArea, moveArea, rectArea, removeArea } from '../../design/edit/flatEdit';
import { FlatIcon } from './FlatIcon';
import AreaFields from './AreaFields';
import { areaFieldId, areaRowId, GEOMETRY_HINT, NO_AREAS_TEXT } from './flatEditorView';
import styles from './FlatEditor.module.css';

const ADD_ID = 'flat-add-area';
const tenth = (v) => Math.round(v * 10) / 10;

/** id новой зоны вида: `zone-2`, `zone-3`… — первый свободный */
function newAreaId(view) {
  const ids = new Set(view.print_areas.map((a) => a.id));
  let n = view.print_areas.length + 1;
  while (ids.has(`zone-${n}`)) n += 1;
  return `zone-${n}`;
}

/**
 * Зоны выбранного вида: список (выбор, порядок, удаление) и поля выбранной.
 * Выбор в списке — фокус на её «Название»; после «Добавить зону» — на новую;
 * после удаления — на соседнюю строку, если её нет — на «Добавить зону».
 */
export default function AreasSection({ ctx, view }) {
  const { kind } = ctx;
  const areas = view.print_areas;
  const selected = areas.find((a) => a.id === ctx.areaId) ?? areas[0] ?? null;

  const pick = (id) => {
    ctx.selectArea(id);
    ctx.focusSoon(areaFieldId(kind, id, 'name'));
  };

  const add = () => {
    const mm = ctx.flatMm ?? { w: 400, h: 400 };
    const id = newAreaId(view);
    const r = { x: tenth(mm.w * 0.35), y: tenth(mm.h * 0.35), w: tenth(mm.w * 0.3), h: tenth(mm.h * 0.3) };
    ctx.edit((f) => addArea(f, kind, rectArea(id, 'Новая зона', null, r, tenth(Math.min(10, r.w / 4, r.h / 4)))));
    pick(id);
  };

  const remove = (i) => {
    const id = areas[i].id;
    ctx.edit((f) => removeArea(f, kind, id));
    const next = areas[i + 1] ?? areas[i - 1];
    if (next) ctx.selectArea(next.id);
    ctx.focusSoon(next ? areaRowId(kind, next.id) : null, ADD_ID);
  };

  return (
    <section className={styles.section} aria-labelledby="flat-areas-head">
      <h3 id="flat-areas-head" className={styles.sectionHead}>Зоны вида</h3>
      <p className={styles.geoHint}>{`Набор зон и их рамки: ${GEOMETRY_HINT.toLowerCase()}`}</p>
      {areas.length === 0 && <p className={styles.warnText}>{NO_AREAS_TEXT}</p>}
      <ul className={styles.areaList}>
        {areas.map((a, i) => (
          <li key={a.id} className={styles.areaRow}>
            <button
              type="button"
              id={areaRowId(kind, a.id)}
              className={styles.pick}
              aria-pressed={a.id === selected?.id}
              onClick={() => pick(a.id)}
            >
              {a.name}
              {a.zone_id === null && <span className={styles.tag}>служебная</span>}
            </button>
            <button type="button" className={styles.iconBtn} aria-label={`Поднять зону «${a.name}»`} disabled={i === 0} onClick={() => ctx.edit((f) => moveArea(f, kind, a.id, -1))}>
              <FlatIcon name="arrowUp" />
            </button>
            <button type="button" className={styles.iconBtn} aria-label={`Опустить зону «${a.name}»`} disabled={i === areas.length - 1} onClick={() => ctx.edit((f) => moveArea(f, kind, a.id, 1))}>
              <FlatIcon name="arrowDown" />
            </button>
            <button type="button" className={styles.iconBtn} aria-label={`Удалить зону «${a.name}»`} disabled={areas.length <= 1} onClick={() => remove(i)}>
              <FlatIcon name="trash" />
            </button>
          </li>
        ))}
      </ul>
      <button type="button" id={ADD_ID} className="btn" onClick={add} disabled={areas.length >= 32}>
        <FlatIcon name="plus" />
        Добавить зону
      </button>
      {selected && <AreaFields key={`${kind}:${selected.id}`} ctx={ctx} kind={kind} area={selected} />}
    </section>
  );
}
