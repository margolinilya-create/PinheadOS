import { Line, Rect } from '../../../design/ui/konva';
import { toPx } from './canvasMath';

/**
 * Калибровка по известному размеру на холсте (веха 5б, К11; DM `FlatEditorCanvas`,
 * режим «Калибровка»): два клика по холсту — две точки в мм флэта, отмер между
 * ними уходит родителю `onMeasured(мм)`; он спрашивает настоящую длину и
 * пересчитывает вид (`calibrateView`). Третий клик начинает отмер заново,
 * Esc и выход из режима — сбрасывают точки.
 *
 * Состояние отмера — `useCalibration.ts`. Клавиатурная альтернатива — поле
 * «Ширина силуэта, мм» в панели (задача 6б).
 */

const POINT_PX = 8;

/** Точки и отрезок отмера; по ним не кликают */
export function CalibrateLayer({ points, f, tokens }) {
  const px = points.map((p) => toPx(f, p));
  return (
    <>
      {px.length === 2 && (
        <Line points={[px[0].x, px[0].y, px[1].x, px[1].y]} stroke={tokens.calibrate} strokeWidth={2} dash={[6, 4]} listening={false} />
      )}
      {px.map((p, i) => (
        <Rect
          // Две точки отмера: ключ — порядок (первая и вторая)
          key={i === 0 ? 'a' : 'b'}
          x={p.x - POINT_PX / 2}
          y={p.y - POINT_PX / 2}
          width={POINT_PX}
          height={POINT_PX}
          fill={tokens.calibrate}
          stroke={tokens.halo}
          strokeWidth={1}
          listening={false}
        />
      ))}
    </>
  );
}
