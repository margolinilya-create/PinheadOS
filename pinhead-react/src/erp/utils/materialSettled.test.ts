import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { functionBody, latestDefining, withoutComments, withoutJsComments } from './migrations.testutil';

/**
 * ОДНО ПРАВИЛО «МАТЕРИАЛ НА МЕСТЕ» — И НА КЛИЕНТЕ, И НА СЕРВЕРЕ.
 *
 * Правило существовало в двух копиях, и это не теория: гейт ЗАПУСКА цеха
 * (`routes.isMaterialPending`) с 22.07 спрашивает вердикт приёмки, а гейт
 * ЗАВЕРШЕНИЯ этапа (`supply.isMaterialSettled` + серверное зеркало
 * `erp_stage_completion_block`) спрашивал одну колонку `status`. Приёмка
 * (`erp_material_accept`) ставит `received` при ЛЮБОМ исходе — включая
 * недостачу, пересорт и прямой отказ.
 *
 * На боевой базе 04.09: шесть позиций `received` без годной приёмки (в их
 * числе «Кулирка 100хб 250гр», принятая с недостачей 40 из 42), у всех шести
 * закупка закрыта автозакрытием, а на заказе 60448 закрой закрыт целиком
 * (75/75, 50/50, 75/75) при трёх непринятых позициях. То есть этап, который
 * цех не смог бы ВЗЯТЬ в работу, он смог ЗАКРЫТЬ.
 *
 * Поведение обеих функций проверяют `supply.test.ts` и `routes.test.ts`.
 * Здесь сторожатся две вещи, которых поведением не поймать:
 *   · клиент не завёл вторую формулу заново (её легко «вернуть как было»);
 *   · серверное зеркало умеет то же самое (клиентский гейт без серверного —
 *     дыра через REST, правило проекта).
 */

const SRC = (rel: string) => readFileSync(join(process.cwd(), 'src/erp', rel), 'utf8');

describe('«материал на месте» — одна формула', () => {
  it('клиент выводит `isMaterialSettled` из гейта запуска, а не считает сам', () => {
    const supply = withoutJsComments(SRC('utils/supply.ts'));
    expect(supply).toMatch(/isMaterialSettled[^)]*\)[^{]*\{\s*return !isMaterialPending\(m\);/);
    /**
     * Прежняя формула — перечисление трёх статусов подряд. Ищется именно она,
     * а не слово `received`: оно законно стоит в `arrived` и `inTransit`,
     * которые отвечают на другой вопрос («сколько пришло»), а не на «годен ли».
     */
    expect(supply).not.toMatch(
      /'received'\s*\|\|[^;]*'reserved'\s*\|\|[^;]*'not_needed'/);
  });

  it('серверное зеркало спрашивает вердикт приёмки, а не только статус', () => {
    const sql = withoutComments(
      functionBody(latestDefining('erp_stage_completion_block'), 'erp_stage_completion_block'));
    // «Со склада» и «не требуется» годны без приёмки — они и остаются в списке
    expect(sql).toMatch(/not in \('reserved', 'not_needed'\)/);
    // Пришедшее закупочное — только после приёмки
    expect(sql).toMatch(/accept_status[\s\S]*?not in \('accepted_full', 'accepted_partial'\)/);
    // Прежнее условие по одной колонке снято целиком
    expect(sql).not.toMatch(/not in \('received', 'reserved', 'not_needed'\)/);
  });

  /**
   * Слова отказа обязаны совпадать: человек читает один список — и в кнопке,
   * и в ответе сервера. «Придут ИЛИ будут взяты со склада» описывало половину
   * условия, и тому, у кого материал ПРИШЁЛ, читалось как ошибка системы.
   */
  it('сервер и клиент отказывают одними словами', () => {
    const tail = 'Этап можно закрыть, когда материалы придут и склад их примет.';
    expect(withoutJsComments(SRC('utils/stageDone.ts'))).toContain(tail);
    expect(latestDefining('erp_stage_completion_block')).toContain(tail);
  });
});

/**
 * ТА ЖЕ ФОРМУЛА — И НА ЭКРАНЕ, А НЕ ТОЛЬКО В ГЕЙТЕ.
 *
 * Гейт свели к одной функции 04.09, а поверхности остались при своих: пять
 * экранов печатали `MATERIAL_STATUS_LABELS[m.status]` голым и говорили «Пришло»
 * про материал, который держит цех (на проде — пять строк из сорока четырёх),
 * а карточка заказа и блок ТЗ ещё и считали «ждём ли материал» ТРЕТЬЕЙ
 * формулой («не received и не not_needed»). Она расходится с гейтом в обе
 * стороны: `reserved` красился «в пути», а пришедший без приёмки — «готов».
 *
 * Сторожится не текст подписи, а ИСТОЧНИК: подпись берётся у `materialStateText`
 * (она одна зовёт `materialAcceptanceIssue`), годность — у `isMaterialPending`.
 */
describe('состояние материала на экранах берётся из одного источника', () => {
  /** Экраны, законно печатающие сырую подпись, — с причиной у каждого */
  const RAW_LABEL_OK: Record<string, string> = {
    'screens/admin/DictionariesTab.jsx': 'витрина самого словаря: показывает все значения списком',
    'screens/orderCard/HistorySection.jsx': 'перевод значений аудита: там статус — это записанное прошлое',
    'screens/purchasing/PurchaseFields.jsx': 'свой рендер: чип + иконка + комментарий кладовщика, формула та же',
    'screens/FabricPurchasing.jsx': 'ключ сортировки колонки: берётся ровно то, что видно в чипе ячейки',
  };

  /**
   * «Ждёт приёмки» — ДРУГОЙ вопрос, а не копия «годен ли в производство».
   * Заказанный материал производство держит, но складу с ним делать нечего:
   * он ещё не приехал. Поэтому у карточки склада своя формула, и это
   * не расхождение.
   */
  const OWN_QUESTION_OK: Record<string, string> = {
    'screens/warehouse/MaterialReceiptCard.jsx': '`awaitsAcceptance` — есть ли работа У СКЛАДА, а не блокирует ли материал цех',
  };

  function screensUsing(needle: string): string[] {
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(join(process.cwd(), 'src/erp', dir), { withFileTypes: true })) {
        const rel = `${dir}/${e.name}`;
        if (e.isDirectory()) walk(rel);
        else if (/\.(jsx|tsx)$/.test(e.name) && withoutJsComments(SRC(rel)).includes(needle)) out.push(rel);
      }
    };
    walk('screens');
    return out;
  }

  it('сырую подпись статуса печатают только названные экраны', () => {
    const raw = screensUsing('MATERIAL_STATUS_LABELS[')
      .filter((f) => !(f in RAW_LABEL_OK));
    expect(raw, `подпись мимо materialStateText: ${raw.join(', ')}`).toEqual([]);
  });

  it('«ждём ли материал» нигде не считается заново', () => {
    const hand = screensUsing("m.status !== 'received'")
      .filter((f) => !(f in OWN_QUESTION_OK));
    expect(hand, `своя формула годности материала: ${hand.join(', ')}`).toEqual([]);
  });

  it('подпись собирает ровно одна функция, и она спрашивает вердикт склада', () => {
    const supply = withoutJsComments(SRC('utils/supply.ts'));
    expect(supply).toMatch(/function materialStateText\([\s\S]*?materialAcceptanceIssue\(m\)/);
  });
});

