import { useCallback, useMemo } from 'react';
import { Group, Image as KImage, Rect } from '../konva';
import { placementInfo } from '../../geometry/view';
import { toNode } from './canvasMath';

/**
 * Нанесение на холсте (веха 5а, задача 6а; перенос DM `PlacementNode.tsx`).
 *
 * - Центр-ориджин (`toNode`): поворот и отражение — вокруг центра нанесения.
 * - Картинка обрезана по рамке зоны (что вне зоны — не печатается); вышло за
 *   зону — зона подсвечивается пунктиром цвета ошибки.
 * - Картинка ещё не пришла (или не вышла — тост уже показан) — пунктирная
 *   рамка того же размера: нанесение видно и выбирается.
 * - Выбор — по нажатию и касанию, и в режиме «только чтение» (обвязка
 *   смотрится, правки нет); перетаскивание — только при `draggable`.
 * - На пальце (`coarse`) зона попадания толще на `hitStrokeWidth`.
 *
 * Узел konva регистрируется в `registerRef(ключ, узел)`: к нему
 * цепляется трансформер выбранного, и после правки его состояние сверяется
 * с пропсами (`EditorCanvas`).
 */
export function PlacementNode({
  placement: p, view, t, image, selected, draggable, coarse, colors,
  onSelect, registerRef, onDragMove, onDragEnd, onTransformEnd,
}) {
  const info = useMemo(
    () => placementInfo(view, { x: p.x_mm, y: p.y_mm, w: p.width_mm, h: p.height_mm }, p.rotation_deg, undefined, p.area_id),
    [view, p.x_mm, p.y_mm, p.width_mm, p.height_mm, p.rotation_deg, p.area_id],
  );
  const { zone } = info;
  const node = toNode(p, t);
  const key = p.print_key;
  const select = () => onSelect(key);
  // Ref-колбэк стабилен на ключ: новый на каждом рендере дёргал бы ref null → узел
  const ref = useCallback((n) => registerRef(key, n), [registerRef, key]);
  const outline = selected ? colors.accent : image ? undefined : colors.dim;

  return (
    <>
      <Group clipX={t.px(zone.zx)} clipY={t.py(zone.zy)} clipWidth={t.s(zone.zw)} clipHeight={t.s(zone.zh)}>
        <KImage
          ref={ref}
          name={p.print_key}
          image={image ?? undefined}
          {...node}
          draggable={draggable}
          stroke={outline}
          strokeWidth={outline ? 1.5 : 0}
          strokeScaleEnabled={false}
          dash={!selected && !image ? [4, 4] : undefined}
          hitStrokeWidth={coarse ? 24 : 'auto'}
          onMouseDown={select}
          onTap={select}
          onDragMove={(e) => onDragMove(p, e.target)}
          onDragEnd={(e) => onDragEnd(p, e.target)}
          onTransformEnd={(e) => onTransformEnd(p, e.target)}
        />
      </Group>
      {info.check.out_of_zone && (
        <Rect
          x={t.px(zone.zx)}
          y={t.py(zone.zy)}
          width={t.s(zone.zw)}
          height={t.s(zone.zh)}
          stroke={colors.danger}
          strokeWidth={2}
          dash={[6, 4]}
          listening={false}
        />
      )}
    </>
  );
}
