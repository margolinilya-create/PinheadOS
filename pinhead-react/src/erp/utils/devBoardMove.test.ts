import { describe, expect, it } from 'vitest';
import {
  DEV_MOVE_REFUSAL_TEXT, devMoveIntent, devMoveLabel, devMovePrompt,
  devMoveRefusalText, devStagePath, neighbourStage,
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
  // Ждать нечего — стоянка «Ожидает материалы» этой разработке не требовалась
  { stage: 'materials', lane: 'skipped' },
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
      ['patterns', 'materials', 'cutting', 'branding', 'sewing', 'final']);
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
    const ctx = { hasBranding: true };
    expect(neighbourStage('cutting', -1, ctx)).toBe('patterns');
    expect(neighbourStage('cutting', 1, ctx)).toBe('branding');
  });

  /**
   * СОСЕД БЕРЁТСЯ ИЗ ПУТИ ЭТОЙ разработки (правка 01.09). Прежде кнопки ходили
   * по общему порядку колонок, и «перенести сразу через шаг» клавиатурой было
   * не исполнить — требование выполнялось только мышью.
   */
  it('неприменимый шаг кнопки перешагивают сами', () => {
    // Нанесений в заказе нет — «›» из «Кроя» ведёт прямо в «Пошив»
    expect(neighbourStage('cutting', 1, { hasBranding: false })).toBe('sewing');
    // Ждать нечего — стоянка «Ожидает материалы» из пути выпадает
    expect(neighbourStage('patterns', 1, { materialsPending: false })).toBe('cutting');
    expect(neighbourStage('patterns', 1, { materialsPending: true })).toBe('materials');
  });

  it('карточка на выпавшем из пути шаге всё равно двигается дальше', () => {
    // Материал приехал, пока карточка стояла в «Ожидает материалы»: шаг
    // из пути ушёл, но кнопка обязана вести в «Крой», а не в начало доски
    expect(neighbourStage('materials', 1, { materialsPending: false })).toBe('cutting');
    expect(neighbourStage('materials', -1, { materialsPending: false })).toBe('patterns');
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
 * Закупка держит ВХОД В КРОЙ (правка 30.08, п. 1 → правка 01.09, п. 1).
 *
 * Документ 30.08 требовал двух вещей сразу: построение лекал идёт ПАРАЛЛЕЛЬНО
 * закупке («это текущая правильная логика и её нужно сохранить»), но перевести
 * карточку дальше нельзя, пока материал не подтверждён складом. Тогда это
 * выражалось запретом ВЫХОДА с лекал, и готовые лекала стояли в одной колонке
 * с недоделанными.
 *
 * Документ 01.09 даёт ожиданию собственную колонку: «система должна разрешить
 * перенести карточку только в „Ожидает материалы". Сразу в Крой перенести
 * нельзя».
 */
describe('devMoveIntent — закупка держит вход в крой', () => {
  const base = { canManage: true, outcome: null };

  it('с лекал при незакрытой закупке разрешён ТОЛЬКО «Ожидает материалы»', () => {
    expect(devMoveIntent({
      ...base, from: 'patterns', to: 'materials', materialsPending: true,
    })).toEqual({ ok: true, to: 'materials' });

    for (const to of ['cutting', 'branding', 'sewing', 'final']) {
      expect(devMoveIntent({ ...base, from: 'patterns', to, materialsPending: true }))
        .toEqual({ ok: false, reason: 'materials' });
    }
  });

  it('со стоянки в крой — только после приёмки', () => {
    expect(devMoveIntent({
      ...base, from: 'materials', to: 'cutting', materialsPending: true,
    })).toEqual({ ok: false, reason: 'materials' });

    expect(devMoveIntent({
      ...base, from: 'materials', to: 'cutting', materialsPending: false,
    })).toEqual({ ok: true, to: 'cutting' });
  });

  it('материалы приняты — карточка идёт с лекал прямо в крой', () => {
    // Стоянка необязательна: «если материал уже получен… карточку можно сразу
    // переносить в Крой»
    expect(devMoveIntent({ ...base, from: 'patterns', to: 'cutting', materialsPending: false }))
      .toEqual({ ok: true, to: 'cutting' });
  });

  it('назад двигать можно всегда: ошибку колонкой надо уметь откатить', () => {
    expect(devMoveIntent({ ...base, from: 'cutting', to: 'patterns', materialsPending: true }))
      .toEqual({ ok: true, to: 'patterns' });
  });

  it('на других этапах материалы переход не держат', () => {
    // Гейт стоит на ВХОДЕ в крой; карточку, которая прошла его раньше,
    // заново приехавшая закупка не запирает — работа физически идёт
    expect(devMoveIntent({ ...base, from: 'cutting', to: 'sewing', materialsPending: true }))
      .toEqual({ ok: true, to: 'sewing' });
  });

  it('у отказа есть текст', () => {
    expect(DEV_MOVE_REFUSAL_TEXT.materials).toContain('Ожидает материалы');
  });
});

/**
 * ПЕРЕСКОК ОБЯЗАТЕЛЬНОГО ШАГА (правка заказчика 01.09, п. 2).
 *
 * «Свободное ручное движение оставляем, но система должна блокировать попытку
 * перескочить обязательный этап»: с лекал нельзя сразу в нанесения, из кроя
 * при заказанных нанесениях — сразу в пошив, из нанесений — в финальный этап
 * мимо пошива.
 */
describe('devMoveIntent — последовательность этапов', () => {
  const base = { canManage: true, outcome: null, materialsPending: false };

  it('с лекал сразу в нанесения нельзя — сначала крой', () => {
    expect(devMoveIntent({ ...base, from: 'patterns', to: 'branding', hasBranding: true }))
      .toEqual({ ok: false, reason: 'sequence', expected: 'cutting' });
  });

  it('нанесения в заказе есть — из кроя сразу в пошив нельзя', () => {
    expect(devMoveIntent({ ...base, from: 'cutting', to: 'sewing', hasBranding: true }))
      .toEqual({ ok: false, reason: 'sequence', expected: 'branding' });
  });

  it('нанесений в заказе нет — крой ведёт прямо в пошив', () => {
    // Тот самый «пропуск нанесений» из документа 24.08: шаг не пропускают,
    // его нет в пути этой разработки
    expect(devMoveIntent({ ...base, from: 'cutting', to: 'sewing', hasBranding: false }))
      .toEqual({ ok: true, to: 'sewing' });
  });

  it('из нанесений в финальный этап мимо пошива нельзя', () => {
    expect(devMoveIntent({ ...base, from: 'branding', to: 'final', hasBranding: true }))
      .toEqual({ ok: false, reason: 'sequence', expected: 'sewing' });
  });

  it('шаг за шагом — проходит весь путь', () => {
    const steps = [
      ['patterns', 'materials', true],
      ['materials', 'cutting', false],
      ['cutting', 'branding', false],
      ['branding', 'sewing', false],
      ['sewing', 'final', false],
    ] as const;
    for (const [from, to, pending] of steps) {
      expect(devMoveIntent({
        ...base, from, to, materialsPending: pending, hasBranding: true,
      }), `${from} → ${to}`).toEqual({ ok: true, to });
    }
  });

  it('отказ НАЗЫВАЕТ пропущенный шаг', () => {
    // «Через этап перескочить нельзя» без имени не говорит, что делать
    const refusal = devMoveIntent({
      ...base, from: 'cutting', to: 'sewing', hasBranding: true,
    });
    expect(devMoveRefusalText(refusal)).toContain('Нанесения');
    expect(devMoveRefusalText({ ok: true, to: 'sewing' })).toBeNull();
  });
});

/**
 * НАНЕСЕНИЕ ДЕЛАЕТ ОБЩИЙ ЦЕХ (правка 01.09, вторая итерация, п. 1).
 *
 * «Если нанесение выполняется обычным производственным цехом, экспериментальный
 * цех должен ждать его фактического завершения. Пока вышивка, DTF или
 * шелкография не закрыта соответствующим цехом, переход с Нанесений
 * на следующий этап должен быть заблокирован».
 */
describe('devMoveIntent — нанесения держит цех', () => {
  const base = {
    canManage: true, outcome: null, materialsPending: false, hasBranding: true,
  } as const;

  it('цех ещё не закрыл — вперёд нельзя', () => {
    expect(devMoveIntent({ ...base, from: 'branding', to: 'sewing', brandingOpen: true }))
      .toEqual({ ok: false, reason: 'branding' });
  });

  it('цех закрыл — можно', () => {
    expect(devMoveIntent({ ...base, from: 'branding', to: 'sewing', brandingOpen: false }))
      .toEqual({ ok: true, to: 'sewing' });
  });

  it('назад можно и при незакрытом цехе: ошибку колонкой надо уметь откатить', () => {
    expect(devMoveIntent({ ...base, from: 'branding', to: 'cutting', brandingOpen: true }))
      .toEqual({ ok: true, to: 'cutting' });
  });

  it('держится ВЫХОД, а не вход: попасть в «Нанесения» карточка обязана', () => {
    // Иначе работа в цех не уедет вовсе — задачи заводит сам вход в колонку
    expect(devMoveIntent({ ...base, from: 'cutting', to: 'branding', brandingOpen: true }))
      .toEqual({ ok: true, to: 'branding' });
  });

  it('у отказа есть текст, и он называет цех', () => {
    expect(DEV_MOVE_REFUSAL_TEXT.branding).toMatch(/цех/i);
  });
});

describe('devStagePath — путь конкретной разработки', () => {
  it('стоянка стоит в пути, только пока есть чего ждать', () => {
    expect(devStagePath({ materialsPending: true, hasBranding: true }))
      .toEqual(['patterns', 'materials', 'cutting', 'branding', 'sewing', 'final']);
    expect(devStagePath({ materialsPending: false, hasBranding: true }))
      .toEqual(['patterns', 'cutting', 'branding', 'sewing', 'final']);
  });

  it('нанесения — по потребности заказа', () => {
    expect(devStagePath({ hasBranding: false }))
      .toEqual(['patterns', 'cutting', 'sewing', 'final']);
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

  /**
   * Правка 01.09, п. 1: «технолог двигает карточку с Построения лекал. Система
   * просит техническое название лекал». У заказа с незавершённой закупкой
   * карточка уходит в «Ожидает материалы», и привязка вопроса к одному «Крою»
   * пропускала бы его у большинства разработок.
   */
  it('уход в «Ожидает материалы» спрашивает то же самое', () => {
    expect(devMovePrompt('patterns', 'materials', { pattern_tech_name: null })?.field)
      .toBe('pattern_tech_name');
  });

  it('название уже записано — повторно не спрашиваем', () => {
    expect(devMovePrompt('patterns', 'cutting', { pattern_tech_name: 'PNHD-v1' })).toBeNull();
    expect(devMovePrompt('patterns', 'materials', { pattern_tech_name: 'PNHD-v1' })).toBeNull();
  });

  it('остальные переходы ничего не спрашивают', () => {
    expect(devMovePrompt('cutting', 'sewing', { pattern_tech_name: null })).toBeNull();
    // Возврат назад — не завершение работы, спрашивать нечего
    expect(devMovePrompt('materials', 'patterns', { pattern_tech_name: null })).toBeNull();
  });
});
