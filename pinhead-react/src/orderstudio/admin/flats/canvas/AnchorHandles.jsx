import { Group, Line, Rect, Text } from '../../../design/ui/konva';
import { lockAxis, toMmTenth, toPx } from './canvasMath';
import { anchorPatch } from './sceneText';

/**
 * Якоря вида на холсте редактора флэта (веха 5б, задача 6а; DM
 * `FlatEditorCanvas` → `Handle`, без `Circle`: фигур konva не прибавляем).
 *
 * Ручки различаются ФОРМОЙ и ПОДПИСЬЮ, а не только цветом:
 * - ось изделия и центр рукава — вертикальная планка, тянутся только по X
 *   (`dragBoundFunc`: ось не «уезжает» по Y — дефект 8 DM);
 * - низ рукава — горизонтальная планка, только по Y;
 * - горловина — круглая ручка, X и Y (у аксессуара её нет — `buildScene`).
 *
 * Видимая ручка — 16–24 px; область попадания — прозрачный `Rect` вокруг:
 * 28 px мышью, 44 px пальцем (`coarse`). Итог перетаскивания —
 * `onAnchors(патч якорей)`; узел возвращается на место из пропсов, новое
 * место приходит от родителя. Направляющие (пунктир осей) — `AnchorGuides`.
 */

const HIT_PX = 28;
const HIT_COARSE_PX = 44;
const BAR_LONG = 24;
const BAR_SHORT = 16;
const KNOB = 16;
const LABEL_FONT_PX = 12;

/** Видимая форма ручки: прямоугольник относительно центра */
function shapeOf(id) {
  if (id === 'axis' || id === 'sleeve_center') return { w: BAR_SHORT, h: BAR_LONG, r: 2 };
  if (id === 'sleeve_bottom') return { w: BAR_LONG, h: BAR_SHORT, r: 2 };
  return { w: KNOB, h: KNOB, r: KNOB / 2 };
}

function Handle({ handle, f, tokens, coarse, onAnchors }) {
  const at = toPx(f, handle);
  const s = shapeOf(handle.id);
  const hit = coarse ? HIT_COARSE_PX : HIT_PX;
  const color = handle.id === 'neckline' || handle.id === 'sleeve_bottom' ? tokens.neck : tokens.axis;
  return (
    <Group
      x={at.x}
      y={at.y}
      name={`anchor:${handle.id}`}
      draggable
      dragBoundFunc={(pos) => lockAxis(handle.axis, at, pos)}
      onDragEnd={(e) => {
        const n = e.target;
        const mm = toMmTenth(f, { x: n.x(), y: n.y() });
        n.position(at);
        onAnchors(anchorPatch(handle.id, mm));
      }}
    >
      <Rect x={-hit / 2} y={-hit / 2} width={hit} height={hit} fill="transparent" />
      <Rect
        x={-s.w / 2}
        y={-s.h / 2}
        width={s.w}
        height={s.h}
        cornerRadius={s.r}
        fill={color}
        stroke={tokens.halo}
        strokeWidth={2}
      />
      <Text
        x={hit / 2}
        y={-LABEL_FONT_PX / 2}
        text={handle.label}
        fontSize={LABEL_FONT_PX}
        fill={tokens.label}
        listening={false}
      />
    </Group>
  );
}

export function AnchorHandles({ scene, f, tokens, coarse, onAnchors }) {
  return (
    <>
      {scene.handles.map((h) => (
        <Handle key={h.id} handle={h} f={f} tokens={tokens} coarse={coarse} onAnchors={onAnchors} />
      ))}
    </>
  );
}

/** Пунктир якорей и именованных осей на всю высоту (ширину) флэта; по ним не кликают */
export function AnchorGuides({ scene, f, flatMm, tokens }) {
  return (
    <>
      {scene.guides.map((g) => {
        const a = g.orient === 'v' ? toPx(f, { x: g.at, y: 0 }) : toPx(f, { x: 0, y: g.at });
        const b = g.orient === 'v' ? toPx(f, { x: g.at, y: flatMm.h }) : toPx(f, { x: flatMm.w, y: g.at });
        return (
          <Line
            key={g.id}
            points={[a.x, a.y, b.x, b.y]}
            stroke={g.id === 'sleeve_bottom' ? tokens.neck : tokens.axis}
            strokeWidth={1}
            dash={[6, 6]}
            listening={false}
          />
        );
      })}
    </>
  );
}
