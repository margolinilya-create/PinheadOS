/**
 * Эталонная сцена PDF макета 5а (веха 6+7, задача 3): шапка с пометками,
 * два нанесения, легенда. Её sha-256 закреплён в `buildSceneSvg.test.ts`
 * ДО добавления `outputScale` — лист макета по умолчанию побайтно прежний.
 */
import { buildSceneSvg, type SceneInput } from './buildSceneSvg';
import { frontView } from '../fixtures.testutil';
import type { Placement } from '../types';

export const GOLDEN_FLAT = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 760" width="600" height="760"><path id="garment" fill="#fff" d="M0 0H600V760H0Z"/></svg>';

export function goldenPlacement(key: string, y: number): Placement {
  return {
    print_key: key, view: 'front', area_id: 'chest', x_mm: 250, y_mm: y, width_mm: 100, height_mm: 80,
    rotation_deg: 0, flip_h: false, flip_v: false, method: 'dtf', artwork_path: '', stale: false,
    asset: { type: 'png', source_file: 'a.png', intrinsic_w_mm: 100, intrinsic_h_mm: 80, size_estimated: false, has_preview: false },
  };
}

export function goldenInput(): SceneInput {
  return {
    view: frontView(),
    flatMarkup: GOLDEN_FLAT,
    flatMm: { w: 600, h: 760 },
    garmentColor: '#1f2937',
    placements: [goldenPlacement('a', 167), goldenPlacement('b', 300)],
    images: { a: 'data:image/png;base64,AAAA' },
    meta: { client: 'К', orderNumber: 'PH-1', itemTitle: 'Футболка', size: 'M', date: '18.10.2026', statusLabel: 'Расчёт', typicalFlat: true, notes: ['логотип 1 — растр'] },
    legend: [{ printKey: 'a', n: 1, text: 'Грудь — DTF' }, { printKey: 'b', n: 2, text: 'Грудь 2' }],
  };
}

export function goldenScene(patch: Partial<SceneInput> = {}): string {
  return buildSceneSvg({ ...goldenInput(), ...patch });
}
