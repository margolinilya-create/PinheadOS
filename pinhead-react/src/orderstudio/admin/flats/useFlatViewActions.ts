/**
 * Действия с видами флэта (веха 5б, задача 6б): заменить SVG, добавить вид,
 * зеркальный рукав (К10), удалить вид. Подтверждения — с последствиями;
 * «Отмена» и Esc возвращают фокус на кнопку, которая открыла подтверждение;
 * после зеркала и удаления фокус — на вкладку нового или соседнего вида.
 */
import { useCallback } from 'react';
import { downloadFlatSvg } from '../../api/garmentFlats';
import { confirm } from '../../../store/useConfirmStore';
import { toast } from '../../../store/useToastStore';
import { parseViewBox } from '../../design/catalog/svgMeta';
import { defaultAreas, type ZoneLike } from '../../design/edit/flatAreas';
import { addView, removeView, setViewFile } from '../../design/edit/flatEdit';
import { mirrorSleeveView, mirrorSvg } from '../../design/edit/mirrorSleeve';
import type { RemovedItem } from '../../design/edit/newFlat';
import type { FlatViewKind, GarmentFlat } from '../../design/types';
import { readSvgFile } from './flatFile';
import {
  mirrorConfirmText, mirrorTarget, neighbourView, removeViewConfirmText, viewOrder, viewTabId,
} from './flatEditorView';

export const MSG_MIRROR_FAILED = 'Зеркальная копия не получилась: у SVG рукава нет viewBox или группы силуэта';

interface Deps {
  draft: GarmentFlat | null;
  base: GarmentFlat | null;
  files: Partial<Record<FlatViewKind, string>>;
  setDraft(fn: (f: GarmentFlat) => GarmentFlat): void;
  setFile(kind: FlatViewKind, svg: string | null): void;
  zones: readonly ZoneLike[] | null;
  accessory: boolean;
  setKind(kind: FlatViewKind): void;
  setRemoved(kind: FlatViewKind, items: RemovedItem[] | null): void;
  focusSoon(...ids: (string | null | undefined)[]): void;
}

export function useFlatViewActions(d: Deps) {
  const { draft, base, files, setDraft, setFile, zones, accessory, setKind, setRemoved, focusSoon } = d;
  const version = base?.version ?? draft?.version ?? 1;

  /** Заменить SVG вида; отказ — текст для поля */
  const replaceFile = useCallback(async (kind: FlatViewKind, file: File): Promise<string | null> => {
    const res = await readSvgFile(file);
    if (!res.ok) return res.error;
    setFile(kind, res.svg);
    setDraft((f) => setViewFile(f, kind, { scale_mm_per_unit: res.scale }));
    setRemoved(kind, res.removed);
    return null;
  }, [setDraft, setFile, setRemoved]);

  /** Добавить вид из файла: зоны по умолчанию (решение 21) */
  const addViewFrom = useCallback(async (kind: FlatViewKind, file: File): Promise<string | null> => {
    const res = await readSvgFile(file);
    if (!res.ok) return res.error;
    const flatMm = { w: res.vb.w * res.scale, h: res.vb.h * res.scale };
    setDraft((f) => addView(f, kind, {
      scale_mm_per_unit: res.scale, flatMm, accessory, areas: defaultAreas(kind, f.garment_type, flatMm, zones),
    }));
    setFile(kind, res.svg);
    setRemoved(kind, res.removed);
    setKind(kind);
    focusSoon(viewTabId(kind));
    return null;
  }, [accessory, focusSoon, setDraft, setFile, setKind, setRemoved, zones]);

  const mirror = useCallback(async (from: 'sleeve_left' | 'sleeve_right', opener: HTMLElement | null) => {
    if (!draft) return;
    const src = draft.views.find((v) => v.kind === from);
    if (!src) return;
    const target = mirrorTarget(from);
    const existing = draft.views.find((v) => v.kind === target);
    if (existing) {
      const ok = await confirm({
        title: 'Заменить рукав?',
        message: mirrorConfirmText(from, existing.print_areas.length, version),
        confirmLabel: 'Заменить',
        cancelLabel: 'Отмена',
      });
      if (!ok) {
        opener?.focus();
        return;
      }
    }
    const text = files[from] ?? await downloadFlatSvg(src.svg_path);
    const mirrored = text ? mirrorSvg(text) : null;
    const vb = text ? parseViewBox(text) : null;
    if (!text) return;
    if (!mirrored || !vb) {
      toast.error(MSG_MIRROR_FAILED);
      return;
    }
    setDraft((f) => mirrorSleeveView(f, from, vb.w * src.scale_mm_per_unit, zones ?? [], { replace: !!existing }));
    setFile(target, mirrored);
    setRemoved(target, null);
    setKind(target);
    focusSoon(viewTabId(target));
  }, [draft, files, focusSoon, setDraft, setFile, setKind, setRemoved, version, zones]);

  const dropView = useCallback(async (kind: FlatViewKind, opener: HTMLElement | null) => {
    if (!draft || draft.views.length <= 1) return;
    const ok = await confirm({
      title: 'Удалить вид?',
      message: removeViewConfirmText(kind, version),
      confirmLabel: 'Удалить вид',
      cancelLabel: 'Отмена',
      variant: 'danger',
    });
    if (!ok) {
      opener?.focus();
      return;
    }
    const next = neighbourView(viewOrder(draft), kind);
    setDraft((f) => removeView(f, kind));
    setFile(kind, null);
    setRemoved(kind, null);
    if (next) {
      setKind(next);
      focusSoon(viewTabId(next));
    }
  }, [draft, focusSoon, setDraft, setFile, setKind, setRemoved, version]);

  return { replaceFile, addViewFrom, mirror, dropView };
}
