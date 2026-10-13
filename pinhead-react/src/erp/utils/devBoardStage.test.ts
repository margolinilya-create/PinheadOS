import { describe, expect, it } from 'vitest';
import { DEV_STAGE_LABELS, DEV_STAGE_ORDER, isDevStage } from './experimentalBoard';
import { latestMatching, withoutComments } from './migrations.testutil';

/**
 * КОЛОНКА ДОСКИ ЭКС ЖИВЁТ В ДВУХ МЕСТАХ: `DevStage` на клиенте и CHECK
 * `erp_experimental_board_stage_check` в базе.
 *
 * Расхождение не роняет ничего и потому опасно. Забыли значение в CHECK —
 * первый же перенос отвечает 23514, то есть карточка не двигается вовсе.
 * Забыли на клиенте — `isDevStage` отбрасывает записанное значение, и
 * `devBoardColumn` откатывается к расчёту: карточка молча уезжает из колонки,
 * куда её поставил человек. Это третий случай одного жанра после видов
 * вложений (`erp_order_attachments_kind_check`) и `material_source`, поэтому
 * у него свой сторож.
 *
 * Читается ПОСЛЕДНЯЯ миграция, задающая констрейнт: констрейнт пересоздаётся
 * целиком, и прежняя миграция остаётся со старым перечнем — сторож, читающий
 * её, сверялся бы с перечнем, которого в базе нет.
 */
const SQL = withoutComments(latestMatching(
  /add constraint erp_experimental_board_stage_check/,
  'erp_experimental_board_stage_check',
));

/** Значения из `board_stage in ('a', 'b', …)` — в порядке объявления */
function checkValues(sql: string): string[] {
  const m = sql.match(/board_stage in \(([^)]*)\)/);
  if (!m) throw new Error('в миграции нет перечня значений board_stage');
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

describe('board_stage: клиент и CHECK базы', () => {
  it('перечень значений совпадает ДОСЛОВНО и по порядку', () => {
    expect(checkValues(SQL)).toEqual(DEV_STAGE_ORDER);
  });

  it('NULL остаётся допустимым — «не двигали руками»', () => {
    // Заведённые раньше разработки в момент выкладки не прыгают: колонка
    // у них считается из задач, как и до появления `board_stage`
    expect(SQL).toMatch(/board_stage is null/);
  });

  it('шаг «Ожидает материалы» заведён под ключом `materials`', () => {
    /**
     * Ключ отличается от дорожки `awaiting_materials` намеренно: дорожка
     * отвечает на «что с работой», колонка — на «куда технолог вправе
     * перенести карточку». Одноимённые, они читались бы как одно и то же
     * в двух разных перечислениях.
     */
    expect(DEV_STAGE_ORDER).toContain('materials');
    expect(DEV_STAGE_LABELS.materials).toBe('Ожидает материалы');
    expect(isDevStage('materials')).toBe(true);
    expect(isDevStage('awaiting_materials')).toBe(false);
  });

  it('стоянка стоит МЕЖДУ лекалами и кроем', () => {
    // «Сейчас в экспериментальном цехе после Построения лекал сразу идёт Крой.
    // Нужно добавить между ними отдельный этап Ожидает материалы»
    expect(DEV_STAGE_ORDER.indexOf('materials'))
      .toBe(DEV_STAGE_ORDER.indexOf('patterns') + 1);
    expect(DEV_STAGE_ORDER.indexOf('cutting'))
      .toBe(DEV_STAGE_ORDER.indexOf('materials') + 1);
  });

  it('у каждого шага есть подпись — иначе колонка без заголовка', () => {
    for (const stage of DEV_STAGE_ORDER) {
      expect(DEV_STAGE_LABELS[stage], stage).toBeTruthy();
    }
  });
});
