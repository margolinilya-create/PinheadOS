/**
 * Буфер позиции рабочего места заказа (веха 3, решение владельца 1).
 *
 * Вкладка «Изделие» — панели визарда (`SkuList`, `FabricGrid`, `ColorPicker`,
 * `SizeTable`, `ExtrasAccordion`). Они читают и пишут общий `useStore`, поэтому
 * стор служит буфером ОДНОЙ позиции:
 *
 * - `loadItemIntoBuffer` кладёт позицию в стор (поля визарда — `salesItemToWizard`);
 * - `bindBuffer` подписывается на поля «Изделия» и каждую их правку переводит
 *   в позицию через `garmentPatch` — только по разнице, поэтому загрузка позиции
 *   и перезагрузка каталогов ничего не пишут;
 * - при смене позиции: отписка → загрузка следующей → новая подписка. Правка
 *   после отписки до прежней позиции не доходит.
 *
 * Позиция с несколькими строками сетки (несколько цветов) в буфер не грузится:
 * `loadItemIntoBuffer` только чистит буфер, экран показывает плашку
 * «Разнести по цветам» (`canLoadIntoBuffer`).
 *
 * При выходе из учётной записи буфер чистится (`registerAppReset`): на общем
 * компьютере следующий пользователь не увидит чужую позицию.
 */
import { shallow } from 'zustand/shallow';
import { useStore, type StoreState } from '../../store/useStore';
import { registerAppReset } from '../../store/appReset';
import { colorSupplierOfFabric } from '../../utils/colorSupplier';
import { garmentPatch, salesItemToWizard } from '../wizard/wizardAdapter';
import type { GarmentSnap, WizardCatalogs } from '../wizard/wizardAdapter';
import type { SalesItem } from '../model/types';
import type { SkuItem } from '../../types/catalog';

/** Поля «Изделия» из стора — то, что буфер переводит в позицию */
export function selectGarment(s: StoreState): GarmentSnap {
  return {
    sku: (s.sku as SkuItem | null) ?? null,
    fabric: (s.fabric as string) ?? '',
    color: (s.color as string) ?? '',
    colorSupplier: (s.colorSupplier as string) ?? '',
    sizes: (s.sizes as GarmentSnap['sizes']) ?? {},
    customSizes: (s.customSizes as GarmentSnap['customSizes']) ?? [],
    extras: (s.extras as string[]) ?? [],
    fit: (s.fit as string) ?? '',
    clientFabric: !!s.clientFabric,
  };
}

/** Позицию можно править буфером: в сетке не больше одной строки (один цвет) */
export function canLoadIntoBuffer(item: SalesItem): boolean {
  return item.size_grid.rows.length <= 1;
}

/**
 * Положить позицию в буфер. Фильтр моделей (`skuFilter`) остаётся как был.
 * Позиция с несколькими цветами не грузится — буфер остаётся пустым.
 */
export function loadItemIntoBuffer(item: SalesItem, cat: WizardCatalogs): void {
  const store = useStore.getState();
  store.resetItemFields();
  if (!canLoadIntoBuffer(item)) return;
  const { sku, ...fields } = salesItemToWizard(item, cat);
  // Тип, крой и умолчания модели ставит штатный выбор модели визарда
  if (sku) store.selectSku(sku as SkuItem);
  useStore.setState({
    ...fields,
    clientFabric: item.client_fabric,
    // Палитра — id поставщика ткани из справочника; ткани нет в каталоге — ''
    // (`ColorPicker` покажет палитру по умолчанию)
    colorSupplier: colorSupplierOfFabric(item.fabric_code, cat.fabricsCatalog, cat.suppliers),
  });
}

/**
 * Подписать буфер на позицию. `getBase` — текущая позиция из заказа (свежая
 * на каждую правку: вторая правка накладывается на результат первой);
 * позиция пропала — ничего не пишется. Возвращает отписку.
 */
export function bindBuffer(
  getBase: () => SalesItem | undefined,
  cat: WizardCatalogs,
  onItem: (next: SalesItem) => void,
): () => void {
  return useStore.subscribe(selectGarment, (next, prev) => {
    const base = getBase();
    if (!base) return;
    const out = garmentPatch(prev, next, base, cat);
    if (out) onItem(out);
  }, { equalityFn: shallow });
}

registerAppReset(() => useStore.getState().resetItemFields());
