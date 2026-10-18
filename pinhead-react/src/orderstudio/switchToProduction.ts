/**
 * Переход в раздел «Производство» для профиля без доступа к заказам v4 —
 * и по ссылке «Открыть в производстве» после запуска (веха 6+7, `path`).
 *
 * Флаг `orderStudio` гасится в localStorage и страница грузится заново
 * (по умолчанию с `/`): выбор оболочки в `App.jsx` читает флаг один раз за
 * загрузку, а адрес без `?studio=1` не включит раздел обратно — петли нет.
 * Отдельным модулем, чтобы тест мог подменить навигацию (в jsdom её нет).
 * Путь — только внутренний (`/…`, не `//…`): чужой адрес сюда не пройдёт.
 */
import { setFeature } from '../config/features';

export function switchToProduction(path = '/'): void {
  setFeature('orderStudio', false);
  window.location.replace(path.startsWith('/') && !path.startsWith('//') ? path : '/');
}
