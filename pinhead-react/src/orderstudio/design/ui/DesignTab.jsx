import { lazy, Suspense, useMemo } from 'react';
import { EditorCanvas } from './canvas/EditorCanvas';
import { DesignIcon } from './DesignIcon';
import ExportPdfButton from './panel/ExportPdfButton';
import FlatNotices from './FlatNotices';
import FlatPicker from './panel/FlatPicker';
import UnplacedList from './panel/UnplacedList';
import ViewTabs from './panel/ViewTabs';
import { hasPlacedLayout } from '../model/layoutMark';
import { flatsForModel } from '../catalog/pickFlat';
import { useDesignTab } from './useDesignTab';
import { useDesignStore } from '../store/useDesignStore';
import styles from './DesignTab.module.css';

/*
 * Превью нужно только на телефоне (≤ 760 px) — своим чанком, не в чанке
 * холста (потолок 100 кБ gzip, README модуля). Кнопка PDF — статически:
 * её листы (`maketPages`) читает и движок PDF, и в чанке кнопки они
 * засчитывались бы ещё и PDF макета.
 */
const DesignPreview = lazy(() => import('./DesignPreview'));
/*
 * Панель справа — своим чанком (раунд 1 ревью 6б): с ней чанк холста не влезал
 * в потолок 100 кБ gzip. Грузится одновременно с первой отрисовкой холста;
 * пока не пришла — пустая колонка той же ширины (`aria-busy`), без сдвига вёрстки.
 * Кэши картинок (`assets/imageLayer`) и листы PDF (`maketTools`) — тоже по требованию.
 */
const DesignSide = lazy(() => import('./panel/DesignSide'));
const SIDE_FALLBACK = <aside className={styles.side} aria-label="Панель дизайна" aria-busy="true" />;
/*
 * Части сцены «Дизайн» 2.0 (веха 5в, Э2, флаг `designStudio`) — один ленивый
 * модуль: обе полосы — от одного `import()`, чанк и запрос — один. Из `stage/`
 * сюда не импортируется ничего статически (потолок холста).
 */
const loadStage = () => import('./stage/StageParts');
const StageTop = lazy(() => loadStage().then((m) => ({ default: m.StageTop })));
const StageBelow = lazy(() => loadStage().then((m) => ({ default: m.StageBelow })));
const ItemTotalBar = lazy(() => loadStage().then((m) => ({ default: m.ItemTotalBar })));
const STAGE_TOP_FALLBACK = <div className={styles.stageBarFallback} aria-hidden="true" />;

/**
 * Вкладка «Дизайн» рабочего места `/sales/:id?tab=design&item=<key>` (веха 5а,
 * задача 6б). Ленивый корень чанка холста: `OrderWorkplace` грузит её через
 * `React.lazy`, konva и панель в оболочку Order не попадают (маркер
 * `data-design-canvas` сторожит `bundle-budget`).
 *
 * Источник правды — заказ: холст и панель выводят размещения из нанесений
 * позиции и пишут через стор дизайна (`commit` → `useSalesStore.edit`).
 * Открытие вкладки ничего не пишет — ни нанесений, ни `flat_id`.
 *
 * - шапка: силуэт, виды (перед, спина, рукава — 5б), отмена и возврат, «Скачать PDF макета»;
 * - плашки силуэта (`FlatNotices`): модель сменилась, силуэт обновлён до новой
 *   версии, появился точный силуэт; холст — по флэту версии позиции (`useItemFlat`);
 * - холст (`EditorCanvas`) и панель справа (`DesignSide`, своим чанком);
 * - ≤ 760 px (`compact`) — только просмотр: статичное превью `<img>`;
 * - только чтение (не черновик) — холст без правки, PDF доступен.
 */
export default function DesignTab({ order, item, price, readOnly, compact = false, onOpenItem }) {
  const d = useDesignTab({ order, item, readOnly: readOnly || compact });
  const { flats, flat } = d;
  const ro = readOnly || compact;
  // «Справочник пуст» — по всем активным; в выборе — только силуэты этой модели (B1, веха 5в)
  const choices = useMemo(() => flats.catalog.flats.filter((f) => f.active), [flats.catalog]);
  const forModel = useMemo(() => flatsForModel(flats.catalog, item, d.sku), [flats.catalog, item, d.sku]);
  const { select, undo, redo } = useDesignStore.getState();

  let notice = null;
  if (flats.status === 'loading' && !flat) {
    notice = <p className={styles.notice} role="status">Загружаю силуэты изделий…</p>;
  } else if (flats.status === 'error') {
    notice = (
      <p className={`${styles.notice} ${styles.warn}`} role="alert">
        Силуэты изделий не загрузились.
        <button type="button" className={styles.btn} onClick={flats.reload}>Повторить</button>
      </p>
    );
  } else if (!flat && !item.sku_code) {
    notice = (
      <p className={styles.notice}>
        Сначала выберите модель на вкладке «Изделие».
        <button type="button" className={styles.btn} onClick={onOpenItem}>Открыть «Изделие»</button>
      </p>
    );
  } else if (!flat && choices.length === 0) {
    notice = (
      <p className={styles.notice}>
        Типовых силуэтов пока нет. Загрузите 35 моделей одной кнопкой — «Справочники заказа», вкладка «Флэты и зоны».
        Пока нанесения задаются строками на вкладке «Изделие».
      </p>
    );
  } else if (!flat) {
    notice = (
      <p className={styles.notice}>
        Для этой модели нет силуэта — задайте нанесения строками.
        <button type="button" className={styles.btn} onClick={onOpenItem}>Открыть нанесения</button>
      </p>
    );
  }

  return (
    <section className={styles.tab} data-design-canvas="" aria-label="Дизайн изделия">
      <div className={styles.head}>
        <FlatPicker flats={forModel} current={flat} readOnly={ro} onPick={d.switchFlat} />
        {flat && !compact && <ViewTabs flat={flat} views={d.views} prints={item.prints} view={d.view} onView={(v) => useDesignStore.getState().setView(v)} />}
        <span className={styles.headGrow} />
        {flat && !ro && (
          <div className={styles.row} role="group" aria-label="История правок">
            <button type="button" className={styles.iconBtn} onClick={undo} disabled={!d.undoLabel}
              aria-label={d.undoLabel ? `Отменить: ${d.undoLabel}` : 'Отменить — нечего'}>
              <DesignIcon name="undo" />
            </button>
            <button type="button" className={styles.iconBtn} onClick={redo} disabled={!d.redoLabel}
              aria-label={d.redoLabel ? `Вернуть: ${d.redoLabel}` : 'Вернуть — нечего'}>
              <DesignIcon name="redo" />
            </button>
          </div>
        )}
        <ExportPdfButton order={order} item={item} flat={flat} disabled={flats.status === 'loading'} />
      </div>

      {notice}
      {/* Силуэта нет (снят, не подобрался), а раскладка осталась — на «Изделии» строка заперта: освободить здесь */}
      {!flat && flats.status === 'ready' && (
        <UnplacedList
          prints={item.prints.map((print, index) => ({ print, index })).filter(({ print }) => hasPlacedLayout(print.layout, item.flat_id))}
          flatId={item.flat_id}
          readOnly={ro}
          onOpenItem={onOpenItem}
          onRelease={d.releaseLayout}
        />
      )}
      <FlatNotices d={d} readOnly={ro} />

      {flat && compact && (
        <Suspense fallback={<p className={styles.muted} role="status">Готовлю превью…</p>}>
          <DesignPreview orderId={order.id} item={item} flat={flat} colorHex={d.colorHex} />
        </Suspense>
      )}
      {flat && !compact && d.studio && (
        <Suspense fallback={STAGE_TOP_FALLBACK}>
          <StageTop d={d} item={item} readOnly={ro} />
        </Suspense>
      )}
      {flat && !compact && (
        <div className={styles.body}>
          <div className={styles.stageCol}>
            <div className={styles.stage}>
              <EditorCanvas
                flat={flat}
                view={d.view}
                prints={item.prints}
                selectedKey={d.selectedKey}
                readOnly={ro}
                onSelect={select}
                onCommit={d.onCanvasCommit}
                onDropFile={ro ? undefined : d.art.addFile}
                orderId={order.id}
                colorHex={d.colorHex}
                display={d.display}
                onDuplicate={ro ? undefined : (key) => d.layerOp('duplicate', key)}
                onCopyLayer={d.copyLayer}
                onPasteLayer={ro ? undefined : (token) => d.layerOp('paste', token)}
                onUndo={undo}
                onRedo={redo}
              />
            </div>
            {d.studio && (
              <Suspense fallback={null}>
                <StageBelow d={d} item={item} />
                <ItemTotalBar item={item} price={price} />
              </Suspense>
            )}
          </div>
          <Suspense fallback={SIDE_FALLBACK}>
            <DesignSide d={d} order={order} item={item} price={price} readOnly={ro} onOpenItem={onOpenItem} />
          </Suspense>
        </div>
      )}
    </section>
  );
}
