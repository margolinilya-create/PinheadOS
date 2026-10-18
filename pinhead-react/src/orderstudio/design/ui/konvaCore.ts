/**
 * Ядро konva для холста «Дизайн» БЕЗ анимаций (веха 5а, задача 6б, раунд 1).
 *
 * `react-konva/lib/ReactKonvaCore` берёт ядро из `konva/lib/Core`, а оно
 * (`_CoreInternals`) регистрирует ещё `Tween`, `Easings`, `Animation`
 * и `FastLayer` — ≈ 3 кБ gzip, которыми холст не пользуется: анимаций нет,
 * перерисовка — `batchDraw` слоя. `vite.config.js` подменяет
 * `konva/lib/Core` этим модулем (`resolve.alias`), поэтому чанк `vendor-konva`
 * их не везёт (потолок холста 100 кБ gzip, `design/README.md`).
 *
 * Состав — `konva/lib/_CoreInternals.js` (konva 9.3) без четырёх имён выше.
 * Обновили konva — сверить с её `_CoreInternals`; понадобилась анимация —
 * вернуть `Tween`/`Animation` сюда, а не импортировать мимо.
 * Сторож — `konva.test.ts` (белый список подпутей и подмена в конфиге).
 */
import { Konva as Global } from 'konva/lib/Global';
import { Util, Transform } from 'konva/lib/Util';
import { Node } from 'konva/lib/Node';
import { Container } from 'konva/lib/Container';
import { Stage, stages } from 'konva/lib/Stage';
import { Layer } from 'konva/lib/Layer';
import { Group } from 'konva/lib/Group';
import { DD } from 'konva/lib/DragAndDrop';
import { Shape, shapes } from 'konva/lib/Shape';
import { Context } from 'konva/lib/Context';
import { Canvas } from 'konva/lib/Canvas';

export const Konva = Util._assign(Global, {
  Util, Transform, Node, Container, Stage, stages, Layer, Group, DD, Shape, shapes, Context, Canvas,
});

export default Konva;
