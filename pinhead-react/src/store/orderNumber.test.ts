import { describe, it, expect } from 'vitest';
import {
  functionBody, latestDefining, latestMatching, withoutComments,
} from '../erp/utils/migrations.testutil';

/**
 * НОМЕР ЗАКАЗА ORDER STUDIO (сессия 68, решение владельца).
 *
 * `useOrdersStore.generateOrderNumber` зовёт RPC `generate_order_number`,
 * которой до 24.09 не было вовсе: запасной путь молча раздавал
 * `PH-<миллисекунды>-xxxx`. Функцию завела миграция
 * `20260924222445_order_studio_generate_order_number`, и сторожится здесь
 * не её присутствие (это делает `erp/utils/schemaNames.test.ts`), а три
 * свойства, каждое из которых ломается тихо:
 *
 *   1. ОДНА последовательность. Номер раздают два пути — RPC и умолчание
 *      колонки `orders.order_number`. Две последовательности выдали бы
 *      одинаковые `PH-0019` двум заказам.
 *   2. Номер НЕ ОБРЕЗАЕТСЯ после 9999. `lpad(x, 4, '0')` режет строку
 *      длиннее четырёх знаков: 10000-й заказ получил бы `PH-1000`, а 12345-й
 *      и 123456-й — оба `PH-1234`. Так было в умолчании колонки.
 *   3. ОДИН формат. Умолчание колонки зовёт функцию, а не держит вторую
 *      копию выражения — две копии уже разошлись однажды (обрезка выше).
 */

const SQL = withoutComments(latestDefining('generate_order_number'));
const BODY = functionBody(SQL, 'generate_order_number');

describe('номер заказа Order Studio', () => {
  it('функция берёт номер из последовательности базовой схемы', () => {
    const baseline = withoutComments(latestMatching(
      /create sequence if not exists order_number_seq/,
      'последовательность order_number_seq',
    ));
    expect(baseline).toMatch(/create sequence if not exists order_number_seq/);
    expect(BODY).toMatch(/nextval\('public\.order_number_seq'\)/);
    // Никакой второй последовательности под номер заказа
    expect(BODY.match(/nextval\(/g) ?? []).toHaveLength(1);
  });

  it('ширина номера растёт с числом — lpad не режет пятизначные', () => {
    expect(BODY).toMatch(/lpad\(s\.n::text, greatest\(4, length\(s\.n::text\)\), '0'\)/);
    expect(BODY).toMatch(/'PH-' \|\|/);
  });

  it('умолчание колонки зовёт функцию, а не держит свою копию формата', () => {
    const def = withoutComments(latestMatching(
      /alter column order_number set default/,
      'умолчание orders.order_number',
    ));
    expect(def).toMatch(/alter column order_number set default public\.generate_order_number\(\)/);
  });

  it('вызывают вошедшие и service_role, но не anon', () => {
    // Отзыв у одного anon не работает: право на исполнение приходит от PUBLIC
    expect(SQL).toMatch(/revoke execute on function public\.generate_order_number\(\) from public, anon/);
    expect(SQL).toMatch(/grant execute on function public\.generate_order_number\(\) to authenticated, service_role/);
  });

  it('повышать права функции нечего — security invoker', () => {
    expect(SQL).toMatch(/security invoker/);
    expect(SQL).not.toMatch(/security definer/);
  });
});
