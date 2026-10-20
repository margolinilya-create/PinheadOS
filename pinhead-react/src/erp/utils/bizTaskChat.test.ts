import { describe, it, expect } from 'vitest';
import { bizTaskParticipants, canMarkAsResult, canWriteBizTaskChat } from './bizTaskChat';

const TASK = {
  creator_id: 'u1', assignee_id: 'u2', watchers: ['u3', 'u2', 'u1'],
  status: 'in_progress' as const, result_message_id: null,
};
const MSG = { id: 'm1', author_id: 'u2', deleted_at: null };

describe('диалог задачи: участники и права', () => {
  it('участник с несколькими ролями учитывается один раз', () => {
    expect(bizTaskParticipants(TASK)).toEqual(['u1', 'u2', 'u3']);
  });

  it('пишут участники и руководитель с правом, посторонний — нет', () => {
    expect(canWriteBizTaskChat(TASK, 'u3', false)).toBe(true);
    expect(canWriteBizTaskChat(TASK, 'u4', false)).toBe(false);
    expect(canWriteBizTaskChat(TASK, 'u4', true)).toBe(true);
    expect(canWriteBizTaskChat(TASK, null, true)).toBe(false);
  });

  it('результат — своё живое сообщение ответственного в работе или на проверке', () => {
    expect(canMarkAsResult(TASK, MSG, 'u2')).toBe(true);
    expect(canMarkAsResult({ ...TASK, status: 'review' }, MSG, 'u2')).toBe(true);
    // Постановщик не отмечает чужое сообщение результатом
    expect(canMarkAsResult(TASK, MSG, 'u1')).toBe(false);
    // Ответственный — только своё
    expect(canMarkAsResult(TASK, { ...MSG, author_id: 'u3' }, 'u2')).toBe(false);
    expect(canMarkAsResult(TASK, { ...MSG, deleted_at: '2026-10-20T10:00:00Z' }, 'u2')).toBe(false);
    expect(canMarkAsResult({ ...TASK, status: 'new' }, MSG, 'u2')).toBe(false);
    expect(canMarkAsResult({ ...TASK, status: 'done' }, MSG, 'u2')).toBe(false);
    // Уже результат — второй раз не предлагается
    expect(canMarkAsResult({ ...TASK, result_message_id: 'm1' }, MSG, 'u2')).toBe(false);
  });
});
