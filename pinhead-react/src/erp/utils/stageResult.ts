/**
 * РЕЗУЛЬТАТ ЭТАПА — ФАЙЛ, А НЕ ШТУКИ (правка 13.09, п. 9).
 *
 * Этап «Разработка программы вышивки» заведён 12.09 признаком
 * `erp_item_stages.result_kind = 'embroidery_program'`: он не производит
 * изделий, его результат — файл программы. Форма отчёта у него уже была своя,
 * а ЗАВЕРШЕНИЕ шло общей количественной дорогой: «Завершить этап» спрашивало
 * «Завершить этап не полностью? Цех отчитался за 0 из 100 шт» и дописывало
 * весь тираж. На боевой базе это видно прямо — у двух закрытых таких этапов
 * стоит `qty_done` 100 и 150 при нулевой фактической выработке.
 *
 * Признак спрашивается ЗДЕСЬ и только здесь. По `operation` его опознавать
 * нельзя: такой операции нет в справочнике `route_operation` вовсе, это
 * свободный ввод конструктора маршрута, и первое же переименование МОЛЧА
 * вернуло бы цеху поля количества (тот же довод, по которому колонка
 * и заведена).
 *
 * Модуль-лист без зависимостей от стора: его читают и утилиты (`stageDone`),
 * и слайс-писатель, и три поверхности цеха.
 */

import type { ErpItemStage, ErpOrderAttachment } from '../types';

/** Заказ глазами этого модуля: нужны ровно вложения */
type WithAttachments = { attachments?: ErpOrderAttachment[] | null };

/** Минимум этапа для вопроса «результат — файл?» */
export type ResultKindStage = Pick<ErpItemStage, 'id'> & { result_kind?: string | null };

/**
 * Виды результата, у которых количество не участвует НИ В ЧЁМ: ни в готовности,
 * ни в завершении, ни в браке и «плюсах». Перечисление, а не булев флаг:
 * колонка `result_kind` заведена расширяемой, и следующий вид результата
 * (скажем, раскладка лекал файлом) допишется сюда, а не заведёт своё условие.
 */
export const FILE_RESULT_KINDS: readonly string[] = ['embroidery_program'];

/** Результат этого этапа — файл, а не штуки */
export function isFileResultStage(stage: ResultKindStage | null | undefined): boolean {
  return Boolean(stage?.result_kind && FILE_RESULT_KINDS.includes(stage.result_kind));
}

/**
 * Файлы, которые цех СДАЛ по этому этапу (вид вложения `stage_result`).
 *
 * Не путать с `subcontract`: те, наоборот, отдают подрядчику. Вид заведён
 * 12.09 вместе с самой колонкой.
 */
export function stageResultFiles(
  order: WithAttachments | null | undefined,
  stageId: string,
): ErpOrderAttachment[] {
  return (order?.attachments ?? []).filter(
    (a) => a.kind === 'stage_result' && a.stage_id === stageId,
  );
}

/**
 * Почему этап с файловым результатом закрывать нельзя, или `null`.
 *
 * Файл — ЕДИНСТВЕННЫЙ результат такого этапа: закрытый пустым, он оставил бы
 * вышивальщицу без программы, и выяснилось бы это уже в цехе. Текст один
 * на все поверхности — кнопка гасится с этой подписью рядом, а пути, где
 * кнопки нет (дорожка канбана, чип плана), получают его тостом.
 */
export function stageResultFileBlock(
  stage: ResultKindStage | null | undefined,
  order: WithAttachments | null | undefined,
): string | null {
  if (!stage || !isFileResultStage(stage)) return null;
  if (stageResultFiles(order, stage.id).length > 0) return null;
  return 'Не приложен файл программы вышивки — без него этап не закрыть.';
}

/** Минимум этапа позиции для вопроса «готова ли программа вышивки» */
type ProgramSibling = Pick<ErpItemStage, 'id' | 'department_id' | 'status'> & {
  result_kind?: string | null;
};

/**
 * ВЫШИВКУ НЕЛЬЗЯ ЗАВЕРШИТЬ ДО «РАЗРАБОТКИ ПРОГРАММЫ ВЫШИВКИ»
 * (правка заказчика 27.09, п. 3).
 *
 * По вышивке заводятся два этапа одного участка: разработка программы
 * (`result_kind = 'embroidery_program'`, `standalone` — крой она не держит)
 * и сама вышивка. Зависимости между ними в графе нет намеренно, а завершение
 * граф и так не проверял: «Вышивку» можно было закрыть при незавершённой
 * программе. Документ: «проверять именно связанную задачу, чтобы готовая
 * программа другой позиции не снимала ограничение» — сравниваем этапы
 * ТОЙ ЖЕ позиции (`allStages` — этапы позиции) и того же участка.
 *
 * `skipped` считается завершением: пропущенная программа не держит вышивку,
 * иначе этап, пропущенный менеджером, запирал бы цех навсегда.
 * Запуск вышивки не гейтится — программу пишут параллельно.
 */
export function embroideryProgramBlock(
  stage: ProgramSibling,
  allStages: readonly ProgramSibling[] | null | undefined,
): string | null {
  if (isFileResultStage(stage)) return null;
  const pending = (allStages ?? []).some((s) => s.id !== stage.id
    && s.department_id === stage.department_id
    && isFileResultStage(s)
    && s.status !== 'done' && s.status !== 'skipped');
  return pending ? 'Сначала завершите задачу “Разработка программы вышивки”' : null;
}
