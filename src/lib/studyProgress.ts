
export type SavedQuestion = {
  question: string;
  options: string[];
  answerIndex: number;
  explanation: string;
  source: string;
};

export type QuestionRecord = {
  id: string;
  question: SavedQuestion;
  favorite: boolean;
  review: boolean;
  wrong: boolean;
  mastered: boolean;
  attempts: number;
  correct: number;
  createdAt: number;
  updatedAt: number;
};

export type StudyProgress = {
  version: 1;
  questions: Record<string, QuestionRecord>;
};

export const PROGRESS_EVENT = "studyforge-progress-updated";

const STORAGE_KEY = "studyforge-progress-v1";
const LEGACY_KEY = "studyforge-wrong-questions";

function emptyProgress(): StudyProgress {
  return { version: 1, questions: {} };
}

function hashText(text: string): string {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function questionId(question: SavedQuestion): string {
  return (
    hashText(question.question) +
    "-" +
    hashText(question.source) +
    "-" +
    hashText(question.options.join("|"))
  );
}

function isQuestion(value: unknown): value is SavedQuestion {
  if (!value || typeof value !== "object") return false;

  const q = value as Partial<SavedQuestion>;
  return (
    typeof q.question === "string" &&
    q.question.length > 0 &&
    Array.isArray(q.options) &&
    q.options.length === 4 &&
    q.options.every(x => typeof x === "string") &&
    typeof q.answerIndex === "number" &&
    Number.isInteger(q.answerIndex) &&
    q.answerIndex >= 0 &&
    q.answerIndex < 4 &&
    typeof q.explanation === "string" &&
    typeof q.source === "string"
  );
}

function newRecord(question: SavedQuestion): QuestionRecord {
  const now = Date.now();
  return {
    id: questionId(question),
    question,
    favorite: false,
    review: false,
    wrong: false,
    mastered: false,
    attempts: 0,
    correct: 0,
    createdAt: now,
    updatedAt: now,
  };
}

export function loadProgress(): StudyProgress {
  if (typeof window === "undefined") return emptyProgress();

  let result = emptyProgress();

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (
        parsed?.version === 1 &&
        parsed.questions &&
        typeof parsed.questions === "object" &&
        !Array.isArray(parsed.questions)
      ) {
        result = parsed as StudyProgress;
      }
    }
  } catch {
    return result;
  }

  // 迁移旧版 localStorage 中手动保存的错题。
  try {
    const legacyRaw = localStorage.getItem(LEGACY_KEY);
    if (legacyRaw) {
      const legacy: unknown = JSON.parse(legacyRaw);

      if (Array.isArray(legacy)) {
        let changed = false;

        for (const item of legacy) {
          if (!isQuestion(item)) continue;

          const id = questionId(item);
          if (!result.questions[id]) {
            result.questions[id] = {
              ...newRecord(item),
              wrong: true,
            };
            changed = true;
          }
        }

        if (changed) {
          localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify(result)
          );
        }

        // 保留旧版数据作为备份，不删除原记录。
      }
    }
  } catch {
    // 旧数据损坏时不影响新版记录。
  }

  return result;
}

function writeProgress(progress: StudyProgress) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  window.dispatchEvent(new Event(PROGRESS_EVENT));
}

function modifyQuestion(
  question: SavedQuestion,
  update: (record: QuestionRecord) => QuestionRecord
): QuestionRecord {
  const progress = loadProgress();
  const id = questionId(question);
  const existing = progress.questions[id] ?? newRecord(question);

  const next = {
    ...update(existing),
    question,
    updatedAt: Date.now(),
  };

  progress.questions[id] = next;
  writeProgress(progress);
  return next;
}

export function recordAnswer(
  question: SavedQuestion,
  selectedIndex: number
): QuestionRecord {
  return modifyQuestion(question, record => {
    const correct = selectedIndex === question.answerIndex;

    return {
      ...record,
      attempts: record.attempts + 1,
      correct: record.correct + (correct ? 1 : 0),
      wrong: record.wrong || !correct,
      mastered: correct ? record.mastered : false,
    };
  });
}

export function toggleFavorite(
  question: SavedQuestion
): QuestionRecord {
  return modifyQuestion(question, record => ({
    ...record,
    favorite: !record.favorite,
  }));
}

export function toggleReview(
  question: SavedQuestion
): QuestionRecord {
  return modifyQuestion(question, record => ({
    ...record,
    review: !record.review,
  }));
}

export function toggleMastered(
  question: SavedQuestion
): QuestionRecord {
  return modifyQuestion(question, record => ({
    ...record,
    mastered: !record.mastered,
  }));
}

export function removeWrong(question: SavedQuestion) {
  modifyQuestion(question, record => ({
    ...record,
    wrong: false,
  }));
}

export function getRecords(): QuestionRecord[] {
  return Object.values(loadProgress().questions)
    .filter(record => isQuestion(record.question))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getStats() {
  const records = getRecords();

  const attempts = records.reduce(
    (sum, record) => sum + record.attempts, 0
  );
  const correct = records.reduce(
    (sum, record) => sum + record.correct, 0
  );

  return {
    attempts,
    correct,
    accuracy: attempts > 0
      ? Math.round((correct / attempts) * 100)
      : 0,
    wrong: records.filter(r => r.wrong && !r.mastered).length,
    mastered: records.filter(r => r.mastered).length,
    favorites: records.filter(r => r.favorite).length,
    review: records.filter(r => r.review).length,
  };
}
