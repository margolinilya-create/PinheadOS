import { setAnchors, setAxes } from '../../design/edit/flatEdit';
import { MmField } from './flatFields';
import { errorsAt, GEOMETRY_HINT, viewFieldId } from './flatEditorView';
import styles from './FlatEditor.module.css';

const isSleeve = (k) => k === 'sleeve_left' || k === 'sleeve_right';

/**
 * Якоря вида с клавиатуры (альтернатива ручкам холста): горловина и ось
 * у переда и спины (у аксессуара — только ось), низ и центр у рукава,
 * дополнительные оси — по X. Правка якорей — геометрия, новая версия.
 */
export default function AnchorFields({ ctx, view }) {
  const { kind } = view;
  const a = view.anchors;
  const set = (patch) => ctx.edit((f) => setAnchors(f, kind, patch));
  const errors = errorsAt(ctx.errors, kind, undefined, 'anchors');
  const first = viewFieldId(kind, 'anchors');

  return (
    <fieldset className={styles.group}>
      <legend>Якоря</legend>
      <p className={styles.geoHint}>{GEOMETRY_HINT}</p>
      {isSleeve(kind) ? (
        <div className={styles.pair}>
          <MmField id={first} label="Низ рукава, Y мм" value={a.sleeve_bottom_y ?? null} optional errors={errors}
            onCommit={(v) => set({ sleeve_bottom_y: v ?? undefined })} />
          <MmField id={`${first}-cx`} label="Центр рукава, X мм" value={a.sleeve_center_x ?? null} optional
            onCommit={(v) => set({ sleeve_center_x: v ?? undefined })} />
        </div>
      ) : (
        <div className={styles.pair}>
          {!ctx.accessory && (
            <>
              <MmField id={first} label="Горловина, X мм" value={a.neckline_point?.x ?? null} errors={errors}
                onCommit={(v) => set({ neckline_point: { x: v, y: a.neckline_point?.y ?? 0 } })} />
              <MmField id={`${first}-ny`} label="Горловина, Y мм" value={a.neckline_point?.y ?? null}
                onCommit={(v) => set({ neckline_point: { x: a.neckline_point?.x ?? 0, y: v } })} />
            </>
          )}
          <MmField id={ctx.accessory ? first : `${first}-ax`} label="Ось, X мм" value={a.center_axis_x ?? null} optional
            errors={ctx.accessory ? errors : undefined} onCommit={(v) => set({ center_axis_x: v ?? undefined })} />
        </div>
      )}
      {(a.axes ?? []).map((ax, i) => (
        <MmField key={ax.id} id={`${first}-axis-${ax.id}`} label={`Ось «${ax.name}», X мм`} value={ax.x}
          onCommit={(v) => ctx.edit((f) => setAxes(f, kind, a.axes.map((x, j) => (j === i ? { ...x, x: v } : x))))} />
      ))}
    </fieldset>
  );
}
