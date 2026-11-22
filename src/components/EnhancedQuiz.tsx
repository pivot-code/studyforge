"use client";

import { useEffect, useState } from "react";
import PdfEvidenceViewer from "@/components/PdfEvidenceViewer";
import {
  loadProgress,
  questionId,
  recordAnswer,
  toggleFavorite,
  toggleReview,
  type SavedQuestion,
  type QuestionRecord,
} from "@/lib/studyProgress";

import {
  loadSpaceRecords, recordSpaceAnswer, toggleSpaceFavorite, toggleSpaceReview,
  SPACE_PROGRESS_EVENT, deleteSpaceQuestionRecord,
} from "@/lib/spaceProgress";

type QuizData = {
  title?: string;
  questions: SavedQuestion[];
  requestedCount?: number;
  generatedCount?: number;
};

type Props = {
  data: unknown;
  reviewMode?: boolean;
  spaceId?: string;
  pdfSessionId?: string;
  expectedPdfName?: string;
};

function parseData(data: unknown): QuizData | null {
  if (!data || typeof data !== "object") return null;

  const value = data as Partial<QuizData>;
  if (!Array.isArray(value.questions)) return null;

  const questions = value.questions.filter(q =>
    q &&
    typeof q.question === "string" &&
    Array.isArray(q.options) &&
    q.options.length === 4 &&
    q.options.every(o => typeof o === "string") &&
    Number.isInteger(q.answerIndex) &&
    q.answerIndex >= 0 &&
    q.answerIndex < 4 &&
    typeof q.explanation === "string" &&
    typeof q.source === "string"
  );

  return {
    title: typeof value.title === "string" ? value.title : "",
    questions,
    requestedCount: typeof value.requestedCount === "number" && Number.isInteger(value.requestedCount)
      ? value.requestedCount : undefined,
    generatedCount: questions.length,
  };
}

export default function EnhancedQuiz({
  data,
  reviewMode = false,
  spaceId,
  pdfSessionId,
  expectedPdfName,
}: Props) {
  const parsed = parseData(data);
  const questions = parsed?.questions ?? [];

  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [records, setRecords] =
    useState<Record<string, QuestionRecord>>({});
  const [showSource, setShowSource] = useState(false);
  const [showPdfSource, setShowPdfSource] = useState(false);
  const [saveError, setSaveError] = useState("");

  useEffect(() => {
    const refresh = () => setRecords(spaceId ? loadSpaceRecords(spaceId) : loadProgress().questions);
    refresh();
    window.addEventListener(SPACE_PROGRESS_EVENT, refresh);
    return () => window.removeEventListener(SPACE_PROGRESS_EVENT, refresh);
  }, [spaceId]);

  if (!questions.length) {
    return (
      <div className="rounded-xl bg-amber-50 p-5 text-sm text-amber-800">
        当前材料不足以生成有效选择题。
      </div>
    );
  }

  const q = questions[index];
  const id = questionId(q);
  const record = records[id];

  const selected = answers[index];
  const answered = selected !== undefined;
  const correct = selected === q.answerIndex;

  const answeredCount = Object.keys(answers).length;
  const correctCount = questions.filter(
    (item, i) => answers[i] === item.answerIndex
  ).length;

  function answer(optionIndex: number) {
    if (answered) return;

    setAnswers(prev => ({ ...prev, [index]: optionIndex }));
    setSaveError("");

    try {
      const updated = spaceId ? recordSpaceAnswer(spaceId, q, optionIndex) : recordAnswer(q, optionIndex);
      setRecords(prev => ({ ...prev, [id]: updated }));
    } catch {
      setSaveError("答题记录未能保存到浏览器。");
    }
  }

  function changeFavorite() {
    setSaveError("");
    try {
      const updated = spaceId ? toggleSpaceFavorite(spaceId, q) : toggleFavorite(q);
      setRecords(prev => ({ ...prev, [id]: updated }));
    } catch {
      setSaveError("收藏操作未能保存。");
    }
  }

  function changeReview() {
    setSaveError("");
    try {
      const updated = spaceId ? toggleSpaceReview(spaceId, q) : toggleReview(q);
      setRecords(prev => ({ ...prev, [id]: updated }));
    } catch {
      setSaveError("重点复习状态未能保存。");
    }
  }

  function clearRecord() {
    if (!spaceId) return;
    setSaveError("");
    try {
      deleteSpaceQuestionRecord(spaceId, q);
      setRecords(prev => { const next = { ...prev }; delete next[id]; return next; });
    } catch { setSaveError("删除记录失败，请检查本地存储。"); }
  }

  function changeQuestion(next: number) {
    setIndex(next);
    setShowSource(false);
    setShowPdfSource(false);
    setSaveError("");
  }

  const buttons =
    "rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium transition hover:bg-slate-50 disabled:opacity-40";

  return (
    <div className="w-full min-w-0">
      {parsed?.title && (
        <h3 className="mb-4 break-words text-lg font-semibold">
          {parsed.title}
        </h3>
      )}

      {parsed?.requestedCount && parsed.requestedCount > questions.length && (
        <div role="status" className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          本次请求 {parsed.requestedCount} 道题，实际生成 {questions.length} 道有效题目。
          其余题目未通过原文依据校验、与已有题目重复，或生成请求未成功。可以更换范围或增加材料后重新生成。
        </div>
      )}

      <div className="mb-3 flex items-center justify-between gap-2 text-xs text-slate-500">
        <span>
          {reviewMode ? "错题重新练习" : "AI 互动测验"}
        </span>
        <span>{index + 1} / {questions.length}</span>
      </div>

      <div className="mb-5 h-1.5 overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full bg-indigo-500 transition-all"
          style={{
            width: `${answeredCount / questions.length * 100}%`,
          }}
        />
      </div>

      <h3 className="mb-5 whitespace-pre-wrap break-words text-base font-semibold leading-7">
        {q.question}
      </h3>

      <div className="space-y-2.5">
        {q.options.map((option, i) => {
          const right = answered && i === q.answerIndex;
          const wrong = answered && i === selected && !correct;

          return (
            <button
              key={i}
              disabled={answered}
              onClick={() => answer(i)}
              className={`flex w-full items-start gap-3 rounded-xl border p-3.5 text-left text-sm leading-6 transition ${
                right
                  ? "border-emerald-400 bg-emerald-50"
                  : wrong
                  ? "border-rose-400 bg-rose-50"
                  : "border-slate-200 bg-white hover:border-indigo-400 disabled:cursor-default"
              }`}
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-100 font-semibold">
                {String.fromCharCode(65 + i)}
              </span>
              <span className="min-w-0 flex-1 break-words">
                {option}
              </span>
              {right && <span className="text-emerald-600">✓</span>}
              {wrong && <span className="text-rose-600">✕</span>}
            </button>
          );
        })}
      </div>

      {answered && (
        <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50 p-4">
          <p className={`font-semibold ${
            correct ? "text-emerald-700" : "text-rose-600"
          }`}>
            {correct ? "回答正确" : "回答错误"}
          </p>
          <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-7 text-slate-700">
            {q.explanation}
          </p>
          <div className="mt-4 border-t border-slate-200 pt-3">
            <button
              type="button"
              onClick={() => setShowSource(!showSource)}
              aria-expanded={showSource}
              className="text-sm font-medium text-indigo-600 hover:underline"
            >
              {showSource ? "收起原文依据 ↑" : "查看原文依据 ↓"}
            </button>
            {showSource && (
              <blockquote className="mt-3 whitespace-pre-wrap break-words rounded-lg border border-slate-200 bg-white p-3 text-xs leading-6 text-slate-600">
                {q.source}
              </blockquote>
            )}
            {pdfSessionId && (
              <div className="mt-3">
                <button
                  type="button"
                  onClick={() => setShowPdfSource(value => !value)}
                  aria-expanded={showPdfSource}
                  className="text-sm font-medium text-indigo-600 hover:underline"
                >
                  {showPdfSource ? "关闭 PDF 原页 ↑" : "查看课件 PDF 原页 ↓"}
                </button>
                {showPdfSource && (
                  <PdfEvidenceViewer
                    sessionId={pdfSessionId}
                    source={q.source}
                    expectedPdfName={expectedPdfName}
                  />
                )}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="mt-5 grid grid-cols-2 gap-2">
        <button
          onClick={changeFavorite}
          className={`rounded-xl border px-3 py-3 text-sm transition ${
            record?.favorite
              ? "border-amber-300 bg-amber-50 text-amber-700"
              : "border-slate-200 bg-white hover:bg-slate-50"
          }`}
        >
          {record?.favorite ? "★ 已收藏" : "☆ 收藏题目"}
        </button>

        <button
          onClick={changeReview}
          className={`rounded-xl border px-3 py-3 text-sm transition ${
            record?.review
              ? "border-indigo-300 bg-indigo-50 text-indigo-700"
              : "border-slate-200 bg-white hover:bg-slate-50"
          }`}
        >
          {record?.review ? "✓ 重点复习中" : "加入重点复习"}
        </button>
      </div>

      {spaceId && answered && record && record.attempts > 0 && (
        <div className="mt-6 border-t border-slate-100 pt-4">
          <button type="button" onClick={clearRecord} className="text-xs text-rose-600 hover:underline">
            删除此题全部学习记录（含收藏与重点复习，不删除题目）
          </button>
        </div>
      )}

      {saveError && (
        <p className="mt-3 text-xs text-red-600">{saveError}</p>
      )}

      <div className="mt-6 flex justify-between gap-3">
        <button
          className={buttons}
          disabled={index === 0}
          onClick={() => changeQuestion(index - 1)}
        >
          ← 上一题
        </button>
        <button
          className={buttons}
          disabled={index === questions.length - 1}
          onClick={() => changeQuestion(index + 1)}
        >
          下一题 →
        </button>
      </div>

      {answeredCount === questions.length && (
        <div className="mt-5 rounded-xl bg-indigo-50 p-4 text-center">
          <p className="text-sm font-semibold text-indigo-700">
            本轮完成：{correctCount} / {questions.length} 题正确
          </p>
          <button
            onClick={() => {
              setAnswers({});
              setIndex(0);
              setShowSource(false);
              setShowPdfSource(false);
            }}
            className="mt-2 text-xs font-medium text-indigo-600 hover:underline"
          >
            再练习一轮
          </button>
        </div>
      )}
    </div>
  );
}
