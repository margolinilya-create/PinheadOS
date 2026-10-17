/**
 * Переход в раздел «Производство» для профиля без доступа к заказам v4.
 *
 * Флаг `orderStudio` гасится в localStorage и страница грузится заново с `/`:
 * выбор оболочки в `App.jsx` читает флаг один раз за загрузку, а адрес без
 * `?studio=1` не включит раздел обратно — петли нет. Отдельным модулем, чтобы
 * тест мог подменить навигацию (в jsdom её нет).
 */
import { setFeature } from '../config/features';

export function switchToProduction(): void {
  setFeature('orderStudio', false);
  window.location.replace('/');
}
