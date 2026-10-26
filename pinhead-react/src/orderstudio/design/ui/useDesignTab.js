import { useCallback, useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../../../store/useStore';
import { isFeatureEnabled } from '../../../config/features';
import { confirm } from '../../../store/useConfirmStore';
import { getEffectiveRules } from '../../../utils/skuRules';
import { pluralize } from '../../../utils/i18n';
import { useFlatsCatalog } from '../catalog/useFlatsCatalog';
import { pickFlat } from '../catalog/pickFlat';
import { garmentHexOf } from '../assets/garmentHex';
import { textileOfItem } from '../../model/garmentTextile';
import { placementOf, remapToFlat } from '../model/layout';
import { useDesignStore } from '../store/useDesignStore';
import { applyCanvasChange } from './canvas/canvasChange';
import { patchPrint } from './panel/printList';
import { MSG_ADD_BLOCKED_MISMATCH, useArtworkActions } from './useArtworkActions';
import { transferToCurrent, useItemFlat } from './useItemFlat';

/**
 * Данные и действия вкладки «Дизайн» (веха 5а, задача 6б) — всё, что
 * `DesignTab` и панель читают о позиции, без разметки.
 *
 * - флэт позиции — `pickFlat` (открытие ничего не пишет, `flat_id` пишет
 *   первое размещение или явный выбор силуэта); холст, панель, превью и PDF
 *   работают с флэтом ВЕРСИИ ПОЗИЦИИ (`useItemFlat`, веха 5б, К15), перенос
 *   на текущую версию — только по кнопке (`transferVersion`);
 * - привязка стора дизайна к позиции — `bind` в эффекте; уход с вкладки —
 *   `reset` ОТЛОЖЕННО: смена позиции перемонтирует вкладку (`ErrorBoundary
 *   key`), и новый монтаж отменяет сброс — картинки заказа не скачиваются
 *   заново, а историю сбрасывает `bind` другой позиции;
 * - все правки — через `useDesignStore.commit` (история undo), функцией от
 *   свежих нанесений позиции.
 */

let pendingReset = null;

/** Сколько нанесений позиции стоит на флэте */
const placedOn = (prints, flat) => prints.filter((p) => placementOf(p, flat)).length;

export function useDesignTab({ order, item, readOnly }) {
  const flats = useFlatsCatalog();
  const cat = useStore(useShallow((s) => ({
    skuCatalog: s.skuCatalog,
    zonesCatalog: s.zonesCatalog,
    categoryRules: s.categoryRules,
    suppliers: s.suppliers,
    fabricsCatalog: s.fabricsCatalog,
    extrasCatalog: s.extrasCatalog,
  })));
  const ds = useDesignStore(useShallow((s) => ({
    view: s.view,
    selectedKey: s.selectedPrintKey,
    undoLabel: s.past.length ? s.past[s.past.length - 1].label : null,
    redoLabel: s.future.length ? s.future[0].label : null,
    top: s.past.length ? s.past[s.past.length - 1] : null,
    display: s.display,
    fabricColor: s.fabricColor,
  })));
  /** «Дизайн» 2.0 (веха 5в, Э2): флаг читается один раз за монтаж вкладки */
  const [studio] = useState(() => isFeatureEnabled('designStudio'));
  /** Шаг истории «Снять с изделия»: «Вернуть» — только пока он верхний (следующей правки не было) */
  const [unplacedAt, setUnplacedAt] = useState(null);

  useEffect(() => {
    if (pendingReset) clearTimeout(pendingReset);
    pendingReset = null;
    return () => {
      pendingReset = setTimeout(() => {
        pendingReset = null;
        useDesignStore.getState().reset();
      }, 0);
    };
  }, []);
  useEffect(() => {
    useDesignStore.getState().bind(order.id, item.key);
  }, [order.id, item.key]);

  const sku = useMemo(() => (cat.skuCatalog ?? []).find((s) => s.code === item.sku_code) ?? null, [cat.skuCatalog, item.sku_code]);
  const pick = useMemo(
    () => pickFlat(item, sku, flats.catalog),
    [item, sku, flats.catalog],
  );
  const zonesCatalog = useMemo(() => cat.zonesCatalog ?? [], [cat.zonesCatalog]);
  const extrasCatalog = useMemo(() => cat.extrasCatalog ?? [], [cat.extrasCatalog]);
  const itemFlat = useItemFlat({ item, current: pick.flat, sku, catalog: flats.catalog, zonesCatalog, extrasCatalog });
  const { flat, views } = itemFlat;
  const rules = useMemo(() => (sku ? getEffectiveRules(sku, cat.categoryRules ?? []) : null), [sku, cat.categoryRules]);
  const category = sku?.category ?? '';
  const ctx = useMemo(() => (flat ? { flat, zonesCatalog, category, areaAllowed: itemFlat.areaAllowed } : null), [flat, zonesCatalog, category, itemFlat.areaAllowed]);
  // «Показать на цвете» (веха 5в, Э2) — только показ; без флага — первая строка сетки
  const shownColor = studio ? ds.fabricColor : null;
  const colorHex = useMemo(() => garmentHexOf(item, cat.suppliers ?? [], null, shownColor), [item, cat.suppliers, shownColor]);
  // Подложка нового логотипа — по цвету изделия: на чёрном не «белое» (обход, H-2)
  const textile = useMemo(
    () => textileOfItem(item, { suppliers: cat.suppliers ?? [], fabricsCatalog: cat.fabricsCatalog ?? [] }),
    [item, cat.suppliers, cat.fabricsCatalog],
  );

  // Вида нет на этом силуэте — первый, что есть (порядок: перед → спина → левый → правый рукав)
  const view = views.includes(ds.view) ? ds.view : (views[0] ?? 'front');
  useEffect(() => {
    if (view !== ds.view) useDesignStore.getState().setView(view);
  }, [view, ds.view]);

  // Силуэт не от модели (B1): новый логотип встал бы на чужой силуэт — сначала перенос
  const addBlocked = !readOnly && pick.modelChanged;
  const target = useMemo(() => (ctx && !readOnly && !addBlocked ? {
    orderId: order.id, itemKey: item.key, flat, view, zonesCatalog, category, rules, areaAllowed: itemFlat.areaAllowed, textile,
  } : null), [ctx, readOnly, addBlocked, order.id, item.key, flat, view, zonesCatalog, category, rules, itemFlat.areaAllowed, textile]);
  const art = useArtworkActions(target, addBlocked ? MSG_ADD_BLOCKED_MISMATCH : '');

  /** Правка нанесений через историю; `fn(prints) → prints | null` */
  const commitPrints = useCallback(
    (label, fn, coalesceKey) => useDesignStore.getState().commit(label, (it) => {
      const prints = fn(it.prints);
      return prints ? { prints } : null;
    }, coalesceKey),
    [],
  );

  /** Раскладка, которую холст не показывает, — прочь: строка снова правится на «Изделии» */
  const releaseLayout = useCallback(
    (key) => commitPrints('Освободить раскладку', (prints) => patchPrint(prints, key, { layout: null })),
    [commitPrints],
  );

  const onCanvasCommit = useCallback((change) => {
    if (!ctx) return;
    const ok = commitPrints(change.label, (prints) => applyCanvasChange(prints, change, ctx), change.coalesceKey);
    if (ok && change.kind === 'unplace') setUnplacedAt(useDesignStore.getState().past.at(-1) ?? null);
  }, [ctx, commitPrints]);

  /** Ctrl+C слоя: строка — в буфер стора, метка «заказ:строка» — в буфер обмена */
  const copyLayer = useCallback((key) => {
    const p = item.prints.find((x) => x.key === key);
    if (!p) return null;
    useDesignStore.getState().setClipboard(p);
    return `${order.id}:${key}`;
  }, [item.prints, order.id]);

  /** Ctrl+D и Ctrl+V слоя — логика в ленивом `copyOps` (вне чанка холста) */
  const layerOp = useCallback((op, arg) => {
    if (ctx) import('./panel/copyOps').then((m) => m.layerOp(op, arg, { orderId: order.id, ctx, blocked: addBlocked, flats: flats.catalog.flats, commitPrints }));
  }, [ctx, order.id, addBlocked, flats.catalog, commitPrints]);

  const [switchNote, setSwitchNote] = useState('');
  /** Сменить силуэт: нанесения на холсте переносятся по зонам; ненайденные — строками */
  const switchFlat = useCallback(async (next) => {
    if (!next || readOnly) return;
    const from = flat;
    const count = from ? placedOn(item.prints, from) : 0;
    if (count > 0) {
      const go = await confirm({
        title: 'Сменить силуэт?',
        message: `На изделии ${count} ${pluralize(count, 'нанесение', 'нанесения', 'нанесений')}. Они перейдут на «${next.name}» по зонам; то, чему зоны не нашлось, останется строкой на вкладке «Изделие».`,
        confirmLabel: 'Сменить силуэт',
        cancelLabel: 'Оставить прежний',
      });
      if (!go) return;
    }
    let dropped = 0;
    useDesignStore.getState().commit('Силуэт', (it) => {
      if (!from) return { flat_id: next.id };
      const res = remapToFlat(it.prints, from, { flat: next, zonesCatalog, category });
      dropped = res.dropped.length;
      return { prints: res.prints, flat_id: next.id };
    });
    setSwitchNote(dropped > 0
      ? `Сняты с холста: ${dropped} — на «${next.name}» нет таких зон, нанесения остались строками`
      : '');
  }, [flat, item.prints, readOnly, zonesCatalog, category]);

  /** «Перенести на версию M»: раскладки прежних версий — на текущую (только черновик, по кнопке) */
  const current = itemFlat.current;
  const transferVersion = useCallback(() => {
    if (!current || readOnly) return;
    let dropped = 0;
    const ok = useDesignStore.getState().commit('Перенос на новую версию силуэта', (it) => {
      const res = transferToCurrent(it.prints, current, { zonesCatalog, category });
      dropped = res?.dropped ?? 0;
      return res ? { prints: res.prints } : null;
    });
    if (ok) {
      setSwitchNote(dropped > 0
        ? `Сняты с холста: ${dropped} — в версии ${current.version} силуэта нет таких зон, нанесения остались строками`
        : `Нанесения перенесены на версию ${current.version} силуэта`);
    }
  }, [current, readOnly, zonesCatalog, category]);

  return {
    studio, display: studio ? ds.display : 'markup', fabricColor: shownColor, suppliers: cat.suppliers,
    flats, sku, pick, flat, ctx, itemFlat, transferVersion, rules, category, colorHex, views, view,
    selectedKey: ds.selectedKey, undoLabel: ds.undoLabel, redoLabel: ds.redoLabel,
    art, commitPrints, releaseLayout, onCanvasCommit, switchFlat, switchNote, addBlocked, layerOp, copyLayer,
    unplaced: unplacedAt !== null && unplacedAt === ds.top,
    clearUnplaced: () => setUnplacedAt(null),
  };
}
