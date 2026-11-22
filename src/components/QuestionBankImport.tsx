"use client";

import { useEffect, useMemo, useState } from "react";

type Kind = "question_bank" | "notes" | "mixed" | "unknown";
type BankQuestion = {
  question: string;
  options: string[];
  answerIndex: number | null;
  answerEvidence: string;
  source: string;
  excluded?: boolean;
  reviewed?: boolean;
  answerOrigin?: "source" | "manual";
  originalNumber?: number;
  addedManually?: boolean;
};
type Analysis = {
  type: Kind;
  questions: BankQuestion[];
  extractedCount: number;
  withSourceAnswerCount: number;
  analyzedChunks: number;
  totalChunks: number;
  partial: boolean;
  warning: string;
  totalDetectedQuestions?: number;
  missingNumbers?: number[];
};
type Props = {
  material: string;
  sessionId: string;
  onCreateSpace: (data: {
    title: string;
    questions: {
      question: string;
      options: string[];
      answerIndex: number;
      explanation: string;
      source: string;
      originalNumber?: number;
    }[];
  }) => void;
};
type Filter = "all" | "unreviewed" | "unknown" | "confirmed" | "excluded";
const PAGE_SIZE = 20;
const letters = ["A", "B", "C", "D"];

// Original numbers are references to the imported document, not practice indices.
function numberOf(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 99999
    ? value : undefined;
}

function sortNumbered<T extends { q: BankQuestion; i: number }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const an = a.q.originalNumber;
    const bn = b.q.originalNumber;
    if (an === undefined && bn === undefined) return a.i - b.i;
    if (an === undefined) return 1;
    if (bn === undefined) return -1;
    return an - bn || a.i - b.i;
  });
}

function validAnalysis(input: unknown): Analysis | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const x = input as Record<string, unknown>;
  if (!Array.isArray(x.questions)) return null;
  const questions: BankQuestion[] = [];
  for (const entry of x.questions) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const q = entry as Record<string, unknown>;
    if (typeof q.question !== "string" || !Array.isArray(q.options) || q.options.length !== 4 || !q.options.every(v => typeof v === "string")) continue;
    const answerIndex = typeof q.answerIndex === "number" && Number.isInteger(q.answerIndex) && q.answerIndex >= 0 && q.answerIndex < 4 ? q.answerIndex : null;
    const answerEvidence = typeof q.answerEvidence === "string" ? q.answerEvidence : "";
    questions.push({
      question: q.question,
      options: [...q.options as string[]],
      answerIndex,
      answerEvidence,
      source: typeof q.source === "string" ? q.source : "",
      excluded: q.excluded === true,
      // Previous saved imports must never silently become user-confirmed.
      reviewed: q.reviewed === true,
      answerOrigin: q.answerOrigin === "manual" ? "manual" : answerEvidence ? "source" : answerIndex !== null ? "manual" : undefined,
      originalNumber: numberOf(q.originalNumber),
      addedManually: q.addedManually === true,
    });
  }
  const types: Kind[] = ["question_bank", "notes", "mixed", "unknown"];
  return {
    type: types.includes(x.type as Kind) ? x.type as Kind : "unknown",
    questions,
    extractedCount: questions.length,
    withSourceAnswerCount: questions.filter(q => q.answerIndex !== null && !!q.answerEvidence).length,
    analyzedChunks: typeof x.analyzedChunks === "number" ? x.analyzedChunks : 0,
    totalChunks: typeof x.totalChunks === "number" ? x.totalChunks : 0,
    partial: x.partial === true,
    warning: typeof x.warning === "string" ? x.warning : "",
    totalDetectedQuestions: typeof x.totalDetectedQuestions === "number" ? x.totalDetectedQuestions : undefined,
    missingNumbers: Array.isArray(x.missingNumbers) ? x.missingNumbers.filter((v): v is number => typeof v === "number" && Number.isInteger(v) && v > 0) : undefined,
  };
}

function validQuestion(q: BankQuestion): boolean {
  return q.question.trim().length > 0 && q.options.length === 4 && q.options.every(o => o.trim().length > 0) && q.answerIndex !== null;
}

export default function QuestionBankImport({ material, sessionId, onCreateSpace }: Props) {
  const key = `studyforge-question-bank-v101-${sessionId}`;
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<number | null>(null);
  const [showCreateReview, setShowCreateReview] = useState(false);
  const [bankTitle, setBankTitle] = useState("原题题库 · 独立练习空间");

  const fingerprint = useMemo(() => {
    let hash = 2166136261;
    for (let i = 0; i < material.length; i++) hash = Math.imul(hash ^ material.charCodeAt(i), 16777619);
    return `${material.length}-${(hash >>> 0).toString(16)}`;
  }, [material]);

  useEffect(() => {
    setReady(false);
    setAnalysis(null);
    setExpanded(false);
    setError("");
    setEditing(null);
    setShowCreateReview(false);
    setFilter("all");
    setPage(0);
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const stored: unknown = JSON.parse(raw);
        if (stored && typeof stored === "object" && !Array.isArray(stored)) {
          const record = stored as Record<string, unknown>;
          if (record.fingerprint === fingerprint) {
            const parsed = validAnalysis(record.analysis);
            if (parsed) { setAnalysis(parsed); setExpanded(true); }
          }
        }
      }
    } catch { /* Can still review in memory without localStorage. */ }
    setReady(true);
  }, [key, fingerprint]);

  useEffect(() => {
    if (!ready || !analysis) return;
    try { localStorage.setItem(key, JSON.stringify({ fingerprint, analysis })); }
    catch { setError("本地存储空间不足，题库核查修改可能无法在刷新后保留。"); }
  }, [key, fingerprint, analysis, ready]);

  async function analyze() {
    if (busy) return;
    // Explicit re-identification discards edits only after user confirmation.
    if (analysis && !window.confirm("重新识别会覆盖当前题库的人工修改及确认状态，确定继续吗？")) return;
    setBusy(true);
    setError("");
    setExpanded(true);
    const controller = new AbortController();
    try {
      const response = await fetch("/api/question-bank", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ material }),
        signal: controller.signal,
      });
      const payload: unknown = await response.json();
      const result = payload && typeof payload === "object" && !Array.isArray(payload) ? payload as Record<string, unknown> : {};
      if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : "题库识别失败");
      const parsed = validAnalysis(result.data);
      if (!parsed) throw new Error("题库结果格式异常");
      // All automatic answers are unreviewed, even when evidence is present.
      setAnalysis(parsed);
      setFilter("all");
      setPage(0);
      setEditing(null);
      setShowCreateReview(false);
    } catch (e) { setError(e instanceof Error ? e.message : "题库识别失败"); }
    finally { setBusy(false); }
  }

  function editQuestion(index: number, patch: Partial<BankQuestion>) {
    setShowCreateReview(false);
    setAnalysis(prev => prev ? {
      ...prev,
      questions: prev.questions.map((q, i) => i !== index ? q : { ...q, ...patch }),
    } : prev);
  }

  function editContent(index: number, patch: Partial<BankQuestion>) {
    // An edited question/option invalidates the original answer evidence.
    editQuestion(index, { ...patch, reviewed: false, answerEvidence: "", answerOrigin: "manual" });
  }

  function addQuestion() {
    const blank: BankQuestion = {
      question: "", options: ["", "", "", ""], answerIndex: null,
      answerEvidence: "", source: "", reviewed: false,
      answerOrigin: "manual", addedManually: true,
    };
    setAnalysis(prev => prev ? { ...prev, questions: [...prev.questions, blank] } : prev);
    setFilter("all");
    setQuery("");
    // Newly added unnumbered questions appear at the end of the sorted list.
    if (analysis) {
      setPage(Math.floor(analysis.questions.length / PAGE_SIZE));
      setEditing(analysis.questions.length);
    }
    setShowCreateReview(false);
  }

  function deleteManualQuestion(index: number) {
    if (!window.confirm("删除这道手动添加的题目？")) return;
    setAnalysis(prev => prev ? { ...prev, questions: prev.questions.filter((_, i) => i !== index) } : prev);
    setEditing(null);
    setShowCreateReview(false);
  }

  const questions = analysis?.questions ?? [];
  const included = questions.filter(q => !q.excluded);
  const confirmed = included.filter(q => q.reviewed && validQuestion(q));
  const waiting = included.filter(q => !q.reviewed || !validQuestion(q));
  const withoutAnswer = included.filter(q => q.answerIndex === null);
  const sourceAnswers = included.filter(q => q.answerIndex !== null && q.answerOrigin === "source");
  // Recompute missing numbers after manual additions and number corrections.
  // The original scan's missing-number range is retained; a user-added number
  // removes that number from the missing list without changing the scan totals.
  const existingNumbers = questions.map(q => q.originalNumber).filter((n): n is number => n !== undefined);
  const numberCounts = new Map<number, number>();
  for (const n of existingNumbers) numberCounts.set(n, (numberCounts.get(n) ?? 0) + 1);
  const duplicateNumbers = Array.from(numberCounts.entries())
    .filter(([, count]) => count > 1).map(([n]) => n).sort((a, b) => a - b);
  const stillMissingNumbers = (analysis?.missingNumbers ?? [])
    .filter(n => !numberCounts.has(n)).sort((a, b) => a - b);
  const typeName: Record<Kind, string> = { question_bank: "选择题题库", notes: "讲义 / 笔记", mixed: "混合材料", unknown: "暂未确定" };

  const visible = sortNumbered(questions.map((q, i) => ({ q, i })).filter(({ q }) => {
    if (filter === "unreviewed" && (q.excluded || (q.reviewed && validQuestion(q)))) return false;
    if (filter === "unknown" && (q.excluded || q.answerIndex !== null)) return false;
    if (filter === "confirmed" && (q.excluded || !q.reviewed || !validQuestion(q))) return false;
    if (filter === "excluded" && !q.excluded) return false;
    return !query.trim() || `${q.originalNumber ?? ""} ${q.question} ${q.options.join(" ")}`.toLowerCase().includes(query.trim().toLowerCase());
  }));
  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const currentRows = visible.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  function confirmAllAnswered() {
    const count = included.filter(q => !q.reviewed && validQuestion(q)).length;
    if (!count) return;
    if (!window.confirm(`你将确认 ${count} 道已有答案且结构完整的题目。请先与原文件核对；系统不会自动验证答案的知识正确性。确定批量确认吗？`)) return;
    setAnalysis(prev => prev ? { ...prev, questions: prev.questions.map(q => !q.excluded && validQuestion(q) ? { ...q, reviewed: true } : q) } : prev);
    setShowCreateReview(false);
  }

  function createSpace() {
    if (!analysis || !confirmed.length) return;
    if (duplicateNumbers.length && !window.confirm(
      `原始题号 ${duplicateNumbers.join("、")} 存在重复。继续将按当前显示顺序保留这些题目，不会覆盖或合并。确定创建学习空间吗？`
    )) return;
    const selected = sortNumbered(analysis.questions.map((q, i) => ({ q, i }))
      .filter(({ q }) => !q.excluded && q.reviewed && validQuestion(q))).map(({ q }) => q);
    onCreateSpace({
      title: bankTitle.trim() || "原题题库 · 独立练习空间",
      questions: selected.map(q => ({
        question: q.question.trim(),
        options: q.options.map(s => s.trim()),
        answerIndex: q.answerIndex as number,
        explanation: q.answerOrigin === "source" && q.answerEvidence
          ? `原文答案标记：${q.answerEvidence}（已由用户确认）`
          : "正确答案已由用户核查确认，请结合原始材料理解。",
        source: q.source || q.question.trim(),
        originalNumber: q.originalNumber,
      })),
    });
  }

  return (
    <section className="rounded-2xl border border-indigo-100 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-slate-800">原题导入 · 人工核查</h3>
          <p className="mt-1 text-xs text-slate-500">先核对题目和正确答案，再决定哪些题目进入独立刷题空间。</p>
        </div>
        <button type="button" onClick={() => analysis ? setExpanded(v => !v) : void analyze()} disabled={busy}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
          {busy ? "正在识别…" : analysis ? expanded ? "收起核查" : "继续核查" : "识别资料与原题"}
        </button>
      </div>
      {error && <p role="alert" className="mt-3 text-sm text-rose-600">{error}</p>}
      {expanded && analysis && (
        <div className="mt-4 space-y-4 border-t border-slate-100 pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-700">
            <span>资料类型：<strong>{typeName[analysis.type]}</strong></span>
            <span>已提取 <strong>{questions.length}</strong> 道 · 自动识别到答案 <strong>{sourceAnswers.length}</strong> 道</span>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ["已人工确认", confirmed.length],
              ["待核查", waiting.length],
              ["答案待填写", withoutAnswer.length],
              ["已排除", questions.length - included.length],
            ].map(([label, count]) => (
              <div key={String(label)} className="rounded-xl bg-slate-50 p-3">
                <p className="text-xs text-slate-500">{label}</p>
                <p className="mt-1 text-xl font-semibold text-slate-800">{count}</p>
              </div>
            ))}
          </div>
          {analysis.totalDetectedQuestions !== undefined && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs leading-6 text-slate-700">
              <p>原文检测到 {analysis.totalDetectedQuestions} 个题号；当前自动提取 {analysis.extractedCount} 道。题号检测仅针对结构明确的文档。</p>
              {!!stillMissingNumbers.length && (
                <p className="mt-1 text-amber-800">仍缺少的原始题号：{stillMissingNumbers.join("、")}。请对照原文件，必要时手动补充。</p>
              )}
            </div>
          )}
          {!!duplicateNumbers.length && (
            <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
              原始题号重复：{duplicateNumbers.join("、")}。请核对编号；重复题目不会被自动覆盖，创建空间时可选择保留。
            </p>
          )}
          {analysis.partial && <p className="rounded-xl bg-amber-50 p-3 text-xs text-amber-800">只完成了部分材料的提取。当前题量不能视为原文件全部题量。</p>}
          {analysis.warning && <p className="text-xs text-amber-700">{analysis.warning}</p>}
          <p className="text-xs leading-6 text-slate-600">“自动识别到答案”不等于“人工确认”。修改答案或题目后会取消该题的确认状态；已有核查结果自动保存在本浏览器。</p>
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs text-slate-600">显示</label>
            <select value={filter} onChange={e => { setFilter(e.target.value as Filter); setPage(0); setEditing(null); }} className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs">
              <option value="all">全部题目</option>
              <option value="unreviewed">待核查</option>
              <option value="unknown">答案待填写</option>
              <option value="confirmed">已确认</option>
              <option value="excluded">已排除</option>
            </select>
            <input value={query} onChange={e => { setQuery(e.target.value); setPage(0); }} placeholder="搜索题干或题号" className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-2 text-xs sm:max-w-xs" />
            <button type="button" onClick={addQuestion} className="rounded-lg border border-indigo-200 px-3 py-2 text-xs font-medium text-indigo-700">＋ 手动补充题目</button>
          </div>
          <div className="space-y-2">
            {currentRows.map(({ q, i }) => (
              <div key={`${fingerprint}-${i}`} className={`rounded-xl border p-3 ${q.excluded ? "border-slate-100 bg-slate-50" : q.reviewed ? "border-emerald-100" : "border-slate-200"}`}>
                <div className="flex flex-wrap items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-sm font-medium text-slate-800">
                      {q.originalNumber ? `原题 ${q.originalNumber}` : `第 ${i + 1} 题`}：{q.question || "（尚未填写题干）"}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {q.excluded ? "已排除" : q.reviewed && validQuestion(q) ? "✓ 已人工确认" : "待人工核查"} · 答案：{q.answerIndex === null ? "未填写" : letters[q.answerIndex]} · {q.answerOrigin === "source" ? "原文标记" : q.answerOrigin === "manual" ? "人工设定/编辑" : "无来源标记"}
                    </p>
                  </div>
                  <button type="button" onClick={() => setEditing(editing === i ? null : i)} className="shrink-0 rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-indigo-700">
                    {editing === i ? "收起" : "核查 / 编辑"}
                  </button>
                </div>
                {editing === i && (
                  <div className="mt-3 space-y-3 border-t border-slate-100 pt-3">
                    <label className="block max-w-xs text-xs font-medium text-slate-600">原始题号（可选）
                      <input type="number" min={1} max={99999} step={1} value={q.originalNumber ?? ""}
                        onChange={e => {
                          const value = e.target.value.trim();
                          if (value === "") editQuestion(i, { originalNumber: undefined });
                          else if (/^\d{1,5}$/.test(value)) {
                            const n = Number(value);
                            if (numberOf(n) !== undefined) editQuestion(i, { originalNumber: n });
                          }
                        }}
                        className="mt-1 block w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800" />
                      <span className="mt-1 block font-normal leading-5 text-slate-500">对应原文件中的题号；留空时排在末尾。修改题号不会取消答案确认。</span>
                      {q.originalNumber !== undefined && (numberCounts.get(q.originalNumber) ?? 0) > 1 &&
                        <span className="mt-1 block font-medium text-amber-700">题号 {q.originalNumber} 重复，请核对。</span>}
                    </label>
                    <label className="block text-xs font-medium text-slate-600">题干
                      <textarea value={q.question} rows={2} onChange={e => editContent(i, { question: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 p-2 text-sm text-slate-800" />
                    </label>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {q.options.map((opt, j) => (
                        <label key={j} className="block text-xs font-medium text-slate-600">选项 {letters[j]}
                          <textarea rows={2} value={opt} onChange={e => editContent(i, { options: q.options.map((v, k) => k === j ? e.target.value : v) })} className="mt-1 w-full rounded-lg border border-slate-200 p-2 text-sm text-slate-800" />
                        </label>
                      ))}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <label className="text-xs text-slate-600" htmlFor={`sf-bank-answer-${sessionId}-${i}`}>正确答案</label>
                      <select id={`sf-bank-answer-${sessionId}-${i}`} value={q.answerIndex ?? ""} onChange={e => editQuestion(i, {
                        answerIndex: e.target.value === "" ? null : Number(e.target.value),
                        reviewed: false, answerEvidence: "", answerOrigin: "manual",
                      })} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                        <option value="">尚未填写</option>
                        {letters.map((v, j) => <option key={v} value={j}>{v}</option>)}
                      </select>
                      {q.answerEvidence && <span className="break-all text-xs text-slate-500">识别证据：{q.answerEvidence}</span>}
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <label className="flex items-center gap-2 text-xs text-slate-700">
                        <input type="checkbox" checked={!q.excluded} onChange={e => editQuestion(i, { excluded: !e.target.checked, reviewed: false })} />保留此题
                      </label>
                      <div className="flex flex-wrap items-center gap-2">
                        {q.addedManually && <button type="button" onClick={() => deleteManualQuestion(i)} className="rounded-lg px-3 py-2 text-xs text-rose-600">删除手动添加题目</button>}
                        <button type="button" disabled={q.excluded || !validQuestion(q)} onClick={() => { editQuestion(i, { reviewed: true }); setEditing(null); }} className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-medium text-white disabled:opacity-40">
                          {q.reviewed ? "保持确认" : "确认此题无误"}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
            {!visible.length && <p className="rounded-xl bg-slate-50 p-5 text-center text-sm text-slate-500">当前筛选条件下没有题目。</p>}
          </div>
          {pageCount > 1 && (
            <div className="flex items-center justify-between text-xs text-slate-500">
              <button type="button" disabled={safePage === 0} onClick={() => { setPage(p => Math.max(0, p - 1)); setEditing(null); }} className="rounded-lg border px-3 py-2 disabled:opacity-40">上一页</button>
              <span>第 {safePage + 1} / {pageCount} 页 · 共 {visible.length} 题</span>
              <button type="button" disabled={safePage + 1 >= pageCount} onClick={() => { setPage(p => p + 1); setEditing(null); }} className="rounded-lg border px-3 py-2 disabled:opacity-40">下一页</button>
            </div>
          )}
          <div className="space-y-3 border-t border-slate-200 pt-4">
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" onClick={confirmAllAnswered} disabled={!included.some(q => !q.reviewed && validQuestion(q))} className="rounded-lg border border-indigo-200 px-3 py-2 text-xs text-indigo-700 disabled:opacity-40">批量确认有答案且结构完整的题目</button>
              <span className="text-xs text-slate-500">仍需逐题核对原文；批量确认是用户主动操作。</span>
            </div>
            <label className="block text-xs font-medium text-slate-600">学习空间名称
              <input value={bankTitle} maxLength={100} onChange={e => setBankTitle(e.target.value)} className="mt-1 block w-full max-w-lg rounded-lg border border-slate-200 px-3 py-2 text-sm" />
            </label>
            {!showCreateReview ? (
              <button type="button" disabled={confirmed.length === 0} onClick={() => setShowCreateReview(true)} className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white disabled:opacity-40">
                检查导入范围（已确认 {confirmed.length} 题）
              </button>
            ) : (
              <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-4 text-sm leading-7 text-slate-700">
                <p className="font-semibold">最后确认导入范围</p>
                <p>将创建包含 {confirmed.length} 道人工确认题目的独立刷题空间。</p>
                <p>另外 {waiting.length} 道待核查题目、{questions.length - included.length} 道已排除题目将不会进入此次空间，但仍保留在当前导入核查记录中。</p>
                {!!stillMissingNumbers.length && <p>原文件仍有 {stillMissingNumbers.length} 个题号未成功提取或补充：{stillMissingNumbers.join("、")}。</p>}
                {!!duplicateNumbers.length && <p className="text-amber-800">当前存在重复原始题号：{duplicateNumbers.join("、")}。系统不会自动删除或合并。</p>}
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" onClick={createSpace} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white">确认，仅导入已核查题目</button>
                  <button type="button" onClick={() => setShowCreateReview(false)} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm">返回继续核查</button>
                </div>
              </div>
            )}
          </div>
          <button type="button" onClick={() => { void analyze(); }} disabled={busy} className="text-xs text-indigo-600 hover:underline">重新识别原文件（会覆盖人工修改）</button>
        </div>
      )}
    </section>
  );
}
