import { useState } from 'react';
import { useStore } from '../../store/useStore';
import { useShallow } from 'zustand/react/shallow';
import { isAccessory, getTotalQty } from '../../utils/pricing';
import SkuList from './garment/SkuList';
import FabricGrid from './garment/FabricGrid';
import ColorPicker from './garment/ColorPicker';
import SizeTable from './garment/SizeTable';
import ExtrasAccordion from './garment/ExtrasAccordion';

export default function StepGarment() {
  const { nextStep, type, color, fabric, sku, extras, extrasCatalog, toggleExtra } = useStore(
    useShallow(s => ({ nextStep: s.nextStep, type: s.type, color: s.color, fabric: s.fabric, sku: s.sku,
      extras: s.extras, extrasCatalog: s.extrasCatalog, toggleExtra: s.toggleExtra }))
  );
  const totalQty = useStore(s => getTotalQty(s));
  const [validationMsg, setValidationMsg] = useState('');
  const isAcc = isAccessory(type);
  const canNext = sku && type && totalQty > 0 && (isAcc || color);
  const showFabric = !!sku && !isAcc;
  const showColor = !!sku && !isAcc && !!fabric;
  const showSizes = !!sku && (isAcc || !!color);

  const handleNext = () => {
    if (canNext) {
      setValidationMsg('');
      nextStep();
      return;
    }
    const missing = [];
    if (!sku) missing.push('артикул');
    if (!isAcc && !fabric) missing.push('ткань');
    if (!isAcc && !color) missing.push('цвет');
    if (totalQty <= 0) missing.push('количество (размеры)');
    setValidationMsg('Заполните: ' + missing.join(', '));
  };

  return (
    <div className="step-panel">
      <div className="step-header">
        <div className="step-header-label">// 01 — Изделие</div>
        <h1 className="step-header-title">ИЗДЕЛИЕ</h1>
        <p className="step-header-desc">Выберите изделие, ткань и цвет</p>
      </div>
      <SkuList />
      {showFabric && <FabricGrid />}
      {showColor && <ColorPicker />}
      {showSizes && <SizeTable />}
      {sku && (
        <ExtrasAccordion
          sku={sku}
          extras={extras}
          extrasCatalog={extrasCatalog}
          toggleExtra={toggleExtra}
        />
      )}

      {validationMsg && (
        <div className="validation-warning">
          {validationMsg}
        </div>
      )}
      <div className="btn-row">
        <button
          className={`btn-next${canNext ? '' : ' disabled'}`}
          disabled={!sku}
          title={!sku ? 'Выберите артикул' : ''}
          onClick={handleNext}
        >
          Далее
        </button>
      </div>
    </div>
  );
}
