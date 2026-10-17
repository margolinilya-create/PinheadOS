import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../../store/useStore';
import SkuList from '../../components/steps/garment/SkuList';
import FabricGrid from '../../components/steps/garment/FabricGrid';
import ColorPicker from '../../components/steps/garment/ColorPicker';
import SizeTable from '../../components/steps/garment/SizeTable';
import ExtrasAccordion from '../../components/steps/garment/ExtrasAccordion';
import styles from './Workplace.module.css';

/**
 * «Изделие» позиции на панелях визарда (решение владельца 17.10, п. 1):
 * модель, ткань, цвет, размеры, обработки. Панели читают и пишут буфер
 * позиции (`useStore`); в заказ правку переводит `bindBuffer` (`ItemTab`).
 *
 * Перетаскивание моделей выключено (оно пишет порядок в общий каталог моделей),
 * цена в таблице размеров скрыта: цена позиции одна — из `priceOrder`.
 *
 * «Ткань клиента» — поле позиции, у визарда его нет: флажок пишет позицию
 * сам (`onClientFabric`), а выбор ткани прячется — её цена в заказ не входит.
 */
export default function GarmentPanel({ clientFabric, onClientFabric, readOnly }) {
  const { sku, extras, extrasCatalog, toggleExtra } = useStore(useShallow((s) => ({
    sku: s.sku,
    extras: s.extras,
    extrasCatalog: s.extrasCatalog,
    toggleExtra: s.toggleExtra,
  })));

  return (
    <div className={styles.garment}>
      <SkuList readOnly={readOnly} reorderable={false} />
      <label className={styles.checkRow}>
        <input
          type="checkbox"
          checked={clientFabric}
          disabled={readOnly}
          onChange={(e) => onClientFabric(e.target.checked)}
        />
        Ткань клиента (в цену не входит)
      </label>
      {!clientFabric && <FabricGrid readOnly={readOnly} />}
      <ColorPicker readOnly={readOnly} />
      <SizeTable readOnly={readOnly} showPrice={false} />
      {sku && (
        <ExtrasAccordion
          sku={sku}
          extras={extras}
          extrasCatalog={extrasCatalog}
          toggleExtra={toggleExtra}
          readOnly={readOnly}
        />
      )}
    </div>
  );
}
