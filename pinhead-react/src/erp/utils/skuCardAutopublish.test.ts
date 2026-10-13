import { describe, expect, it } from 'vitest';
import { latestDefining, withoutComments } from './migrations.testutil';

/**
 * АВТОПУБЛИКАЦИЯ КАРТОЧКИ МОДЕЛИ — серверная половина, у которой на клиенте
 * НЕТ НИ ОДНОЙ ТОЧКИ ВЫЗОВА. Это и есть причина сторожа: интерфейс её
 * не трогает, тесты слайсов не видят, а сломаться она может молча —
 * разработка завершится, карточка не заведётся, и заметит это менеджер
 * повторного заказа через месяц.
 *
 * Определение берётся ПОСЛЕДНЕЙ миграцией, определяющей функцию: функции
 * пересоздаются целиком, и привязка к файлу сторожила бы файл, а не базу.
 *
 * Поведение проверено на ЖИВОЙ базе (15.09, транзакции с откатом):
 *   · правка `final_package` карточки не заводит — «сама галочка не публикует»;
 *   · переход в «Готово к серии» заводит черновик с двумя файлами техпакета;
 *   · повторное завершение дубля не даёт;
 *   · выключенный переключатель карточки не заводит;
 *   · со СНЯТОЙ у технолога галочкой `sku.edit` завершение всё равно проходит
 *     и карточка заводится — ради этого функция и `definer`.
 * Здесь сторожится то, что от этих свойств зависит в тексте функции.
 */

const SQL = withoutComments(latestDefining('erp_dev_sku_card_on_ready'));

describe('автопубликация карточки модели из разработки', () => {
  it('срабатывает ТОЛЬКО на переходе исхода, а не на правке пакета', () => {
    /**
     * Требование документа «сама галочка не публикует» выполняется
     * по построению: без сравнения со СТАРЫМ значением триггер будила бы
     * любая правка разработки, и карточка появлялась бы до завершения.
     */
    expect(SQL).toMatch(/new\.outcome is distinct from 'ready_for_serial'/);
    expect(SQL).toMatch(/old\.outcome is not distinct from new\.outcome/);
  });

  it('читает переключатель «Добавить модель в каталог SKU»', () => {
    // Тот же `erp_pkg_flag`, что у гейта полноты пакета: второе выражение
    // того же вопроса разошлось бы с первым
    expect(SQL).toMatch(/erp_pkg_flag\(\s*v_pkg,\s*'add_to_sku'\s*\)/);
  });

  it('карточка рождается ЧЕРНОВИКОМ, а не выпущенной', () => {
    /**
     * В прайс-каталог визарда пакет уйти не может: в нём нет ни кода,
     * ни категории, ни цены пошива, а артикул с нулевой ценой ломает
     * расчёт заказа молча.
     */
    expect(SQL).toMatch(/'draft'/);
    expect(SQL).not.toMatch(/erp_sku_catalog_upsert/);
  });

  it('повтор ищет прежнюю карточку, а не падает 23505 в чужой транзакции', () => {
    expect(SQL).toMatch(/select id into v_card[\s\S]{0,120}experimental_id = new\.id/);
    expect(SQL).toMatch(/if v_card is not null then[\s\S]{0,40}return null/);
  });

  it('файлы техпакета переносятся ССЫЛКОЙ и со снимком пути', () => {
    // `attachment_id` объявлен `on delete set null` — удалённая разработка
    // не имеет права унести с собой техпаспорт модели
    expect(SQL).toMatch(/insert into public\.erp_sku_card_files/);
    expect(SQL).toMatch(/dev_pattern[\s\S]{0,40}'pattern'/);
    expect(SQL).toMatch(/dev_passport[\s\S]{0,40}'passport'/);
    expect(SQL).toMatch(/dev_photo[\s\S]{0,40}'photo'/);
    expect(SQL).toMatch(/a\.file_path,\s*a\.file_name/);
  });

  it('это AFTER-триггер на erp_experimental', () => {
    expect(SQL).toMatch(/after update on public\.erp_experimental/);
  });

  /**
   * `security definer` — не удобство, а условие: вставку в `erp_sku_cards`
   * политика пускает под `sku.edit`, а завершает разработку технолог.
   * Право снимается галочкой в админке, и с `invoker` снятая галочка роняла
   * бы цеху САМО ЗАВЕРШЕНИЕ 42501-й ошибкой внутри чужой транзакции.
   */
  it('definer и закрыт для REST', () => {
    expect(SQL).toMatch(/security definer/);
    expect(SQL).toMatch(/revoke execute on function public\.erp_dev_sku_card_on_ready\(\)\s+from public, anon, authenticated/);
  });

  /**
   * БЭКФИЛЛ. Триггер ловит переход, а разработка, завершённая ДО его
   * появления, его не переживёт: событие больше не наступит, и карточки
   * такая модель не получила бы НИКОГДА.
   *
   * На бою 15.09 он заполнил НОЛЬ строк — план исходил из обратного, живая
   * база поправила. Отсутствие строк не делает бэкфилл лишним: без него
   * карточки лишилась бы первая же разработка, завершённая между выкладкой
   * миграции и фронтенда.
   */
  it('бэкфилл есть и идемпотентен', () => {
    expect(SQL).toMatch(/where e\.outcome = 'ready_for_serial'/);
    expect(SQL).toMatch(/not exists \(select 1 from public\.erp_sku_cards c where c\.experimental_id = e\.id\)/);
    expect(SQL).toMatch(/on conflict \(code\) do nothing/);
  });
});
