"use client";

import { useEffect, useMemo, useState } from "react";
import EnhancedQuiz from "@/components/EnhancedQuiz";
import { questionId, type SavedQuestion, type QuestionRecord } from "@/lib/studyProgress";
import { loadSpaceRecords, removeSpaceWrong, toggleSpaceFavorite, deleteSpaceQuestionRecord, SPACE_PROGRESS_EVENT } from "@/lib/spaceProgress";

type Tab = "overview" | "all" | "wrong" | "favorites" | "stats";
type Props = { spaceId: string; data: unknown; questionBank?: boolean; pdfSessionId?: string; expectedPdfName?: string };

function questionsOf(value: unknown): SavedQuestion[] {
  if (!value || typeof value !== "object" || !("questions" in value)) return [];
  const q = (value as { questions?: unknown }).questions;
  if (!Array.isArray(q)) return [];
  return q.filter((v): v is SavedQuestion => !!v && typeof v.question === "string" && Array.isArray(v.options) && v.options.length === 4 && typeof v.answerIndex === "number" && v.answerIndex >= 0 && v.answerIndex <= 3 && typeof v.explanation === "string" && typeof v.source === "string");
}

export default function SpaceQuizDashboard({ spaceId, data, questionBank = false, pdfSessionId, expectedPdfName }: Props) {
  const questions = useMemo(() => questionsOf(data), [data]);
  const [tab, setTab] = useState<Tab>("overview");
  const [records, setRecords] = useState<Record<string, QuestionRecord>>({});
  const [order, setOrder] = useState<number[]>([]);
  const [round, setRound] = useState(0);
  const [error, setError] = useState("");
  const [reviewItems, setReviewItems] = useState<SavedQuestion[] | null>(null);

  useEffect(() => {
    const refresh = () => setRecords(loadSpaceRecords(spaceId));
    refresh();
    window.addEventListener(SPACE_PROGRESS_EVENT, refresh);
    return () => window.removeEventListener(SPACE_PROGRESS_EVENT, refresh);
  }, [spaceId]);

  const values = Object.values(records);
  const attempts = values.reduce((sum, r) => sum + r.attempts, 0);
  const correct = values.reduce((sum, r) => sum + r.correct, 0);
  const wrong = values.filter(r => r.wrong);
  const favorites = values.filter(r => r.favorite);
  const learned = questions.filter(q => (records[questionId(q)]?.attempts ?? 0) > 0).length;
  const total = questions.length;
  const requestedCount = data && typeof data === "object" && "requestedCount" in data && typeof data.requestedCount === "number" ? data.requestedCount : undefined;
  const title = questionBank ? "题库刷题空间" : "选择题学习空间";

  function start(random: boolean) {
    const indices = questions.map((_, i) => i);
    if (random) for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    setOrder(indices);
    setReviewItems(null);
    setRound(n => n + 1);
    setTab("all");
  }
  function startReview(list: QuestionRecord[]) {
    setReviewItems(list.map(r => r.question));
    setRound(n => n + 1);
    setTab("all");
  }
  function modify(action: () => void) {
    try { action(); setError(""); }
    catch { setError("操作未保存，请检查浏览器存储空间。"); }
  }

  const activeQuestions = reviewItems ?? (order.length ? order.map(i => questions[i]).filter(Boolean) : questions);
  const tabNames: [Tab, string][] = [["overview", "概览"], ["all", "刷题"], ["wrong", `错题 ${wrong.length}`], ["favorites", `收藏 ${favorites.length}`], ["stats", "统计"]];
  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><h3 className="text-lg font-semibold text-slate-800">{title}</h3><p className="mt-1 text-xs text-slate-500">学习记录只属于当前空间，原题与其他空间的练习互不混合。</p></div>
      <span className="rounded-full bg-indigo-50 px-3 py-1.5 text-xs text-indigo-700">共 {total} 题</span>
    </div>
    <nav className="flex flex-wrap gap-2" aria-label="学习空间功能">
      {tabNames.map(([id, label]) => <button key={id} type="button" onClick={() => setTab(id)} className={`rounded-lg px-3 py-2 text-sm ${tab === id ? "bg-indigo-600 text-white" : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}>{label}</button>)}
    </nav>
    {error && <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
    {tab === "overview" && <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[["总题目", total], ["已练习题目", learned], ["待复习错题", wrong.length], ["已收藏", favorites.length]].map(([name, value]) => <div key={name} className="rounded-xl bg-slate-50 p-4"><p className="text-xs text-slate-500">{name}</p><p className="mt-2 text-2xl font-semibold">{value}</p></div>)}
      </div>
      <p className="text-sm text-slate-600">累计答题 {attempts} 次，正确 {correct} 次；答题准确率 {attempts ? Math.round(correct / attempts * 100) : 0}%。</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => start(false)} className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm text-white">顺序刷题</button>
        <button type="button" onClick={() => start(true)} className="rounded-xl border border-indigo-200 px-5 py-2.5 text-sm text-indigo-700">随机刷题</button>
        <button type="button" disabled={!wrong.length} onClick={() => startReview(wrong)} className="rounded-xl border border-slate-200 px-5 py-2.5 text-sm disabled:opacity-40">复习错题</button>
      </div>
    </div>}
    {tab === "all" && <div className="space-y-3">
      <div className="flex flex-wrap gap-2"><button type="button" onClick={() => start(false)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs">按原顺序重新开始</button><button type="button" onClick={() => start(true)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs">随机重新开始</button></div>
      <EnhancedQuiz key={`${spaceId}-${round}`} data={{ title: reviewItems ? "错题专项练习" : questionBank ? "原题刷题" : "互动测验", questions: activeQuestions, requestedCount: reviewItems ? undefined : requestedCount }} spaceId={spaceId} reviewMode={!!reviewItems} pdfSessionId={pdfSessionId} expectedPdfName={expectedPdfName} />
    </div>}
    {(tab === "wrong" || tab === "favorites") && <div className="space-y-3">
      {(tab === "wrong" ? wrong : favorites).length === 0 && <p className="rounded-xl bg-slate-50 p-6 text-center text-sm text-slate-500">暂无{tab === "wrong" ? "错题" : "收藏题目"}。</p>}
      {(tab === "wrong" ? wrong : favorites).map(r => <article key={r.id} className="rounded-xl border border-slate-200 p-4">
        <p className="whitespace-pre-wrap text-sm font-medium">{r.question.question}</p>
        <p className="mt-2 text-xs text-slate-500">已答 {r.attempts} 次 · 答对 {r.correct} 次</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={() => startReview([r])} className="rounded-lg bg-indigo-50 px-3 py-2 text-xs text-indigo-700">重新练习</button>
          {tab === "wrong" && <button type="button" onClick={() => modify(() => removeSpaceWrong(spaceId, r.question))} className="rounded-lg border border-slate-200 px-3 py-2 text-xs">移出错题本</button>}
          <button type="button" onClick={() => modify(() => toggleSpaceFavorite(spaceId, r.question))} className="rounded-lg border border-slate-200 px-3 py-2 text-xs">{r.favorite ? "取消收藏" : "收藏"}</button>
          <button type="button" onClick={() => modify(() => deleteSpaceQuestionRecord(spaceId, r.question))} className="rounded-lg border border-rose-200 px-3 py-2 text-xs text-rose-700">删除练习记录</button>
        </div>
      </article>)}
    </div>}
    {tab === "stats" && <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {[["答题次数", attempts], ["答对次数", correct], ["正确率", `${attempts ? Math.round(correct / attempts * 100) : 0}%`], ["已练习题数", learned], ["错题数", wrong.length], ["收藏题数", favorites.length]].map(([label, value]) => <div key={label} className="rounded-xl bg-slate-50 p-4"><p className="text-xs text-slate-500">{label}</p><p className="mt-2 text-xl font-semibold">{value}</p></div>)}
    </div>}
  </div>;
}
