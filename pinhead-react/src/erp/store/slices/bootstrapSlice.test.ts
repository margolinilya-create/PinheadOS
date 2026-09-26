import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { latestDefining, withoutComments } from '../../utils/migrations.testutil';

/**
 * ПАКЕТ ОБОЛОЧКИ НЕ ОБЪЯВЛЯЕТ РАЗДЕЛ ЗАГРУЖЕННЫМ, ПОКА НЕСЁТ БЕДНУЮ ФОРМУ
 * (обзор 26.09, сессия 69).
 *
 * `erp_bootstrap` отдаёт подряд без журнала `erp_subcontract_moves`,
 * а разработку — без `erp_order_attachments` и `order.due_date`. Загрузчики
 * экранов (`loadSubcontracting`, `loadExperimental`) эти эмбеды несут. Пока
 * слайс поднимал `subcontractingLoaded`/`experimentalLoaded` из пакета, экран
 * свой запрос не слал, и журнал перемещений с файлами разработки оставались
 * ПУСТЫМИ до первой мутации.
 *
 * Сторож держит две половины вместе: пока в SQL пакета нет этих эмбедов,
 * слайс не имеет права ставить флаги. Кто добавит эмбеды в RPC — снимет
 * первую проверку и осознанно решит вторую; кто вернёт флаг, не тронув SQL, —
 * получит красный тест.
 *
 * Мутации (проверены 26.09): `subcontractingLoaded: true` в слайсе — красный;
 * подмена имени RPC — красный («нет миграции»).
 */
const SLICE = readFileSync(join(process.cwd(), 'src/erp/store/slices/bootstrapSlice.ts'), 'utf8');

describe('erp_bootstrap — форма пакета против флагов разделов', () => {
  const sql = withoutComments(latestDefining('erp_bootstrap'));

  it('SQL пакета не несёт журнал подряда и файлы разработки (иначе пересмотреть слайс)', () => {
    expect(sql).not.toMatch(/erp_subcontract_moves/);
    expect(sql).not.toMatch(/erp_order_attachments/);
  });

  it('слайс не поднимает флаги подряда и разработки', () => {
    const code = withoutComments(SLICE).replace(/\/\*[\s\S]*?\*\//g, '');
    expect(code).not.toMatch(/subcontractingLoaded:\s*true/);
    expect(code).not.toMatch(/experimentalLoaded:\s*true/);
  });

  it('слайс кладёт строки только в ещё не загруженный раздел', () => {
    const code = withoutComments(SLICE).replace(/\/\*[\s\S]*?\*\//g, '');
    expect(code).toMatch(/s\.subcontractingLoaded\s*\?\s*\{\}\s*:\s*\{\s*subcontracting:/);
    expect(code).toMatch(/s\.experimentalLoaded\s*\?\s*\{\}\s*:\s*\{\s*experimental:/);
  });
});
