import { lazy, Suspense, useMemo } from 'react';
import { EditorCanvas } from './canvas/EditorCanvas';
import { DesignIcon } from './DesignIcon';
import DesignSide from './panel/DesignSide';
import ExportPdfButton from './panel/ExportPdfButton';
import FlatPicker from './panel/FlatPicker';
import ViewTabs from './panel/ViewTabs';
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
 * - шапка: силуэт, «Перед / Спина», отмена и возврат, «Скачать PDF макета»;
 * - холст (`EditorCanvas`) и панель справа (`DesignSide`);
 * - ≤ 760 px (`compact`) — только просмотр: статичное превью `<img>`;
 * - только чтение (не черновик) — холст без правки, PDF доступен.
 */
export default function DesignTab({ order, item, price, readOnly, compact = false, onOpenItem }) {
  const d = useDesignTab({ order, item, readOnly: readOnly || compact });
  const { flats, pick, flat } = d;
  const ro = readOnly || compact;
  const choices = useMemo(() => flats.catalog.flats.filter((f) => f.active), [flats.catalog]);
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
        <FlatPicker flats={choices} current={flat} readOnly={ro} onPick={d.switchFlat} />
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
      {flat && pick.modelChanged && (
        <p className={`${styles.notice} ${styles.warn}`}>
          Модель сменилась — перенесите нанесения на новый силуэт.
          {pick.suggested && !ro && (
            <button type="button" className={styles.btn} onClick={() => d.switchFlat(pick.suggested)}>
              Перенести на «{pick.suggested.name}»
            </button>
          )}
        </p>
      )}
      {flat?.typical && <p className={styles.muted}>Силуэт типовой, не лекало модели: размеры и отступы — ориентир для цеха.</p>}
      {d.switchNote && <p className={styles.notice} role="status">{d.switchNote}</p>}

      {flat && compact && (
        <Suspense fallback={<p className={styles.muted} role="status">Готовлю превью…</p>}>
          <DesignPreview orderId={order.id} item={item} flat={flat} colorHex={d.colorHex} />
        </Suspense>
      )}
      {flat && !compact && (
        <div className={styles.body}>
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
              onUndo={undo}
              onRedo={redo}
            />
          </div>
          <DesignSide d={d} order={order} item={item} price={price} readOnly={ro} onOpenItem={onOpenItem} />
        </div>
      )}
    </section>
  );
}
