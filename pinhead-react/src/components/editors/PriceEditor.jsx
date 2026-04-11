import PricingTabContent from './sku/PricingTabContent';

/**
 * Standalone PriceEditor — thin wrapper around PricingTabContent.
 * Kept for backward compatibility; /prices route redirects to /sku?tab=pricing.
 */
export default function PriceEditor() {
  return (
    <div className="sku-ed-overlay">
      <div className="sku-ed-panel">
        <div className="pe-actions-bar">
          <span className="pe-actions-title">Редактор цен</span>
        </div>
        <div className="pe-content">
          <PricingTabContent />
        </div>
      </div>
    </div>
  );
}
