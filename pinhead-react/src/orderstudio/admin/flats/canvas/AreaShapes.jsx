import { Group, Line, Rect, Text } from '../../../design/ui/konva';
import { nodeToRect, rectToNode, toMmTenth, toPx } from './canvasMath';

/**
 * Зоны вида на холсте редактора флэта (веха 5б, задача 6а; DM `FlatEditorCanvas`
 * — одна зона, здесь — все зоны вида из сцены `buildScene`):
 * - прямоугольник по осям — `Rect`: тянется в режиме «Выбор», рамку меняет
 *   трансформер холста (`FlatCanvas`), итог — `onRect(id, рамка мм)`;
 * - многоугольник — `Line closed` как есть: молча в прямоугольник он не
 *   превращается (К12), его вершины правятся в режиме «Точки»;
 * - safe-зона — пунктир по рамке, сжатой на отступ;
 * - в режиме «Точки» у выбранной зоны — ручки вершин (`Rect`, область
 *   попадания ≥ 44 px пальцем), итог — `onPoint(id, index, [x, y])`.
 *
 * Обводка: обычная — тонкая сплошная, выбранная — толще. Узел после
 * перетаскивания возвращается на место из пропсов до вызова обработчика:
 * правку применяет родитель, отклонённая правка не оставит зону «уехавшей».
 * `readOnly` — без перетаскивания и обработчиков правки; выбор остаётся.
 */

const VERTEX_PX = 12;
const VERTEX_HIT_PX = 28;
const VERTEX_HIT_COARSE_PX = 44;
const LABEL_FONT_PX = 12;

const rectAttrs = (n) => ({ x: n.x(), y: n.y(), width: n.width(), height: n.height(), scaleX: n.scaleX(), scaleY: n.scaleY() });

function Vertex({ areaId, index, point, f, tokens, coarse, active, onPoint, onPointPick }) {
  const p = toPx(f, { x: point[0], y: point[1] });
  const hit = coarse ? VERTEX_HIT_COARSE_PX : VERTEX_HIT_PX;
  return (
    <Group
      x={p.x}
      y={p.y}
      name={`vertex:${areaId}:${index}`}
      draggable
      onMouseDown={() => onPointPick(index)}
      onTouchStart={() => onPointPick(index)}
      onDragEnd={(e) => {
        const n = e.target;
        const at = toMmTenth(f, { x: n.x(), y: n.y() });
        n.position(p);
        onPoint(areaId, index, at);
      }}
    >
      <Rect x={-hit / 2} y={-hit / 2} width={hit} height={hit} fill="transparent" />
      <Rect
        x={-VERTEX_PX / 2}
        y={-VERTEX_PX / 2}
        width={VERTEX_PX}
        height={VERTEX_PX}
        cornerRadius={2}
        fill={active ? tokens.zone : tokens.halo}
        stroke={tokens.zone}
        strokeWidth={2}
      />
    </Group>
  );
}

function AreaShape({ area, f, tokens, editable, onSelect, onRect, registerRef }) {
  const stroke = tokens.zone;
  const strokeWidth = area.selected ? 3 : 1.25;
  const select = () => onSelect(area.id);
  const label = (
    <Text
      x={toPx(f, { x: area.box.x, y: area.box.y }).x + 4}
      y={toPx(f, { x: area.box.x, y: area.box.y }).y + 4}
      text={area.name}
      fontSize={LABEL_FONT_PX}
      fill={tokens.label}
      listening={false}
    />
  );
  const safe = area.safe && (
    <Rect {...rectToNode(f, area.safe)} stroke={tokens.safe} strokeWidth={1} dash={[4, 4]} listening={false} />
  );

  if (!area.rect) {
    return (
      <Group>
        <Line
          name={`area:${area.id}`}
          points={area.points.flatMap(([x, y]) => { const p = toPx(f, { x, y }); return [p.x, p.y]; })}
          closed
          fill="transparent"
          stroke={stroke}
          strokeWidth={strokeWidth}
          onClick={select}
          onTap={select}
        />
        {safe}
        {label}
      </Group>
    );
  }

  const node = rectToNode(f, area.box);
  const edit = editable
    ? {
      draggable: true,
      onDragStart: select,
      onDragEnd: (e) => {
        const n = e.target;
        const r = nodeToRect(f, rectAttrs(n));
        n.setAttrs(node);
        onRect(area.id, { ...r, w: area.box.w, h: area.box.h });
      },
      onTransformEnd: (e) => {
        const n = e.target;
        const r = nodeToRect(f, rectAttrs(n));
        n.setAttrs({ ...node, scaleX: 1, scaleY: 1 });
        onRect(area.id, r);
      },
    }
    : { draggable: false };
  return (
    <Group>
      <Rect
        ref={(n) => registerRef(area.id, n)}
        name={`area:${area.id}`}
        {...node}
        fill="transparent"
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeScaleEnabled={false}
        onClick={select}
        onTap={select}
        {...edit}
      />
      {safe}
      {label}
    </Group>
  );
}

export function AreaShapes({
  scene, f, tokens, coarse, readOnly, onSelect, onRect, onPoint, pointIndex, onPointPick, registerRef,
}) {
  const editable = !readOnly && scene.mode === 'select';
  const points = !readOnly && scene.mode === 'points' ? scene.areas.find((a) => a.selected) : null;
  return (
    <>
      {scene.areas.map((area) => (
        <AreaShape
          key={area.id}
          area={area}
          f={f}
          tokens={tokens}
          editable={editable}
          onSelect={onSelect}
          onRect={onRect}
          registerRef={registerRef}
        />
      ))}
      {points && points.points.map((pt, i) => (
        <Vertex
          // Вершины без своих id: ключ — место в многоугольнике (порядок и есть геометрия)
          key={i}
          areaId={points.id}
          index={i}
          point={pt}
          f={f}
          tokens={tokens}
          coarse={coarse}
          active={pointIndex === i}
          onPoint={onPoint}
          onPointPick={onPointPick}
        />
      ))}
    </>
  );
}
