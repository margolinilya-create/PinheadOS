import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PrintRow from '../../../screens/PrintRow';
import { ISSUE_LABELS, rub } from '../../../screens/labels';
import { placementOf } from '../../model/layout';
import { useDesignStore } from '../../store/useDesignStore';
import ArtworkPicker from './ArtworkPicker';
import PreflightList from './PreflightList';
import LayerList from './LayerList';
import UnplacedList from './UnplacedList';
import { duplicateLayer, moveLayer, patchPrint, placeGeometry, viewPlacements } from './panelOps';
import { CANVAS_LABELS } from '../canvas/canvasChange';
import styles from '../DesignTab.module.css';

/* Инспектор нужен только при выбранном нанесении — своим чанком (потолок холста 100 кБ) */
const GeometryInspector = lazy(() => import('./GeometryInspector'));

/**
 * Панель справа от холста (перенос DM `SidePanel`, разрезан по проверке
 * скиллами): логотипы, нанесения вида, инспектор выбранного и его поля
 * строки (Pantone, цвета, эффект), цена позиции, проверка макета, «Без холста».
 *
 * Все правки — `d.commitPrints` (история undo вкладки); только чтение —
 * без кнопок правки, выбор и просмотр остаются.
 */
export default function DesignSide({ d, order, item, price, readOnly, onOpenItem }) {
  const { ctx, view, selectedKey } = d;
  const [focusKey, setFocusKey] = useState(null);
  const [focusWidth, setFocusWidth] = useState(null);
  const undoRef = useRef(null);
  const select = useDesignStore((s) => s.select);

  const entries = useMemo(() => viewPlacements(item.prints, ctx, view), [item.prints, ctx, view]);
  const placements = useMemo(() => item.prints.map((p) => placementOf(p, ctx.flat)).filter(Boolean), [item.prints, ctx]);
  const free = useMemo(
    () => item.prints.map((print, index) => ({ print, index })).filter(({ print }) => !placementOf(print, ctx.flat)),
    [item.prints, ctx],
  );
  const selected = entries.find((e) => e.print.key === selectedKey) ?? null;
  const unitOf = (key) => price?.prints.find((x) => x.key === key) ?? null;

  useEffect(() => {
    if (d.unplaced) undoRef.current?.focus();
  }, [d.unplaced]);
  const clearFocus = useCallback(() => setFocusKey(null), []);
  const clearWidth = useCallback(() => setFocusWidth(null), []);

  const onAdded = (key) => {
    select(key);
    setFocusWidth(key);
  };
  const onMove = (key, dir) => {
    if (d.commitPrints('Порядок', (prints) => moveLayer(prints, key, dir, ctx))) setFocusKey(key);
  };
  const onDuplicate = (key) => {
    let next = null;
    d.commitPrints('Дубль', (prints) => {
      const res = duplicateLayer(prints, key, ctx);
      next = res?.key ?? null;
      return res?.prints ?? null;
    });
    if (next) {
      select(next);
      setFocusKey(next);
    }
  };
  const onUnplace = (key) => d.onCanvasCommit({ kind: 'unplace', key, label: CANVAS_LABELS.unplace });
  const onShow = (key) => {
    const pl = placements.find((p) => p.print_key === key);
    if (pl && pl.view !== view) useDesignStore.getState().setView(pl.view);
    select(key);
    setFocusKey(key);
  };

  return (
    <aside className={styles.side} aria-label="Панель дизайна">
      {!readOnly && <ArtworkPicker order={order} art={d.art} onAdded={onAdded} />}

      {d.unplaced && (
        <p className={styles.notice} role="status">
          Нанесение снято с холста — строка осталась на вкладке «Изделие».
          <button ref={undoRef} type="button" className={styles.btn} onClick={() => { useDesignStore.getState().undo(); d.clearUnplaced(); }}>
            Вернуть
          </button>
        </p>
      )}

      <section className={styles.section} aria-label="Нанесения вида">
        <h3 className={styles.sectionTitle}>Нанесения на виде</h3>
        <LayerList
          entries={entries}
          selectedKey={selectedKey}
          readOnly={readOnly}
          focusKey={focusKey}
          onFocused={clearFocus}
          onSelect={select}
          onMove={onMove}
          onDuplicate={onDuplicate}
          onUnplace={onUnplace}
        />
      </section>

      {selected && (
        <Suspense fallback={<p className={styles.muted} role="status">Открываю размеры нанесения…</p>}>
          <GeometryInspector
            entry={selected}
            ctx={ctx}
            rules={d.rules}
            readOnly={readOnly}
            autoFocus={focusWidth === selected.print.key}
            onFocused={clearWidth}
            onGeometry={(g, label, key) => d.commitPrints(label, (prints) => placeGeometry(prints, selected.print.key, g, ctx), key)}
            onMethod={(method) => d.commitPrints('Техника', (prints) => patchPrint(prints, selected.print.key, { method }))}
          />
          <details className={styles.details}>
            <summary>Цвета, Pantone, эффект</summary>
            <fieldset className={styles.section} disabled={readOnly}>
              <PrintRow
                print={selected.print}
                index={selected.index}
                itemSizes={item.size_grid.sizes}
                zones={[]}
                unitPrice={unitOf(selected.print.key)?.unit ?? null}
                qty={unitOf(selected.print.key)?.qty ?? 0}
                placed
                embedded
                onChange={(patch) => d.commitPrints('Нанесение', (prints) => patchPrint(prints, selected.print.key, patch), `row:${selected.print.key}`)}
              />
            </fieldset>
          </details>
        </Suspense>
      )}

      <section className={styles.section} aria-label="Цена позиции">
        <h3 className={styles.sectionTitle}>Цена за штуку: {rub(price?.calc_unit)}</h3>
        {(price?.issues ?? []).map((iss) => <p key={iss} className={`${styles.muted} ${styles.warnText}`}>{ISSUE_LABELS[iss]}</p>)}
      </section>

      <PreflightList flat={ctx.flat} placements={placements} rules={d.rules} onShow={onShow} />
      <UnplacedList prints={free} onOpenItem={onOpenItem} />
    </aside>
  );
}
