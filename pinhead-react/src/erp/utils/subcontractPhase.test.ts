import { describe, expect, it } from 'vitest';
import { latestMatching, withoutComments } from './migrations.testutil';
import {
  SUBCONTRACT_PHASE_FLOW,
  isSubcontractTerminal,
  legacyStatusFromPhase,
  nextSubcontractPhase,
  phaseFromLegacyStatus,
  subcontractPhase,
  subcontractPhasePatch,
} from './subcontractPhase';
import { SUBCONTRACT_PHASE_LABELS } from '../types';
import type { SubcontractPhase } from '../types';

/**
 * Сторож против колонки, которую читают, но не двигают.
 *
 * Волна 3.5 перевела складской гейт на `erp_subcontracting.phase`, а клиент
 * оставила на `status`. Обе колонки «работали», просто описывали разное:
 * `phase` стояла с бэкфилла, `status` уходил вперёд. Гейт при этом выглядел
 * исправным — `warehouseGate.test.ts` честно проверял, что SQL читает `phase`,
 * и не мог заметить, что её никто не пишет.
 *
 * Отсюда два вида проверок: соответствие маппинга миграции (чтобы старые строки
 * читались так же, как их разложил бэкфилл) и полнота — чтобы новая фаза не
 * могла появиться без перевода в обе стороны.
 */

const PHASES = SUBCONTRACT_PHASE_FLOW;

describe('фаза подряда: соответствие бэкфиллу миграции', () => {
  const BACKFILL = withoutComments(
    latestMatching(/phase = case status/, 'бэкфилл phase из status'),
  );

  /** Пары «старый статус → фаза» прямо из текста миграции */
  const fromMigration = [...BACKFILL.matchAll(/when '(\w+)'\s+then '(\w+)'/g)]
    .map(([, status, phase]) => ({ status, phase }));

  it('миграция действительно разбирается на пары', () => {
    expect(fromMigration.length).toBeGreaterThanOrEqual(8);
  });

  it.each([
    'planned', 'awaiting_payment', 'sent', 'in_progress',
    'ready_to_ship', 'shipped_by_contractor', 'received_at_pinhead',
  ])('%s раскладывается так же, как в бэкфилле', (status) => {
    const expected = fromMigration.find((p) => p.status === status);
    expect(expected, `в миграции нет ветки ${status}`).toBeTruthy();
    expect(phaseFromLegacyStatus(status)).toBe(expected!.phase);
  });

  /**
   * Единственное намеренное расхождение: в миграции `awaiting_materials` не имел
   * своей ветки и проваливался в `else 'planned'`. Живых строк с ним не было,
   * поэтому промах ничего не испортил, но повторять его незачем.
   */
  it('awaiting_materials исправлен относительно миграции', () => {
    expect(fromMigration.some((p) => p.status === 'awaiting_materials')).toBe(false);
    expect(phaseFromLegacyStatus('awaiting_materials')).toBe('materials_ready');
  });

  it('незнакомый статус не роняет, а даёт начальную фазу', () => {
    expect(phaseFromLegacyStatus('нет такого')).toBe('planned');
    expect(phaseFromLegacyStatus(null)).toBe('planned');
    expect(phaseFromLegacyStatus(undefined)).toBe('planned');
  });
});

describe('перевод в обе стороны', () => {
  it.each(PHASES)('%s зеркалится в допустимый статус', (phase) => {
    expect(legacyStatusFromPhase(phase), `нет зеркала у ${phase}`).toBeTruthy();
  });

  /**
   * Круговой прогон: фаза → устаревший статус → фаза. Держится для шести фаз
   * из семи — ради этого маппинг и сделан ОДНИМ на оба типа операции. Пока их
   * было два, у `operation` схлопывались `materials_ready` и `accepted`:
   * поведение зеркала зависело от того, чем занят подрядчик.
   */
  const COLLAPSED: SubcontractPhase[] = ['closed', 'ready_at_contractor'];
  it.each(PHASES.filter((p) => !COLLAPSED.includes(p)))('%s переживает круговой прогон', (phase) => {
    expect(phaseFromLegacyStatus(legacyStatusFromPhase(phase))).toBe(phase);
  });

  it('closed схлопывается в accepted и это осознанно', () => {
    // В перечислении `status` значения `closed` нет вовсе — ни одно старое
    // чтение его не различает.
    expect(phaseFromLegacyStatus(legacyStatusFromPhase('closed'))).toBe('accepted');
  });

  /**
   * Второе схлопывание — восьмая фаза документа, заведённая правкой 16.08.
   * `ready_to_ship` в бэкфилле уже занят под `at_contractor`, и перевесить его
   * нельзя: тот маппинг сторожит проверка выше, читающая саму миграцию, а
   * перевес поменял бы чтение существующих строк. Потеря ровно там, где старая
   * колонка и не умела различать «работа идёт» и «работа сделана, заберите».
   */
  it('ready_at_contractor схлопывается в at_contractor и это вынужденно', () => {
    expect(legacyStatusFromPhase('ready_at_contractor')).toBe('ready_to_ship');
    expect(phaseFromLegacyStatus('ready_to_ship')).toBe('at_contractor');
  });

  it('оплата больше не появляется в производственном потоке', () => {
    // `awaiting_payment` — статус, который волна 3.5 убрала из потока.
    // Ни одна фаза не должна зеркалиться обратно в него.
    for (const phase of PHASES) {
      expect(legacyStatusFromPhase(phase)).not.toBe('awaiting_payment');
    }
  });
});

describe('чтение фазы у строки', () => {
  it('верит phase, когда она ушла с начальной', () => {
    expect(subcontractPhase({ phase: 'at_contractor', status: 'planned' })).toBe('at_contractor');
  });

  /**
   * Строки, созданные ДО этой правки: `phase` у них с бэкфилла, а осмысленное
   * значение уехало в `status`. Иначе экран показывал бы «Запланировано»
   * у операции, которая давно у подрядчика.
   */
  it('падает на status, когда phase осталась начальной', () => {
    expect(subcontractPhase({ phase: 'planned', status: 'shipped_by_contractor' }))
      .toBe('returned');
  });

  it('работает без обеих колонок', () => {
    expect(subcontractPhase({})).toBe('planned');
  });
});

describe('порядок фаз', () => {
  it('идёт по документу и заканчивается', () => {
    expect(nextSubcontractPhase('planned')).toBe('materials_ready');
    expect(nextSubcontractPhase('returned')).toBe('accepted');
    expect(nextSubcontractPhase('closed')).toBeNull();
  });

  it('незнакомая фаза начинает поток сначала', () => {
    expect(nextSubcontractPhase('нет такой' as SubcontractPhase)).toBe('planned');
  });

  it('терминальные фазы не задерживают подрядчика', () => {
    expect(isSubcontractTerminal('at_contractor')).toBe(false);
    expect(isSubcontractTerminal('returned')).toBe(true);
    expect(isSubcontractTerminal('accepted')).toBe(true);
    expect(isSubcontractTerminal('closed')).toBe(true);
  });
});

describe('полнота', () => {
  it('у каждой фазы потока есть подпись на русском', () => {
    for (const phase of PHASES) {
      expect(SUBCONTRACT_PHASE_LABELS[phase], `нет подписи у ${phase}`).toMatch(/[а-яА-Я]/);
    }
  });

  it('поток покрывает все объявленные фазы', () => {
    expect([...PHASES].sort()).toEqual(Object.keys(SUBCONTRACT_PHASE_LABELS).sort());
  });

  it('патч перехода несёт обе колонки', () => {
    expect(subcontractPhasePatch('sent')).toEqual({ phase: 'sent', status: 'sent' });
    expect(subcontractPhasePatch('at_contractor'))
      .toEqual({ phase: 'at_contractor', status: 'in_progress' });
  });
});
