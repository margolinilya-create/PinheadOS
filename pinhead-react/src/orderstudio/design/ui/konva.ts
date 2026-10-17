/**
 * Konva для вкладки «Дизайн» — ЕДИНСТВЕННОЕ место импорта `konva` и
 * `react-konva` в приложении (веха 5а, задача 6а; сторож — `konva.test.ts`).
 *
 * Только Core-подпути (замер задачи 0, `design/README.md`): ядро konva без
 * фигур + ровно те фигуры, что рисует холст. Пакеты целиком (`konva`,
 * `react-konva`) регистрируют все 20+ фигур — чанк холста вырос бы мимо
 * потолка 100 кБ gzip. **`Arrow` не подключать**: он тянет `Path` и
 * `BezierFunctions` (+8,5 кБ); наконечник размерной линии рисуется `Line`
 * (`canvas/canvasMath.arrowHead`).
 *
 * Регистрация фигуры — побочный эффект импорта её модуля: без него
 * react-konva не знает тип узла и падает «Konva has no node with the type …».
 * Чанк — `vendor-konva` (`vite.config.js`, `manualChunks`); во вход и
 * оболочки он не попадает (`scripts/bundle-budget.mjs`).
 *
 * Тесты jsdom подменяют этот модуль простыми div (`vi.mock('../konva')`):
 * konva проверяется в e2e.
 */
import 'konva/lib/shapes/Image';
import 'konva/lib/shapes/Rect';
import 'konva/lib/shapes/Line';
import 'konva/lib/shapes/Text';
import 'konva/lib/shapes/Transformer';

export { Stage, Layer, Group, Image, Rect, Line, Text, Transformer } from 'react-konva/lib/ReactKonvaCore';
