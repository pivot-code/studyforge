"use client";

import { useEffect, useRef, useState } from "react";
import PdfEvidenceViewer from "@/components/PdfEvidenceViewer";

type Topic = {
  id: string;
  name: string;
  source: string;
  questionIndexes: number[];
  questionCount: number;
  covered: boolean;
  sourceQuality?: "readable" | "unreadable";
};

type CoverageResult = {
  topics: Topic[];
  summary: {
    topicCount: number;
    coveredTopicCount: number;
    uncoveredTopicCount: number;
    estimatedCoveragePercent: number;
    questionCount: number;
    unassignedQuestionCount: number;
    rejectedLowQualitySources?: number;
  };
  uncoveredQuestionIndexes: number[];
  duplicateGroups: number[][];
  methodology: string;
};

type Props = {
  material: string;
  quizData: unknown;
  pdfSessionId?: string;
  expectedPdfName?: string;
};

type Question = { question: string; source?: string };

function extractQuestions(data: unknown): Question[] {
  if (!data || typeof data !== "object" || Array.isArray(data)) return [];
  const questions = (data as { questions?: unknown }).questions;
  if (!Array.isArray(questions)) return [];
  return questions.flatMap((item): Question[] => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const q = item as { question?: unknown; source?: unknown };
    if (typeof q.question !== "string" || !q.question.trim()) return [];
    return [{
      question: q.question,
      ...(typeof q.source === "string" ? { source: q.source } : {}),
    }];
  });
}

function isCoverageResult(value: unknown): value is CoverageResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const result = value as Partial<CoverageResult>;
  return (
    Array.isArray(result.topics) &&
    result.summary !== null &&
    typeof result.summary === "object" &&
    typeof result.summary?.estimatedCoveragePercent === "number" &&
    typeof result.summary?.topicCount === "number" &&
    typeof result.summary?.coveredTopicCount === "number" &&
    Array.isArray(result.duplicateGroups) &&
    Array.isArray(result.uncoveredQuestionIndexes)
  );
}

export default function CoveragePanel({ material, quizData, pdfSessionId, expectedPdfName }: Props) {
  const questions = extractQuestions(quizData);
  const [result, setResult] = useState<CoverageResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showDetails, setShowDetails] = useState(false);
  const [openSources, setOpenSources] = useState<string[]>([]);
  const [openPdfSources, setOpenPdfSources] = useState<string[]>([]);
  const requestRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => requestRef.current?.abort();
  }, []);

  async function analyze() {
    if (loading || !material.trim() || !questions.length) return;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/coverage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ material, questions }),
        signal: controller.signal,
      });
      const payload: unknown = await response.json();
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw new Error("服务器返回的数据格式无效。");
      }
      const parsed = payload as { data?: unknown; error?: unknown };
      if (!response.ok) {
        throw new Error(typeof parsed.error === "string" ? parsed.error : `覆盖分析失败（HTTP ${response.status}）。`);
      }
      if (!isCoverageResult(parsed.data)) {
        throw new Error("覆盖分析结果格式不正确。");
      }
      if (controller.signal.aborted) return;
      setResult(parsed.data);
      setShowDetails(true);
      setOpenSources([]);
    } catch (caught) {
      if (!controller.signal.aborted) {
        setError(caught instanceof Error ? caught.message : "覆盖分析失败，请重试。");
      }
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        setLoading(false);
      }
    }
  }

  function togglePdfSource(id: string) {
    setOpenPdfSources(previous => previous.includes(id)
      ? previous.filter(value => value !== id)
      : [...previous, id]);
  }

  function hasBrokenText(source: string): boolean {
    if (/[\uFFFD\u25A1\u25A0\u25AF\uE000-\uF8FF]/u.test(source)) return true;
    const parts = source.trim().split(/\s+/u);
    const isolated = parts.filter(part => /^[A-Za-z0-9]$/u.test(part)).length;
    return parts.length >= 7 && isolated / parts.length > 0.5;
  }

  function toggleSource(id: string) {
    setOpenSources(previous => previous.includes(id)
      ? previous.filter(value => value !== id)
      : [...previous, id]);
  }

  if (!questions.length) return null;

  return (
    <div className="mt-6 border-t border-slate-100 pt-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold text-slate-800">知识点覆盖分析</h4>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            分析本套 {questions.length} 道题涉及的主要知识点
          </p>
        </div>
        <button
          type="button"
          onClick={() => result ? setShowDetails(value => !value) : void analyze()}
          disabled={loading || !material.trim()}
          className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? "正在分析…" : result ? (showDetails ? "收起分析" : "查看分析") : "分析知识点覆盖情况"}
        </button>
      </div>

      {!material.trim() && (
        <p className="mt-3 text-xs text-amber-700">当前会话没有可用的原始学习材料。</p>
      )}
      {loading && (
        <div className="mt-4 flex items-center gap-2 text-xs text-slate-500" role="status">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-indigo-100 border-t-indigo-600" />
          正在分析原文与题目，较长课件可能需要更久。
        </div>
      )}
      {error && (
        <div className="mt-4 rounded-xl border border-rose-100 bg-rose-50 p-3 text-xs leading-6 text-rose-700" role="alert">
          <p>{error}</p>
          <button type="button" onClick={() => void analyze()} className="mt-2 font-semibold underline">重新分析</button>
        </div>
      )}

      {result && showDetails && (
        <div className="mt-5 space-y-4">
          <div className="rounded-xl border border-indigo-100 bg-indigo-50/50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs text-slate-500">估计知识点覆盖率</p>
                <p className="mt-1 text-3xl font-bold tracking-tight text-indigo-700">
                  {result.summary.estimatedCoveragePercent}%
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm font-semibold text-slate-700">
                  {result.summary.coveredTopicCount} / {result.summary.topicCount}
                </p>
                <p className="mt-1 text-xs text-slate-500">已覆盖 / 已识别知识点</p>
              </div>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-indigo-100">
              <div
                className="h-full rounded-full bg-indigo-600 transition-all"
                style={{ width: `${Math.max(0, Math.min(100, result.summary.estimatedCoveragePercent))}%` }}
              />
            </div>
            <p className="mt-3 text-xs leading-5 text-slate-500">
              共识别 {result.summary.topicCount} 个知识点，尚有 {result.summary.uncoveredTopicCount} 个未覆盖。
            </p>
          </div>

          {(result.summary.rejectedLowQualitySources ?? 0) > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-6 text-amber-800" role="status">
              {result.summary.rejectedLowQualitySources} 处原文引用无法准确识别，建议查看 PDF 原页核对。
            </div>
          )}

          <div className="space-y-2">
            {result.topics.map(topic => (
              <div key={topic.id} className="rounded-xl border border-slate-200 bg-white p-3.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-sm font-medium leading-6 text-slate-800">{topic.name}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {topic.covered
                        ? `关联题号：${topic.questionIndexes.map(i => i + 1).join("、")}`
                        : "当前测验未涉及"}
                    </p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-1 text-[11px] font-medium ${
                    topic.covered ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
                  }`}>
                    {topic.covered ? "已覆盖" : "未覆盖"}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap gap-4">
                  <button type="button" onClick={() => toggleSource(topic.id)} className="text-xs text-indigo-600 hover:underline">
                    {openSources.includes(topic.id) ? "收起文字依据 ↑" : "查看文字依据 ↓"}
                  </button>
                  {pdfSessionId && (
                    <button type="button" onClick={() => togglePdfSource(topic.id)} className="text-xs text-indigo-600 hover:underline">
                      {openPdfSources.includes(topic.id) ? "关闭 PDF 页面 ↑" : "查看 PDF 原页 ↗"}
                    </button>
                  )}
                </div>
                {openSources.includes(topic.id) && (
                  (topic.sourceQuality === "unreadable" || hasBrokenText(topic.source)) ? (
                    <p className="mt-2 rounded-lg bg-amber-50 p-3 text-xs leading-6 text-amber-800">
                      这段提取文字可能损坏，请使用 PDF 原页核对公式。
                    </p>
                  ) : (
                    <blockquote className="mt-2 whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-3 text-xs leading-6 text-slate-600">
                      {topic.source}
                    </blockquote>
                  )
                )}
                {pdfSessionId && openPdfSources.includes(topic.id) && (
                  <PdfEvidenceViewer
                    sessionId={pdfSessionId}
                    expectedPdfName={expectedPdfName}
                    source={topic.source}
                  />
                )}
              </div>
            ))}
          </div>

          {result.duplicateGroups.length > 0 && (
            <div className="rounded-xl border border-amber-100 bg-amber-50 p-4">
              <p className="text-sm font-semibold text-amber-800">可能重复考查的题目</p>
              <p className="mt-2 text-xs leading-6 text-amber-800">
                {result.duplicateGroups.map(group => group.map(i => i + 1).join("、")).join("；")}
                （数字为题号，需人工确认是否重复）
              </p>
            </div>
          )}

          {result.summary.unassignedQuestionCount > 0 && (
            <p className="text-xs leading-6 text-slate-500">
              另有 {result.summary.unassignedQuestionCount} 道题未匹配到本次提取的知识点清单。
            </p>
          )}
          <p className="text-xs leading-6 text-slate-400">
            覆盖率由 AI 根据学习材料和题目估算，仅供参考。
          </p>
        </div>
      )}
    </div>
  );
}
