import { useStore } from '../../store/useStore';
import { calcTotal } from '../../utils/pricing';

export default function Header() {
  const state = useStore();
  const total = calcTotal(state);
  const formatted = total > 0 ? total.toLocaleString('ru-RU') + ' ₽' : '— ₽';

  return (
    <header className="header">
      <div className="header-left">
        <span className="header-logo">✳</span>
        <span className="header-brand">pinhead</span>
        <span className="header-title">Order Studio</span>
        <span className="header-version">v2.0</span>
      </div>
      <div className="header-right">
        <div className="header-total">{formatted}</div>
      </div>
    </header>
  );
}
