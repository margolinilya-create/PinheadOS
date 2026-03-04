import './App.css'
import {
  PRICES, SKU_CATALOG_DEFAULT, SKU_CATEGORIES,
  FABRICS_CATALOG_DEFAULT, MEDASTEX_COLORS, COTTONPROM_COLORS,
  EXTRAS_CATALOG_DEFAULT, LABELS_CATALOG_DEFAULT, LABEL_CONFIG,
  SIZES, TYPE_NAMES, TECH_NAMES, ZONE_LABELS
} from './data'

function App() {
  return (
    <div className="app">
      <header className="app-header">
        Pinhead Order Studio
        <span>v2.0 React</span>
      </header>
      <main className="app-main">
        <p className="placeholder-message">
          Данные загружены:<br />
          SKU: {SKU_CATALOG_DEFAULT.length} изделий · {SKU_CATEGORIES.length} категорий<br />
          Ткани: {FABRICS_CATALOG_DEFAULT.length} · Цвета: {MEDASTEX_COLORS.length} + {COTTONPROM_COLORS.length}<br />
          Обработки: {EXTRAS_CATALOG_DEFAULT.length} · Лейблы: {LABELS_CATALOG_DEFAULT.length}<br />
          Типы: {Object.keys(TYPE_NAMES).length} · Техники: {Object.keys(TECH_NAMES).length}<br />
          Размеры: {SIZES.join(', ')}<br />
          Зоны: {Object.keys(ZONE_LABELS).length} · Бирки: {Object.keys(LABEL_CONFIG).length} типа<br />
          Форматов печати: {PRICES.screenFormats.length}
        </p>
      </main>
    </div>
  )
}

export default App
