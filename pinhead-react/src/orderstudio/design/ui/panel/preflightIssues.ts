/**
 * Замечания проверки макета для экрана — одна сборка для панели и полосы под
 * холстом (веха 5в, Э2). Нет нанесений и силуэт свой — замечаний нет («нет
 * нанесений» нужен только PDF макета).
 */
import { allowedMethods, printMethodProfile, type MethodRules } from '../../../model/printMethods';
import { MSG_NO_PRINTS, preflight, type PreflightIssue } from '../../export/preflight';
import type { GarmentFlat, Placement } from '../../types';

/** Подписи уровней замечаний — одни у панели и полосы под холстом */
export const LEVEL_LABELS = { serious: 'Серьёзно', warn: 'Внимание', info: 'Подсказка' } as const;

export function preflightIssues(
  flat: GarmentFlat,
  placements: Placement[],
  rules: MethodRules | null,
  modelMismatch: boolean,
): PreflightIssue[] {
  if (placements.length === 0 && !modelMismatch) return [];
  return preflight({
    flat,
    placements,
    profileOf: printMethodProfile,
    methodAllowed: (area, method) => allowedMethods(area, rules).includes(method),
    modelMismatch,
  }).filter((i) => placements.length > 0 || i.message !== MSG_NO_PRINTS);
}
