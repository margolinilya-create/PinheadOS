/**
 * Типы цепочки «Отправить в работу» (`sendToWork.ts`): шаги, итог и зависимости
 * (подменяются в тестах; по умолчанию — стор заказа, API и движок PDF ТЗ).
 */
import type { SalesOrder } from '../model/types';
import type { SaveState, ServerPatch } from '../store/useSalesStore';
import type { RpcOutcome, TransitionResult } from '../api/salesTransitions';
import type { Digest } from './model/tzHash';
import type { TzCatalogs } from './model/tzDocTypes';
import type { loadTzEngine } from './ui/tzExport';

export type SendStage = 'flush' | 'check' | 'engine' | 'build' | 'upload' | 'save' | 'transition';
export type SendResult = { ok: true } | { ok: false; stage: SendStage; reason: string; conflict?: boolean };

/** Шаг для индикатора: `group`/`total` — у сборки и загрузки */
export interface SendProgress { stage: SendStage; group?: number; total?: number }

export type Engine = Pick<Awaited<ReturnType<typeof loadTzEngine>>, 'buildTzPdf'>;

/** Что цепочке нужно от стора (по умолчанию — `useSalesStore.getState()`) */
export interface SendStore {
  current: SalesOrder | null;
  saveState: SaveState;
  flush: () => Promise<void>;
  beginSend: (id: string) => number | null;
  endSend: () => void;
  editDuringSend: (token: number, fn: (o: SalesOrder) => SalesOrder) => boolean;
  applyServer: (patch: ServerPatch) => void;
}

export interface SendDeps {
  catalogs: TzCatalogs | null;
  digest: Digest | null;
  /** Дата сборки новой версии ТЗ, `YYYY-MM-DD` (решение 21) — передаёт экран */
  today: string;
  appOrigin: string;
  store: () => SendStore;
  api: {
    upload: (orderId: string, blob: Blob, fileName: string) => Promise<string | null>;
    transition: (id: string, expectedUpdatedAt: string | null) => Promise<RpcOutcome<TransitionResult>>;
  };
  engine: () => Promise<Engine>;
  onStage: (p: SendProgress) => void;
}
