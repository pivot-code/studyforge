"use client";

import { useEffect, useRef, useState } from "react";

export type AgentMode = "question_bank" | "quiz" | "flashcards" | "graph" | "keywords";
export type AgentSelection = {
  mode: AgentMode;
  topic: string;
  scopedMaterial?: string;
  count?: number;
  detail?: "concise" | "standard" | "detailed";
  experience?: "concept_path";
};
type Topic = { id: string; title: string; evidence: string };
type Stage = { id: string; title: string; goal: string; topicIds: string[]; recommendedMode: AgentMode };
type Plan = {
  materialType: "question_bank" | "notes" | "mixed" | "unknown";
  recommendedMode: AgentMode;
  title: string;
  reason: string;
  outline: Topic[];
  stages: Stage[];
  caution: string;
  partialMaterial: boolean;
};
const names: Record<AgentMode, string> = {
  question_bank: "原题练习", quiz: "选择题测验", flashcards: "智能闪卡", graph: "知识逻辑图", keywords: "核心词速览",
};
const types: Record<Plan["materialType"], string> = {
  question_bank: "题库", notes: "讲义 / 笔记", mixed: "混合材料", unknown: "学习资料",
};

type Props = {
  sessionId: string;
  material: string;
  materialForGoal?: (goal: string) => string;
  initialGoal?: string;
  requestKey?: number;
  disabled?: boolean;
  onSelect: (selection: AgentSelection) => void;
};

export default function AgentPlanner({ sessionId, material, materialForGoal, initialGoal = "", requestKey = 0, disabled = false, onSelect }: Props) {
  const [goal, setGoal] = useState("");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [planMaterial, setPlanMaterial] = useState(material);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [stageId, setStageId] = useState("");
  const [modeOverride, setModeOverride] = useState<AgentMode | null>(null);
  const [count, setCount] = useState(15);
  const [detail, setDetail] = useState<"concise" | "standard" | "detailed">("standard");
  const [showOutline, setShowOutline] = useState(false);
  const [showAllStages, setShowAllStages] = useState(false);
  const [conceptPath, setConceptPath] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const previousRequest = useRef(0);

  useEffect(() => {
    controller.current?.abort();
    setPlan(null); setPlanMaterial(material); setGoal(""); setError(""); setStageId(""); setModeOverride(null); setLoading(false); setShowOutline(false); setShowAllStages(false); setConceptPath(false);
    return () => controller.current?.abort();
  }, [sessionId, material]);

  async function analyze(target: string) {
    const trimmed = target.trim();
    if (!trimmed || loading || disabled) return;
    controller.current?.abort();
    const task = new AbortController();
    controller.current = task;
    setLoading(true); setError(""); setPlan(null); setStageId(""); setModeOverride(null);
    const currentMaterial = materialForGoal ? materialForGoal(trimmed) : material;
    try {
      const response = await fetch("/api/agent/plan", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ material: currentMaterial, goal: trimmed }), signal: task.signal,
      });
      const result: { data?: Plan; error?: string } = await response.json();
      if (!response.ok || !result.data) throw new Error(result.error || "无法生成学习方案");
      if (!task.signal.aborted) {
        setPlan(result.data);
        setPlanMaterial(currentMaterial);
        setStageId(result.data.stages[0]?.id ?? "");
        setCount(15);
        setConceptPath(/学不进|学不懂|看不懂|听不懂|不理解|概念混乱|理不清|入门|从零|搞不懂/.test(trimmed));
        setShowOutline(false);
        setShowAllStages(false);
      }
    } catch (e) {
      if (!task.signal.aborted) setError(e instanceof Error ? e.message : "请求失败");
    } finally {
      if (controller.current === task) { setLoading(false); controller.current = null; }
    }
  }

  useEffect(() => {
    if (!requestKey || requestKey === previousRequest.current || !initialGoal) return;
    previousRequest.current = requestKey;
    setGoal(initialGoal);
    void analyze(initialGoal);
    // Parent invokes this only on a new explicit user request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey]);

  const stage = plan?.stages.find(s => s.id === stageId);
  const selectedMode = modeOverride ?? stage?.recommendedMode ?? plan?.recommendedMode ?? "graph";
  const stageTopics = plan && stage ? stage.topicIds.map(id => plan.outline.find(t => t.id === id)?.title).filter((t): t is string => !!t) : [];
  // Topic strings are passed only to generation endpoints that implement focused generation.
  const topic = stageTopics.join("；").slice(0, 120);
  const canFocus = selectedMode === "quiz" || selectedMode === "flashcards" || selectedMode === "graph" || selectedMode === "keywords";
  const usedScope = !!stage && canFocus && !!topic;
  // Build stage material only from literal excerpts located within the uploaded text.
  // This is grounded context selection, not AI-written replacement material.
  function getScopedMaterial(): string {
    if (!plan || !stage) return "";
    const pieces: string[] = [];
    for (const id of stage.topicIds) {
      const item = plan.outline.find(t => t.id === id);
      if (!item) continue;
      const evidence = item.evidence.trim();
      const anchors = [evidence, evidence.slice(0, 35), item.title].filter(s => s.length >= 5);
      let index = -1;
      let length = 0;
      for (const anchor of anchors) {
        index = planMaterial.indexOf(anchor);
        if (index >= 0) { length = anchor.length; break; }
      }
      if (index < 0) continue;
      const start = Math.max(0, index - 320);
      const end = Math.min(planMaterial.length, index + length + 650);
      const passage = planMaterial.slice(start, end);
      if (!pieces.includes(passage)) pieces.push(passage);
    }
    return pieces.join("\n\n---\n\n").slice(0, 14000);
  }
  const scopedMaterial = usedScope ? getScopedMaterial() : "";
  const scopeAvailable = !usedScope || Boolean(scopedMaterial.trim());
  const actualCount = selectedMode === "flashcards" ? Math.min(count, 50) : Math.min(count, 30);

  function launch() {
    if (!plan) return;
    onSelect({
      mode: selectedMode,
      topic: usedScope && (selectedMode === "quiz" || selectedMode === "flashcards" || scopeAvailable) ? topic : "",
      ...(usedScope && scopeAvailable && (selectedMode === "graph" || selectedMode === "keywords") ? { scopedMaterial } : {}),
      ...(selectedMode === "quiz" || selectedMode === "flashcards" ? { count: actualCount } : {}),
      ...(selectedMode === "flashcards" ? { detail } : {}),
      ...(selectedMode === "graph" && conceptPath ? { experience: "concept_path" as const } : {}),
    });
  }

  return (
    <section className="rounded-2xl border border-indigo-100 bg-white p-4 shadow-sm sm:p-5" aria-label="智能学习方案">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-base font-semibold text-slate-800">智能学习方案</h3>
        <span className="text-xs text-slate-400">学习顺序和方式由你决定</span>
      </div>
      <form onSubmit={e => { e.preventDefault(); void analyze(goal); }} className="flex flex-col gap-2 sm:flex-row">
        <input value={goal} onChange={e => setGoal(e.target.value)} maxLength={600}
          disabled={loading || disabled} placeholder="例如：这份课件我学不进去"
          className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-indigo-400"
          aria-label="我的学习目标" />
        <button type="submit" disabled={!goal.trim() || loading || disabled}
          className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
          {loading ? "正在规划..." : "生成学习方案"}
        </button>
      </form>
      {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
      {plan && (
        <div className="mt-3 space-y-3 border-t border-slate-100 pt-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-lg bg-indigo-50 px-2 py-1 text-xs text-indigo-700">{types[plan.materialType]}</span>
            <strong className="text-sm text-slate-800">{plan.title}</strong>
          </div>
          <p className="text-sm leading-6 text-slate-600">{plan.reason}</p>
          {plan.partialMaterial && <p className="text-xs text-amber-700">资料较长，本次分析了部分内容；知识结构可能不完整。</p>}
          {plan.caution && <p className="text-xs text-amber-700">{plan.caution}</p>}
          <div className="rounded-xl border border-slate-200 p-3">
            <button type="button" onClick={() => setShowOutline(v => !v)}
              className="flex w-full items-center justify-between text-left text-sm font-medium text-slate-800"
              aria-expanded={showOutline}>
              <span>已识别知识结构（{plan.outline.length} 项）</span>
              <span className="text-xs text-indigo-600">{showOutline ? "收起" : "展开查看"}</span>
            </button>
            {showOutline && (
              <ol className="mt-3 list-inside list-decimal space-y-2 text-sm text-slate-600">
                {plan.outline.map(t => <li key={t.id}>{t.title}</li>)}
              </ol>
            )}
          </div>
          <div>
            <h4 className="mb-2 text-sm font-semibold text-slate-800">学习阶段（{plan.stages.length}）</h4>
            <p className="mb-3 text-xs text-slate-500">任选一阶段开始，也可以直接学习整份资料。</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {plan.stages.slice(0, showAllStages ? undefined : 4).map((s, i) => (
                <button type="button" key={s.id} onClick={() => { setStageId(s.id); setModeOverride(null); }}
                  aria-pressed={stageId === s.id}
                  className={`w-full rounded-xl border p-3 text-left ${stageId === s.id ? "border-indigo-400 bg-indigo-50" : "border-slate-200 hover:border-indigo-200"}`}>
                  <span className="text-sm font-medium text-slate-800">{i + 1}. {s.title}</span>
                  {stageId === s.id && <span className="mt-1 block text-xs leading-5 text-slate-500">{s.goal}</span>}
                  <span className="mt-1 block text-xs text-indigo-600">{s.topicIds.length} 个知识点 · 建议：{names[s.recommendedMode]}</span>
                </button>
              ))}
              {plan.stages.length > 4 && <button type="button" onClick={() => setShowAllStages(v => !v)}
                className="rounded-xl border border-dashed border-slate-200 p-3 text-left text-xs font-medium text-indigo-600 hover:bg-indigo-50">
                {showAllStages ? "收起阶段" : `查看全部 ${plan.stages.length} 个阶段`}
              </button>}
              <button type="button" onClick={() => { setStageId(""); setModeOverride(null); }}
                aria-pressed={!stageId}
                className={`w-full rounded-xl border p-3 text-left text-sm ${!stageId ? "border-indigo-400 bg-indigo-50 text-indigo-800" : "border-slate-200 text-slate-600 hover:border-indigo-200"}`}>
                整份资料自由学习
              </button>
            </div>
          </div>
          {stage && <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">
            本阶段：{stageTopics.join("、")}
          </div>}
          <div className="space-y-3 border-t border-slate-100 pt-3">
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor={`sf-agent-mode-${sessionId}`} className="text-sm text-slate-600">学习方式</label>
              <select id={`sf-agent-mode-${sessionId}`} value={selectedMode}
                onChange={e => setModeOverride(e.target.value as AgentMode)}
                className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                {(Object.keys(names) as AgentMode[]).map(m => <option key={m} value={m}>{names[m]}{m === (stage?.recommendedMode ?? plan.recommendedMode) ? "（推荐）" : ""}</option>)}
              </select>
            </div>
            {(selectedMode === "quiz" || selectedMode === "flashcards") && (
              <div className="flex flex-wrap items-center gap-3">
                <label className="text-sm text-slate-600" htmlFor={`sf-agent-count-${sessionId}`}>生成数量</label>
                <input id={`sf-agent-count-${sessionId}`} type="number" min={5} max={selectedMode === "quiz" ? 30 : 50}
                  value={actualCount} onChange={e => setCount(Math.max(5, Math.min(50, Number(e.target.value) || 5)))}
                  className="w-24 rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                <span className="text-xs text-slate-500">{selectedMode === "quiz" ? "5–30 题" : "5–50 张"}</span>
              </div>
            )}
            {selectedMode === "flashcards" && (
              <div className="flex items-center gap-3">
                <label htmlFor={`sf-agent-detail-${sessionId}`} className="text-sm text-slate-600">答案详细程度</label>
                <select id={`sf-agent-detail-${sessionId}`} value={detail} onChange={e => setDetail(e.target.value as typeof detail)}
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
                  <option value="concise">精简</option><option value="standard">标准</option><option value="detailed">详细</option>
                </select>
              </div>
            )}
            {selectedMode === "graph" && (
              <label className="flex items-start gap-2 rounded-lg border border-indigo-100 bg-indigo-50/50 px-3 py-2.5 text-sm text-slate-700">
                <input type="checkbox" className="mt-1 accent-indigo-600" checked={conceptPath} onChange={e => setConceptPath(e.target.checked)} />
                <span><strong className="font-medium">创建综合理解空间</strong><span className="mt-0.5 block text-xs text-slate-500">概念讲解、知识关系探索与理解检查，可自由切换。</span></span>
              </label>
            )}
            {stage && selectedMode === "question_bank" && <p className="text-xs text-slate-500">原题导入使用整个题库，不改变原题内容。</p>}
            {usedScope && (selectedMode === "quiz" || selectedMode === "flashcards") && <p className="text-xs text-slate-500">本次生成将聚焦所选阶段的知识点。</p>}
            {usedScope && (selectedMode === "graph" || selectedMode === "keywords") && scopeAvailable && <p className="text-xs text-slate-500">将使用当前阶段在原材料中对应的相关段落。</p>}
            {usedScope && (selectedMode === "graph" || selectedMode === "keywords") && !scopeAvailable && <p className="text-xs text-amber-700">无法可靠定位本阶段的原文范围，将使用整份资料。</p>}
            <button type="button" onClick={launch} disabled={disabled || loading}
              className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
              开始学习
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
