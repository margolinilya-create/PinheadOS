import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { latestDefining, withoutComments } from './migrations.testutil';

/**
 * Сторож двух писателей карточки подрядчика.
 *
 * ЗАЧЕМ. Строку `erp_subcontracting` при подрядном этапе заводят РОВНО ДВА
 * места — `erp_create_order` (заказ создан) и `erp_route_apply` (маршрут
 * поправлен). Так сделано осознанно: связь `stage_id` не писал НИКТО, и
 * из-за этого раздел «Подряд» был тупиком, из которого заказ дальше не шёл.
 *
 * Цена такой симметрии — она обязана держаться. Поле, добавленное в одну
 * функцию и забытое во второй, даёт дефект, который не падает: половина
 * заполненного пропадает молча, и какая именно — зависит от того, создали
 * заказ или отредактировали. Тест сверяет обе функции по ПОСЛЕДНИМ
 * миграциям, которые их определяют (правило `latestDefining`: функции
 * пересоздаются целиком, и старая миграция остаётся со старыми правилами).
 *
 * Третьим сверяется КЛИЕНТ: `stepPayload` — единственное место, где шаг
 * черновика превращается в поля сервера, и оба вызывающих (форма создания
 * и правка маршрута) обязаны идти через него.
 */

const CREATE_ORDER = withoutComments(latestDefining('erp_create_order'));
const ROUTE_APPLY = withoutComments(latestDefining('erp_route_apply'));
const STEP_PAYLOAD = readFileSync(
  join(process.cwd(), 'src/erp/utils/routeDraft.ts'), 'utf8',
);

/** Поля карточки подрядчика, которые заполняются В МАРШРУТЕ (документ 20.08) */
const COMPANION_FIELDS = [
  'operation', 'contractor', 'qty', 'material_source',
  'send_plan_date', 'planned_date', 'responsible', 'materials_note', 'comment',
];

describe('карточка подрядчика: два писателя и один payload', () => {
  it.each(COMPANION_FIELDS)('поле %s принимает erp_create_order', (field) => {
    expect(CREATE_ORDER).toContain(field);
  });

  it.each(COMPANION_FIELDS)('поле %s принимает erp_route_apply', (field) => {
    expect(ROUTE_APPLY).toContain(field);
  });

  it.each(COMPANION_FIELDS.filter((f) => f !== 'material_source'))(
    'поле %s отдаёт stepPayload на клиенте', (field) => {
      // `material_source` — исключение: его выбирает форма позиции, а не шаг
      // маршрута, и в payload шага его нет вовсе
      expect(STEP_PAYLOAD).toContain(field);
    },
  );

  it('оба писателя берут количество ИЗ ШАГА, а не только из тиража', () => {
    // Документ требует частичных партий: «первые 200 из 500 уходят на варку».
    // Подстановка всего тиража делала бы плановое число неправдой ещё
    // до первой передачи
    expect(CREATE_ORDER).toContain("(v_stage->>'qty')::int");
    expect(ROUTE_APPLY).toContain("(st.step->>'qty')::int");
  });

  it('erp_create_order по-прежнему пишет связь заказа с ТЗ', () => {
    /**
     * Не косметика. Действующая функция получила `tz_order_id`/`tz_number`
     * миграцией 18.08, которой НЕ БЫЛО в репозитории: пересоздание по
     * репозиторному тексту молча выбросило бы связь, и заказы, созданные
     * из ТЗ, перестали бы к нему привязываться. Проверка стоит здесь,
     * чтобы следующее пересоздание не повторило это.
     */
    expect(CREATE_ORDER).toContain('tz_order_id');
    expect(CREATE_ORDER).toContain('tz_number');
  });

  /**
   * ПРИНИМАТЬ — НЕ ЗНАЧИТ ЗАПИСАТЬ, и на этом сторож уже был обманут.
   *
   * `erp_route_apply` перечисляла все девять полей и была зелёной, а поля
   * доезжали только со ВТОРОГО сохранения: шаг payload она искала по
   * `stage_id`, которого у только что созданного этапа нет вовсе — клиент
   * шлёт `null`. При первом сохранении подрядного шага плановые даты,
   * ответственный, «что передаём» и комментарий уходили в спутника пустыми.
   * Нашлось проверкой на боевой схеме, а не тестом.
   *
   * Поэтому проверяется САМ СПОСОБ связывания: шаг сопоставляется этапу
   * по ПОЗИЦИИ в массиве (`v_ids[e.ord]`) — так же, как в этой же функции
   * разрешаются `depends_on`.
   */
  it('erp_route_apply связывает шаг с этапом ПО ПОЗИЦИИ, а не по stage_id', () => {
    expect(ROUTE_APPLY).toContain('with ordinality as e(value, ord)');
    expect(ROUTE_APPLY).toContain('v_ids[e.ord] = s.id');
    // Прежнее связывание не должно вернуться ни в одну из двух веток
    expect(ROUTE_APPLY).not.toContain("(e.value->>'stage_id')::uuid = s.id");
  });
});
