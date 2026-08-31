import { describe, expect, it } from 'vitest';
import {
  DEV_MOVE_REFUSAL_TEXT, devMoveIntent, devMoveLabel, neighbourStage, devMovePrompt,
} from './devBoardMove';
import { DEV_STAGE_ORDER, devBoardColumn, isDevStage } from './experimentalBoard';
import type { DevStageState } from './experimentalBoard';

/**
 * Ручной перенос карточки по колонкам канбана ЭКС (правка заказчика 24.08,
 * п. 4.2): «технолог сам вручную перетаскивает карточку между колонками.
 * Автоматическое движение по основным этапам не нужно».
 *
 * ЧТО ИМЕННО СТОРОЖИТСЯ. Хранимая колонка — обращение решения от 12.08,
 * когда `phase` убрали как второй источник правды. Обращение законно ровно
 * при одном условии: хранимое и вычисленное отвечают на РАЗНЫЕ вопросы,
 * и хранимое перебивает. Если расчёт однажды снова начнёт определять колонку,
 * карточка будет прыгать назад из-под руки технолога — молча, и заметит это
 * не тест, а человек, который бросит ею пользоваться.
 */

/** Состояния шагов: «лекала закрыты, крой идёт» — расчёт дал бы «Крой» */
const STATES = [
  { stage: 'patterns', lane: 'done' },
  { stage: 'cutting', lane: 'in_progress' },
  { stage: 'branding', lane: 'waiting' },
  { stage: 'sewing', lane: 'waiting' },
  { stage: 'final', lane: 'waiting' },
] as unknown as DevStageState[];

describe('колонка: ручное намерение перебивает расчёт', () => {
  it('без ручного переноса колонка считается как прежде', () => {
    // Заведённые раньше разработки в момент выкладки не прыгают
    expect(devBoardColumn(STATES, {})).toBe('cutting');
    expect(devBoardColumn(STATES, { board_stage: null })).toBe('cutting');
  });

  it('перенесённая руками карточка стоит там, куда её положили', () => {
    expect(devBoardColumn(STATES, { board_stage: 'sewing' })).toBe('sewing');
  });

  /**
   * «Пропуск нанесений» из документа не требует НИ ОДНОЙ строки особого кода:
   * технолог тащит карточку из «Кроя» в «Пошив», и это и есть решение.
   */
  it('карточку можно перенести через «Нанесения» — этап необязателен', () => {
    const from = devBoardColumn(STATES, {});
    expect(from).toBe('cutting');
    expect(devBoardColumn(STATES, { board_stage: 'sewing' })).toBe('sewing');
  });

  /**
   * ЗАКРЫТАЯ РАЗРАБОТКА СИЛЬНЕЕ РУЧНОГО ПЕРЕНОСА: «после завершения разработка
   * уходит из активного канбана в завершённые» (п. 4.5). Иначе её можно было бы
   * объявить незакрытой одним движением пальца.
   */
  it('закрытая разработка остаётся в «Финальном этапе»', () => {
    expect(devBoardColumn(STATES, { outcome: 'ready_for_serial', board_stage: 'cutting' }))
      .toBe('final');
  });

  it('мусор в колонке не ломает доску, а откатывает к расчёту', () => {
    // CHECK базы такого не пропустит, но урезанный кэш и старый бандл —
    // да, и карточка, исчезнувшая со всех колонок, хуже неточной
    expect(devBoardColumn(STATES, { board_stage: 'нанесения' })).toBe('cutting');
    expect(isDevStage('branding')).toBe(true);
    expect(isDevStage('нанесения')).toBe(false);
  });

  it('перечень шагов — зеркало CHECK базы', () => {
    expect(DEV_STAGE_ORDER).toEqual(
      ['patterns', 'cutting', 'branding', 'sewing', 'final']);
  });
});

describe('намерение переноса', () => {
  const base = { from: 'cutting', canManage: true } as const;

  it('обычный перенос разрешён', () => {
    expect(devMoveIntent({ ...base, to: 'sewing' })).toEqual({ ok: true, to: 'sewing' });
  });

  it('без права двигать нельзя — и это главная причина отказа', () => {
    // Порядок проверок: человеку без права незачем читать «карточка уже здесь»
    expect(devMoveIntent({ ...base, to: 'cutting', canManage: false }))
      .toEqual({ ok: false, reason: 'forbidden' });
  });

  it('закрытую разработку не двигают', () => {
    expect(devMoveIntent({ ...base, to: 'sewing', outcome: 'not_serial' }))
      .toEqual({ ok: false, reason: 'closed' });
  });

  it('бросок в свою же колонку ничего не значит', () => {
    expect(devMoveIntent({ ...base, to: 'cutting' }))
      .toEqual({ ok: false, reason: 'same' });
  });

  it('неизвестная колонка не пишется в базу', () => {
    // Иначе CHECK ответил бы 23514 на бросок мимо доски
    expect(devMoveIntent({ ...base, to: 'нанесения' }).ok).toBe(false);
    expect(devMoveIntent({ ...base, to: undefined }).ok).toBe(false);
  });

  it('у каждой причины отказа есть текст', () => {
    // Молча не сработавшее перетаскивание человек повторяет трижды,
    // прежде чем решить, что сайт сломан
    for (const reason of ['closed', 'forbidden', 'same'] as const) {
      expect(DEV_MOVE_REFUSAL_TEXT[reason], reason).toBeTruthy();
    }
  });
});

describe('клавиатурная альтернатива перетаскиванию', () => {
  it('соседние шаги — влево и вправо', () => {
    expect(neighbourStage('cutting', -1)).toBe('patterns');
    expect(neighbourStage('cutting', 1)).toBe('branding');
  });

  it('на краях дальше некуда — null, а не заворот', () => {
    // Заворот с «Финального этапа» в «Лекала» был бы переносом назад по всему
    // пути от одного нажатия
    expect(neighbourStage('patterns', -1)).toBeNull();
    expect(neighbourStage('final', 1)).toBeNull();
  });

  it('подпись действия называет колонку словами', () => {
    expect(devMoveLabel('sewing')).toBe('Перенести в «Пошив»');
  });
});

/**
 * Закупка держит ВЫХОД с лекал (правка заказчика 30.08, п. 1).
 *
 * Документ требует двух вещей сразу: построение лекал идёт ПАРАЛЛЕЛЬНО
 * закупке («это текущая правильная логика и её нужно сохранить»), но
 * перевести карточку дальше нельзя, пока материал не подтверждён складом.
 * Поэтому блокируется переход, а не сам этап.
 */
describe('devMoveIntent — материалы держат выход с лекал', () => {
  const base = { canManage: true, outcome: null };

  it('вперёд с лекал при незакрытой закупке — отказ с причиной', () => {
    for (const to of ['cutting', 'branding', 'sewing', 'final']) {
      expect(devMoveIntent({ ...base, from: 'patterns', to, materialsPending: true }))
        .toEqual({ ok: false, reason: 'materials' });
    }
  });

  it('материалы приняты — переход разрешён', () => {
    expect(devMoveIntent({ ...base, from: 'patterns', to: 'cutting', materialsPending: false }))
      .toEqual({ ok: true, to: 'cutting' });
  });

  it('назад двигать можно всегда: ошибку колонкой надо уметь откатить', () => {
    expect(devMoveIntent({ ...base, from: 'cutting', to: 'patterns', materialsPending: true }))
      .toEqual({ ok: true, to: 'patterns' });
  });

  it('на других этапах материалы переход не держат', () => {
    // Гейт документа — про выход с лекал; дальше материал уже в работе
    expect(devMoveIntent({ ...base, from: 'cutting', to: 'sewing', materialsPending: true }))
      .toEqual({ ok: true, to: 'sewing' });
  });

  it('у отказа есть текст', () => {
    expect(DEV_MOVE_REFUSAL_TEXT.materials).toContain('Ожидаем материал');
  });
});

/**
 * Одно окно на переходе «Лекала → Крой» (правка заказчика 30.08, п. 3).
 * Обязательных задач у этапов больше нет, и вопрос о техническом названии
 * лекал переехал из закрытия задачи в сам переход.
 */
describe('devMovePrompt', () => {
  it('переход «Лекала → Крой» требует техническое название лекал', () => {
    const p = devMovePrompt('patterns', 'cutting', { pattern_tech_name: null });
    expect(p?.field).toBe('pattern_tech_name');
    expect(p?.label).toBe('Техническое название лекал');
  });

  it('название уже записано — повторно не спрашиваем', () => {
    expect(devMovePrompt('patterns', 'cutting', { pattern_tech_name: 'PNHD-v1' })).toBeNull();
  });

  it('остальные переходы ничего не спрашивают', () => {
    expect(devMovePrompt('cutting', 'sewing', { pattern_tech_name: null })).toBeNull();
    expect(devMovePrompt('patterns', 'sewing', { pattern_tech_name: null })).toBeNull();
  });
});
