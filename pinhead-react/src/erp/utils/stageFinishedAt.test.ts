import { describe, expect, it } from 'vitest';
import { functionBody, latestDefining, withoutComments } from './migrations.testutil';

/**
 * Закрыт — значит есть время завершения. Вернулся в работу — значит нет.
 *
 * Нашлось нагрузочным прогоном 11.08: 44 этапа из 132 закрытых стояли в `done`
 * с пустым `finished_at`, и один — в `in_progress` с проставленным. По таким
 * строкам время цикла и факт в плане считаются молча по неполной выборке:
 * ошибки нет, просто треть закрытых работ не участвует в расчёте.
 *
 * Инвариант выполняется НОРМАЛИЗАЦИЕЙ, а не отказом, и это решение стоит
 * сторожить именно так. Отказ (CHECK или ветка в стороже) дал бы «кнопка есть,
 * действие падает»: `erp_stage_apply_defect` принимает статус патчем, и одного
 * патча с `done` без времени хватило бы, чтобы у цеха отвалилось закрытие этапа.
 */

const SQL = latestDefining('erp_clamp_stage_qty');
const BODY = withoutComments(functionBody(SQL, 'erp_clamp_stage_qty'));

describe('erp_clamp_stage_qty нормализует время завершения', () => {
  it('дописывает время, когда этап закрывают без него', () => {
    expect(BODY).toMatch(/new\.status\s*=\s*'done'\s+and\s+new\.finished_at\s+is\s+null/);
    expect(BODY).toMatch(/new\.finished_at\s*:=\s*now\(\)/);
  });

  it('снимает время, когда этап вернулся в работу', () => {
    // Переоткрытый после брака этап сохранял время закрытия — по нему выходило,
    // что задание одновременно идёт и уже сдано
    expect(BODY).toMatch(/new\.finished_at\s*:=\s*null/);
    for (const st of ['waiting', 'ready', 'in_progress', 'blocked']) {
      expect(BODY, `${st} не перечислен среди «ещё не закрыт»`).toContain(`'${st}'`);
    }
  });

  it('`skipped` не трогается ни в одну сторону', () => {
    /**
     * Пропуск — терминальный статус, но не «выполнено». Что там означает время
     * завершения, решает не нормализатор; молча дописать ему `now()` значило бы
     * посчитать пропущенную работу выполненной в отчёте о времени цикла.
     */
    const clause = BODY.slice(BODY.indexOf('finished_at'));
    expect(clause).not.toContain("'skipped'");
  });

  it('счётчики по-прежнему обрезаются — функция пересоздавалась целиком', () => {
    // Ради одного блока переписан весь текст; проверяем, что вместе с ним
    // не уехало то, ради чего функция существует
    expect(BODY).toMatch(/new\.qty_done\s*:=\s*0/);
    expect(BODY).toMatch(/new\.qty_done\s*:=\s*v_qty/);
    expect(BODY).toMatch(/new\.qty_rework\s*:=\s*0/);
  });

  it('нормализация, а не отказ: функция не бросает исключений', () => {
    // Ветка `raise` здесь означала бы, что цех не может закрыть этап
    expect(BODY).not.toMatch(/\braise\b/i);
  });
});

describe('данные приведены к инварианту', () => {
  const FULL = withoutComments(SQL);

  it('миграция чинит обе стороны, а не только одну', () => {
    expect(FULL).toMatch(/set finished_at = updated_at/);
    expect(FULL).toMatch(/set finished_at = null/);
  });

  it('бэкфилл не трогает started_at', () => {
    /**
     * `started_at` ставится ОДИН раз при первом входе в работу, и этап, закрытый
     * с доски напрямую, законно не имеет его вовсе. Восстанавливать его нечем
     * и незачем — это другая величина.
     */
    expect(FULL).not.toMatch(/set started_at/);
  });
});
