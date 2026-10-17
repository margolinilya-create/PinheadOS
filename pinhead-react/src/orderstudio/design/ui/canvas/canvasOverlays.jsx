import { Group, Line, Rect, Text } from '../konva';
import { buildDimensionLines } from '../../geometry/dimensionLines';
import { polygonToZone } from '../../geometry/coords';
import { arrowHead } from './canvasMath';

/**
 * Служебные слои холста (веха 5а, задача 6а; перенос DM `canvasOverlays.tsx`):
 * сетка 50 мм в зоне, зоны и safe-зоны, именованные оси изделия, обвязка
 * выбранного нанесения и гайды привязки. Все слои — `listening={false}`
 * у родителя: по ним не кликают.
 *
 * Отличия от DM: стрелки — `Line` + наконечник `arrowHead` (фигура `Arrow`
 * запрещена бюджетом), числа обвязки — из `buildDimensionLines` (их же берёт
 * PDF макета), цвета — из токенов (`useCanvasTheme`), обводка зон — по яркости
 * ткани (на тёмной — светлая).
 */

const GRID_MM = 50;
/** Обводка зоны на тёмной ткани — контраст с тканью, а не с темой интерфейса */
const ZONE_ON_DARK = '#ffffff';
const GRID_ON_DARK = 'rgba(255,255,255,0.22)';
const GRID_ON_LIGHT = 'rgba(15,23,42,0.12)';

/** Сетка 50 мм в пределах зоны — масштаб «на глаз» */
export function GridLines({ area, t, darkFabric }) {
  const z = polygonToZone(area.polygon_mm);
  const stroke = darkFabric ? GRID_ON_DARK : GRID_ON_LIGHT;
  const lines = [];
  for (let x = Math.ceil(z.zx / GRID_MM) * GRID_MM; x <= z.zx + z.zw; x += GRID_MM) {
    lines.push(<Line key={`v${x}`} points={[t.px(x), t.py(z.zy), t.px(x), t.py(z.zy + z.zh)]} stroke={stroke} strokeWidth={1} />);
  }
  for (let y = Math.ceil(z.zy / GRID_MM) * GRID_MM; y <= z.zy + z.zh; y += GRID_MM) {
    lines.push(<Line key={`h${y}`} points={[t.px(z.zx), t.py(y), t.px(z.zx + z.zw), t.py(y)]} stroke={stroke} strokeWidth={1} />);
  }
  return <>{lines}</>;
}

/** Зоны вида: контур пунктиром и safe-зона (прямоугольный отступ по рамке зоны) */
export function ZoneShapes({ view, t, colors, darkFabric }) {
  const stroke = darkFabric ? ZONE_ON_DARK : colors.accent;
  return (
    <>
      {view.print_areas.map((area) => {
        const z = polygonToZone(area.polygon_mm);
        const inset = area.safe_inset_mm;
        return (
          <Group key={area.id}>
            <Line points={area.polygon_mm.flatMap(([x, y]) => [t.px(x), t.py(y)])} closed stroke={stroke} strokeWidth={1.5} dash={[8, 6]} />
            <Rect
              x={t.px(z.zx + inset)}
              y={t.py(z.zy + inset)}
              width={Math.max(0, t.s(z.zw - 2 * inset))}
              height={Math.max(0, t.s(z.zh - 2 * inset))}
              stroke={colors.safe}
              strokeWidth={1}
              dash={[4, 4]}
            />
          </Group>
        );
      })}
    </>
  );
}

/** Именованные вертикальные оси (выточки, рельефы): пунктир и подпись */
export function NamedAxes({ view, t, flatH, colors }) {
  return (
    <>
      {(view.anchors.axes ?? []).map((a) => (
        <Group key={a.id}>
          <Line points={[t.px(a.x), t.py(0), t.px(a.x), t.py(flatH)]} stroke={colors.axis} strokeWidth={0.8} dash={[6, 6]} opacity={0.7} />
          <Text x={t.px(a.x) + 3} y={t.py(0) + 4} text={a.name} fontSize={11} fill={colors.axis} />
        </Group>
      ))}
    </>
  );
}

/** Подпись числа с подложкой — читается и на светлой, и на тёмной ткани */
function Label({ x, y, text, fill, colors }) {
  const w = Math.max(24, text.length * 7 + 8);
  return (
    <Group x={x} y={y}>
      <Rect x={-w / 2} y={-8} width={w} height={16} cornerRadius={3} fill={colors.halo} opacity={0.88} />
      <Text x={-w / 2} y={-6} width={w} align="center" text={text} fontSize={11} fill={fill} />
    </Group>
  );
}

/** Линия с наконечниками на обоих концах (вместо фигуры `Arrow`) */
function Measure({ from, to, t, color }) {
  const [x1, y1, x2, y2] = [t.px(from.x), t.py(from.y), t.px(to.x), t.py(to.y)];
  const a = arrowHead(x1, y1, x2, y2, 5, 5);
  const b = arrowHead(x2, y2, x1, y1, 5, 5);
  return (
    <>
      <Line points={[x1, y1, x2, y2]} stroke={color} strokeWidth={1} />
      {a.length > 0 && <Line points={a} closed fill={color} stroke={color} strokeWidth={1} />}
      {b.length > 0 && <Line points={b} closed fill={color} stroke={color} strokeWidth={1} />}
    </>
  );
}

const mid = (l) => ({ x: (l.from.x + l.to.x) / 2, y: (l.from.y + l.to.y) / 2 });

/**
 * Обвязка выбранного нанесения: отступы до краёв зоны, отступ от опоры
 * (горловина, пояс, верх зоны) по оси изделия и от оси до центра, размер Ш×В.
 */
export function DimensionOverlay({ view, placement: p, t, colors }) {
  const scene = buildDimensionLines(view, { x: p.x_mm, y: p.y_mm, w: p.width_mm, h: p.height_mm }, p.rotation_deg, undefined, p.area_id);
  const { aabb, zone } = scene;
  const cx = aabb.x + aabb.w / 2;
  const cy = aabb.y + aabb.h / 2;
  const sizeText = `${Math.round(aabb.w)}×${Math.round(aabb.h)} мм`;
  const sizeW = sizeText.length * 7 + 12;
  return (
    <>
      {scene.lines.map((l) => {
        const color = l.danger ? colors.danger : l.kind.endsWith('anchor') ? colors.accent : colors.dim;
        const m = mid(l);
        return (
          <Group key={l.kind}>
            {l.kind === 'vertical-anchor'
              ? <Line points={[t.px(l.from.x), t.py(l.from.y), t.px(l.to.x), t.py(l.to.y)]} stroke={color} strokeWidth={1} dash={[5, 4]} />
              : <Measure from={l.from} to={l.to} t={t} color={color} />}
            <Label x={t.px(m.x)} y={t.py(m.y)} text={`${Math.round(l.value)}`} fill={color} colors={colors} />
          </Group>
        );
      })}
      <Line
        points={[t.px(scene.centerX), t.py(zone.zy), t.px(scene.centerX), t.py(zone.zy + zone.zh)]}
        stroke={colors.accent}
        strokeWidth={1}
        dash={[3, 5]}
        opacity={0.7}
      />
      <Group x={t.px(cx)} y={t.py(cy)}>
        <Rect x={-sizeW / 2} y={-9} width={sizeW} height={18} cornerRadius={4} fill={colors.accent} />
        <Text x={-sizeW / 2} y={-7} width={sizeW} align="center" text={sizeText} fontSize={12} fontStyle="bold" fill={colors.onAccent} />
      </Group>
    </>
  );
}

/** Гайды выравнивания при перетаскивании (мм-координаты линий) */
export function SnapGuides({ guides, t, flatMm, colors }) {
  if (!guides) return null;
  return (
    <>
      {guides.x !== undefined && (
        <Line points={[t.px(guides.x), t.py(0), t.px(guides.x), t.py(flatMm.h)]} stroke={colors.guide} strokeWidth={1} dash={[4, 4]} />
      )}
      {guides.y !== undefined && (
        <Line points={[t.px(0), t.py(guides.y), t.px(flatMm.w), t.py(guides.y)]} stroke={colors.guide} strokeWidth={1} dash={[4, 4]} />
      )}
    </>
  );
}
