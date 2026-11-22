import { questionId, type SavedQuestion, type QuestionRecord } from "@/lib/studyProgress";

const KEY_PREFIX = "studyforge-space-progress-v1:";
export const SPACE_PROGRESS_EVENT = "studyforge-space-progress-updated";

function storageKey(spaceId: string): string {
  if (!spaceId.trim()) throw new Error("学习空间 ID 不能为空");
  return KEY_PREFIX + spaceId;
}

export function loadSpaceRecords(spaceId: string): Record<string, QuestionRecord> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(storageKey(spaceId));
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const value = parsed as Record<string, unknown>;
    if (value.version !== 1 || !value.questions || typeof value.questions !== "object" || Array.isArray(value.questions)) return {};
    return value.questions as Record<string, QuestionRecord>;
  } catch { return {}; }
}

function save(spaceId: string, questions: Record<string, QuestionRecord>) {
  localStorage.setItem(storageKey(spaceId), JSON.stringify({ version: 1, questions }));
  window.dispatchEvent(new CustomEvent(SPACE_PROGRESS_EVENT, { detail: { spaceId } }));
}

function update(spaceId: string, question: SavedQuestion, change: (record: QuestionRecord) => QuestionRecord) {
  const questions = loadSpaceRecords(spaceId);
  const id = questionId(question);
  const now = Date.now();
  const old: QuestionRecord = questions[id] ?? {
    id, question, favorite: false, review: false, wrong: false, mastered: false,
    attempts: 0, correct: 0, createdAt: now, updatedAt: now,
  };
  const next = { ...change(old), id, question, updatedAt: now };
  save(spaceId, { ...questions, [id]: next });
  return next;
}

export function recordSpaceAnswer(spaceId: string, question: SavedQuestion, answerIndex: number) {
  return update(spaceId, question, r => ({
    ...r, attempts: r.attempts + 1,
    correct: r.correct + (answerIndex === question.answerIndex ? 1 : 0),
    wrong: r.wrong || answerIndex !== question.answerIndex,
  }));
}
export function toggleSpaceFavorite(spaceId: string, question: SavedQuestion) {
  return update(spaceId, question, r => ({ ...r, favorite: !r.favorite }));
}
export function toggleSpaceReview(spaceId: string, question: SavedQuestion) {
  return update(spaceId, question, r => ({ ...r, review: !r.review }));
}
export function removeSpaceWrong(spaceId: string, question: SavedQuestion) {
  return update(spaceId, question, r => ({ ...r, wrong: false, mastered: false }));
}
export function deleteSpaceQuestionRecord(spaceId: string, question: SavedQuestion) {
  const records = loadSpaceRecords(spaceId);
  delete records[questionId(question)];
  save(spaceId, records);
}
export function deleteSpaceProgress(spaceId: string) {
  if (typeof window === "undefined") return;
  localStorage.removeItem(storageKey(spaceId));
  window.dispatchEvent(new CustomEvent(SPACE_PROGRESS_EVENT, { detail: { spaceId } }));
}
