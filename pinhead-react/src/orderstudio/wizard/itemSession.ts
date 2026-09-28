/**
 * Сессия позиции: шаги визарда Order Studio внутри карточки «Заказы v4».
 *
 * `StepGarment` и `StepDesign` читают и пишут общий `useStore` — тот же,
 * где живёт недоделанный заказ главного визарда на `/`. Сессия снимает его
 * состояние в память, ставит на паузу автосохранение черновика и кладёт
 * в стор поля позиции. На выходе (готово, отмена, уход со страницы) всё
 * возвращается как было, и черновик главного визарда не задет.
 */
import { useStore } from '../../store/useStore';
import { DRAFT_FIELDS, setDraftPaused } from '../../hooks/useDraft';
import { defaultItemFields } from '../../store/slices/helpers';
import type { SkuItem } from '../../types/catalog';
import type { WizardItem } from './wizardAdapter';

/** Сверх полей черновика: навигация и связь с сохранённым заказом визарда */
const EXTRA_FIELDS = ['maxStep', 'saved', '_editingOrderId', '_editingOrderNumber', 'artworkPath'];

const copy = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

let stash: Record<string, unknown> | null = null;

export function isItemSessionActive(): boolean {
  return stash !== null;
}

/**
 * Начать сессию. `fields` — поля позиции для «Изменить в визарде»
 * (`salesItemToWizard`); без них — пустая позиция.
 */
export function beginItemSession(fields?: WizardItem): void {
  if (stash) endItemSession();
  const state = useStore.getState() as unknown as Record<string, unknown>;
  const snap: Record<string, unknown> = {};
  for (const k of [...DRAFT_FIELDS, ...EXTRA_FIELDS]) {
    if (k in state) snap[k] = copy(state[k]);
  }
  stash = snap;
  setDraftPaused(true);

  useStore.setState({
    ...copy(defaultItemFields),
    items: [],
    activeItemIdx: -1,
    step: 0,
    maxStep: fields ? 1 : 0,
    artworkPath: '',
  } as never);

  if (!fields) return;
  const { sku, ...rest } = fields;
  // Тип, крой и умолчания модели ставит штатный выбор модели визарда
  if (sku) (useStore.getState() as unknown as { selectSku: (s: SkuItem) => void }).selectSku(sku as SkuItem);
  useStore.setState(copy(rest) as never);
}

/** Вернуть главный визард как был и снять паузу черновика */
export function endItemSession(): void {
  if (!stash) return;
  const back = stash;
  stash = null;
  // Сначала снять паузу, потом вернуть состояние: подписка черновика срабатывает
  // синхронно на setState, и на паузе возврат главного визарда до черновика
  // не дошёл бы (поймано тестом itemSession.test.jsx)
  setDraftPaused(false);
  useStore.setState(back as never);
}
