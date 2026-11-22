"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import EnhancedQuiz from "@/components/EnhancedQuiz";
import SpaceQuizDashboard from "@/components/SpaceQuizDashboard";
import StudyWidgets from "@/components/StudyWidgets";

type Concept = { id: string; name: string; source: string; weight: number };
type FollowUp = { question: string; answer: string; evidence?: string };
type Explanation = {
  explanation: string;
  analogy: string;
  keyPoint: string;
  evidence: string;
  followUps: FollowUp[];
};
type Tab = "concepts" | "graph" | "practice";

type Props = {
  graphData: unknown;
  spaceId?: string;
  pdfSessionId?: string;
  expectedPdfName?: string;
  material: string;
  practiceData?: unknown;
  explanations?: Record<string, unknown>;
  onPracticeGenerated?: (data: unknown) => void;
  onExplanationGenerated?: (conceptId: string, data: unknown) => void;
};

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function explanationOf(value: unknown): Explanation | null {
  if (!record(value) || typeof value.explanation !== "string" || !value.explanation.trim()) return null;
  return {
    explanation: value.explanation,
    analogy: typeof value.analogy === "string" ? value.analogy : "",
    keyPoint: typeof value.keyPoint === "string" ? value.keyPoint : "",
    evidence: typeof value.evidence === "string" ? value.evidence : "",
    followUps: Array.isArray(value.followUps)
      ? value.followUps.filter((item): item is Record<string, unknown> => record(item))
        .filter(item => typeof item.question === "string" && typeof item.answer === "string")
        .map(item => ({
          question: String(item.question),
          answer: String(item.answer),
          evidence: typeof item.evidence === "string" ? item.evidence : "",
        })).slice(-12)
      : [],
  };
}

export default function ConceptLearningSpace({ graphData, spaceId, pdfSessionId, expectedPdfName, material, practiceData, explanations, onPracticeGenerated, onExplanationGenerated }: Props) {
  const [tab, setTab] = useState<Tab>("concepts");
  const [selectedId, setSelectedId] = useState("");
  const [showEvidence, setShowEvidence] = useState(false);
  const [explaining, setExplaining] = useState(false);
  const [explainError, setExplainError] = useState("");
  const [temporaryExplanations, setTemporaryExplanations] = useState<Record<string, unknown>>({});
  const [followUpText, setFollowUpText] = useState("");
  const [followUpLoading, setFollowUpLoading] = useState(false);
  const [followUpError, setFollowUpError] = useState("");
  const followUpRequest = useRef<AbortController | null>(null);
  const [questionCount, setQuestionCount] = useState(5);
  const [quizLoading, setQuizLoading] = useState(false);
  const [quizError, setQuizError] = useState("");
  const [temporaryQuiz, setTemporaryQuiz] = useState<unknown>(null);
  const [quizRevision, setQuizRevision] = useState(0);
  const explainRequest = useRef<AbortController | null>(null);
  const quizRequest = useRef<AbortController | null>(null);

  const concepts = useMemo(() => {
    if (!record(graphData) || !Array.isArray(graphData.nodes)) return [] as Concept[];
    const seen = new Set<string>();
    const result: Concept[] = [];
    graphData.nodes.forEach((item, index) => {
      if (!record(item) || typeof item.name !== "string" || !item.name.trim()) return;
      const id = typeof item.id === "string" && item.id.trim() ? item.id : `concept-${index}`;
      if (seen.has(id)) return;
      seen.add(id);
      result.push({
        id,
        name: item.name.trim(),
        source: typeof item.source === "string" ? item.source.trim() : "",
        weight: typeof item.weight === "number" ? item.weight : 3,
      });
    });
    return result;
  }, [graphData]);

  const currentId = selectedId && concepts.some(c => c.id === selectedId) ? selectedId : concepts[0]?.id ?? "";
  const concept = concepts.find(c => c.id === currentId);
  const explanation = currentId ? explanationOf(temporaryExplanations[currentId] ?? explanations?.[currentId]) : null;
  const quiz = temporaryQuiz ?? practiceData;

  useEffect(() => () => {
    explainRequest.current?.abort();
    quizRequest.current?.abort();
    followUpRequest.current?.abort();
  }, []);

  async function requestExplanation() {
    if (!concept || explaining) return;
    explainRequest.current?.abort();
    const controller = new AbortController();
    explainRequest.current = controller;
    setExplaining(true); setExplainError("");
    try {
      const response = await fetch("/api/agent/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ material, concept: concept.name, source: concept.source }),
        signal: controller.signal,
      });
      const result: { data?: unknown; error?: string } = await response.json();
      if (!response.ok || !explanationOf(result.data)) throw new Error(result.error || "讲解生成失败");
      if (controller.signal.aborted) return;
      setTemporaryExplanations(prev => ({ ...prev, [concept.id]: result.data }));
      onExplanationGenerated?.(concept.id, result.data);
    } catch (error) {
      if (!controller.signal.aborted) setExplainError(error instanceof Error ? error.message : "讲解生成失败");
    } finally {
      if (explainRequest.current === controller) { setExplaining(false); explainRequest.current = null; }
    }
  }

  async function requestFollowUp(question: string) {
    const prompt = question.trim();
    if (!concept || !explanation || !prompt || followUpLoading || prompt.length > 600) return;
    followUpRequest.current?.abort();
    const controller = new AbortController();
    followUpRequest.current = controller;
    const conceptAtRequest = concept;
    const base = explanation;
    setFollowUpLoading(true);
    setFollowUpError("");
    try {
      const response = await fetch("/api/agent/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          material,
          concept: conceptAtRequest.name,
          source: conceptAtRequest.source,
          followUp: prompt,
          previousExplanation: base.explanation,
          history: base.followUps.slice(-5),
        }),
        signal: controller.signal,
      });
      const result: { data?: unknown; error?: string } = await response.json();
      if (!response.ok || !record(result.data) || typeof result.data.answer !== "string" || !result.data.answer.trim()) {
        throw new Error(result.error || "继续讲解失败");
      }
      if (controller.signal.aborted) return;
      const next: Explanation = {
        ...base,
        followUps: [...base.followUps, {
          question: prompt,
          answer: result.data.answer,
          evidence: typeof result.data.evidence === "string" ? result.data.evidence : "",
        }].slice(-12),
      };
      setTemporaryExplanations(prev => ({ ...prev, [conceptAtRequest.id]: next }));
      onExplanationGenerated?.(conceptAtRequest.id, next);
      setFollowUpText("");
    } catch (error) {
      if (!controller.signal.aborted) setFollowUpError(error instanceof Error ? error.message : "继续讲解失败");
    } finally {
      if (followUpRequest.current === controller) {
        followUpRequest.current = null;
        setFollowUpLoading(false);
      }
    }
  }

  async function requestQuiz() {
    if (quizLoading) return;
    quizRequest.current?.abort();
    const controller = new AbortController();
    quizRequest.current = controller;
    setQuizLoading(true); setQuizError("");
    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          material,
          mode: "quiz",
          quizSettings: { scope: "comprehensive", topic: "", count: questionCount },
        }),
      });
      const result: { data?: unknown; error?: string } = await response.json();
      if (!response.ok || !record(result.data) || !Array.isArray(result.data.questions) || result.data.questions.length === 0) {
        throw new Error(result.error || "未能生成可用的理解检查题");
      }
      if (controller.signal.aborted) return;
      setTemporaryQuiz(result.data);
      setQuizRevision(v => v + 1);
      onPracticeGenerated?.(result.data);
    } catch (error) {
      if (!controller.signal.aborted) setQuizError(error instanceof Error ? error.message : "练习生成失败");
    } finally {
      if (quizRequest.current === controller) { setQuizLoading(false); quizRequest.current = null; }
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-slate-800">循序理解</h3>
          <p className="mt-1 text-xs text-slate-500">先理解概念，再探索关联，最后用题目验证。顺序由你决定。</p>
        </div>
        <span className="rounded-full bg-indigo-50 px-3 py-1 text-xs text-indigo-700">{concepts.length} 个概念</span>
      </div>
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="学习活动">
        {([ ["concepts", "概念理解"], ["graph", "知识关系"], ["practice", "理解检查"] ] as const).map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}
            className={`rounded-xl px-4 py-2 text-sm font-medium transition ${tab === key ? "bg-indigo-600 text-white" : "border border-slate-200 bg-white text-slate-600 hover:bg-indigo-50"}`}>{label}</button>
        ))}
      </div>
      {tab === "concepts" && (
        <div className="grid min-w-0 gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
          <div className="max-h-[440px] space-y-1 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-2" aria-label="概念列表">
            {concepts.length ? concepts.map((item, index) => (
              <button key={item.id} type="button" onClick={() => {
                explainRequest.current?.abort();
                followUpRequest.current?.abort();
                setExplaining(false);
                setFollowUpLoading(false);
                setSelectedId(item.id);
                setShowEvidence(false);
                setExplainError("");
                setFollowUpError("");
                setFollowUpText("");
              }}
                className={`w-full rounded-lg px-3 py-2.5 text-left text-sm ${currentId === item.id ? "bg-white font-semibold text-indigo-700 shadow-sm" : "text-slate-700 hover:bg-white/80"}`}>
                {index + 1}. {item.name}
              </button>
            )) : <p className="p-3 text-sm text-slate-500">没有可用的概念节点，可以切换到知识关系查看原始结果。</p>}
          </div>
          <div className="min-w-0 rounded-xl border border-slate-200 p-4 sm:p-5">
            {concept ? (
              <div className="space-y-4">
                <div>
                  <p className="text-xs text-indigo-600">正在理解</p>
                  <h4 className="mt-1 text-lg font-semibold text-slate-800">{concept.name}</h4>
                </div>
                {explanation ? (
                  <div className="space-y-3 text-sm leading-7 text-slate-700">
                    <p className="whitespace-pre-wrap">{explanation.explanation}</p>
                    {explanation.analogy && <div className="rounded-xl bg-indigo-50 px-4 py-3"><p className="font-medium text-indigo-800">帮助理解的例子或类比</p><p className="mt-1 whitespace-pre-wrap text-slate-700">{explanation.analogy}</p></div>}
                    {explanation.keyPoint && <p><strong>抓住关键：</strong>{explanation.keyPoint}</p>}
                    <p className="text-xs text-slate-400">以上解释由 AI 依据材料生成；类比仅用于帮助理解。</p>
                    <div className="border-t border-slate-100 pt-4 space-y-3">
                      <h5 className="font-semibold text-slate-800">还有哪里没听懂？</h5>
                      <div className="flex flex-wrap gap-2">
                        {[
                          "能再简单一点解释吗？",
                          "请举一个具体例子",
                          "请分步骤解释这个概念",
                        ].map(prompt => (
                          <button key={prompt} type="button" disabled={followUpLoading}
                            onClick={() => void requestFollowUp(prompt)}
                            className="rounded-lg border border-indigo-100 bg-indigo-50 px-3 py-2 text-xs text-indigo-700 hover:bg-indigo-100 disabled:opacity-50">
                            {prompt}
                          </button>
                        ))}
                      </div>
                      {explanation.followUps.map((item, index) => (
                        <div key={`${currentId}-${index}`} className="space-y-2 rounded-xl border border-slate-100 p-3">
                          <p className="text-sm font-medium text-slate-800">你：{item.question}</p>
                          <p className="whitespace-pre-wrap text-sm leading-7 text-slate-700">{item.answer}</p>
                          {item.evidence && <details className="text-xs text-slate-500"><summary className="cursor-pointer text-indigo-600">查看引用</summary><p className="mt-2 whitespace-pre-wrap break-words">{item.evidence}</p></details>}
                        </div>
                      ))}
                      <form onSubmit={event => { event.preventDefault(); void requestFollowUp(followUpText); }} className="space-y-2">
                        <label htmlFor="sf-concept-follow-up" className="sr-only">继续追问当前概念</label>
                        <textarea id="sf-concept-follow-up" value={followUpText} maxLength={600}
                          onChange={event => setFollowUpText(event.target.value)} rows={2}
                          placeholder="例如：这一步为什么成立？我还是不理解公式的含义。"
                          className="w-full resize-y rounded-xl border border-slate-200 bg-white p-3 text-sm outline-none focus:border-indigo-400" />
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <button type="button" onClick={() => setTab("graph")}
                            className="text-xs text-indigo-600 hover:underline">去知识图谱中探索关联 →</button>
                          <button type="submit" disabled={followUpLoading || !followUpText.trim()}
                            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
                            {followUpLoading ? "正在解答..." : "继续提问"}
                          </button>
                        </div>
                      </form>
                      {followUpError && <p role="alert" className="text-sm text-rose-600">{followUpError}</p>}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-sm text-slate-600">可以先查看原文，再让 AI 用更容易理解的方式讲解这个概念。</p>
                    <button type="button" onClick={() => void requestExplanation()} disabled={explaining}
                      className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
                      {explaining ? "正在组织讲解..." : "用通俗方式讲解"}
                    </button>
                  </div>
                )}
                {explainError && <div className="space-y-2"><p role="alert" className="text-sm text-rose-600">{explainError}</p><button type="button" className="text-sm text-indigo-600" onClick={() => void requestExplanation()}>重试讲解</button></div>}
                {concept.source && (
                  <div>
                    <button type="button" onClick={() => setShowEvidence(v => !v)} className="text-xs font-medium text-indigo-600 hover:underline">{showEvidence ? "收起原文摘录 ↑" : "查看原文摘录 ↓"}</button>
                    {showEvidence && <blockquote className="mt-2 whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-3 text-xs leading-6 text-slate-600">{concept.source}</blockquote>}
                  </div>
                )}
              </div>
            ) : <p className="text-sm text-slate-500">暂无可用概念。</p>}
          </div>
        </div>
      )}
      {tab === "graph" && <div className="min-w-0"><StudyWidgets mode="graph" data={graphData} /></div>}
      {tab === "practice" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div>
              <h4 className="font-semibold text-slate-800">理解检查</h4>
              <p className="mt-1 text-xs text-slate-500">根据当前学习范围生成题目；错题、收藏与统计只保存在本学习空间。</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor="sf-concept-question-count" className="text-xs text-slate-600">题量</label>
              <select id="sf-concept-question-count" value={questionCount} onChange={e => setQuestionCount(Number(e.target.value))}
                className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm">
                {[5, 10, 15, 20].map(value => <option key={value} value={value}>{value} 题</option>)}
              </select>
              <button type="button" onClick={() => void requestQuiz()} disabled={quizLoading}
                className="rounded-lg bg-indigo-600 px-3 py-2 text-sm text-white hover:bg-indigo-700 disabled:opacity-50">
                {quizLoading ? "正在生成..." : quiz ? "重新生成" : "生成理解检查"}
              </button>
            </div>
          </div>
          {quizError && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{quizError}</p>}
          {quiz ? (spaceId ? <SpaceQuizDashboard key={quizRevision} data={quiz} spaceId={spaceId} pdfSessionId={pdfSessionId} expectedPdfName={expectedPdfName} /> : <EnhancedQuiz key={quizRevision} data={quiz} pdfSessionId={pdfSessionId} expectedPdfName={expectedPdfName} />) : <p className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-500">需要时再生成理解检查题。可以先阅读概念或探索知识关系。</p>}
        </div>
      )}
    </div>
  );
}
