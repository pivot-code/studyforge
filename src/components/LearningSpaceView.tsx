"use client";

import SpaceQuizDashboard from "@/components/SpaceQuizDashboard";
import SmartFlashcards from "@/components/SmartFlashcards";
import StudyWidgets from "@/components/StudyWidgets";
import CoveragePanel from "@/components/CoveragePanel";
import ConceptLearningSpace from "@/components/ConceptLearningSpace";
import type { Mode } from "@/lib/studyStorage";

type Props = {
  mode: Mode;
  questionBank?: boolean;
  data: unknown;
  spaceId: string;
  title?: string;
  material: string;
  pdfSessionId?: string;
  expectedPdfName?: string;
  onBack: () => void;
  experience?: "concept_path";
  scopeMaterial?: string;
  practiceData?: unknown;
  explanations?: Record<string, unknown>;
  onPracticeGenerated?: (data: unknown) => void;
  onExplanationGenerated?: (conceptId: string, data: unknown) => void;
  loading?: boolean;
  generationError?: string;
  onRetry?: () => void;
};

const names: Record<Mode, string> = {
  flashcards: "智能闪卡",
  quiz: "选择题测验",
  graph: "知识逻辑图",
  keywords: "核心词速览",
};

export default function LearningSpaceView({ mode, data, spaceId, questionBank = false, title, material, pdfSessionId, expectedPdfName, onBack, loading = false, generationError, onRetry, experience, scopeMaterial, practiceData, explanations, onPracticeGenerated, onExplanationGenerated }: Props) {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-5 sm:px-8 sm:py-8">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-indigo-600">STUDYFORGE · LEARNING SPACE</p>
          <h2 className="mt-1 text-xl font-semibold text-slate-800 sm:text-2xl">{title || names[mode]}</h2>
          <p className="mt-1 text-xs text-slate-500">{experience === "concept_path" ? "概念理解 · 知识关系 · 理解检查" : names[mode]} · 可随时返回工作台</p>
        </div>
        <button type="button" onClick={onBack}
          className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
          ← 返回工作台
        </button>
      </div>
      <div className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        {loading ? (
          <div className="flex min-h-[260px] flex-col items-center justify-center gap-4 text-center" role="status" aria-live="polite">
            <span className="h-9 w-9 animate-spin rounded-full border-4 border-indigo-100 border-t-indigo-600" />
            <div>
              <p className="text-base font-semibold text-slate-800">正在创建学习内容</p>
              <p className="mt-2 text-sm text-slate-500">你的学习空间已经打开，生成完成后会在这里显示。</p>
            </div>
          </div>
        ) : generationError ? (
          <div className="flex min-h-[260px] flex-col items-center justify-center gap-4 text-center" role="alert">
            <div>
              <p className="font-semibold text-slate-800">生成未完成</p>
              <p className="mt-2 max-w-xl break-words text-sm text-rose-600">{generationError}</p>
            </div>
            {onRetry && (
              <button type="button" onClick={onRetry} className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-indigo-700">重新生成</button>
            )}
          </div>
        ) : mode === "graph" && experience === "concept_path" ? (
          <ConceptLearningSpace
            graphData={data}
            spaceId={spaceId}
            pdfSessionId={pdfSessionId}
            expectedPdfName={expectedPdfName}
            material={scopeMaterial?.trim() || material}
            practiceData={practiceData}
            explanations={explanations}
            onPracticeGenerated={onPracticeGenerated}
            onExplanationGenerated={onExplanationGenerated}
          />
        ) : mode === "quiz" ? (
          <div className="space-y-6">
            <SpaceQuizDashboard spaceId={spaceId} data={data} questionBank={questionBank} pdfSessionId={pdfSessionId} expectedPdfName={expectedPdfName} />
            {!questionBank && <CoveragePanel material={material} quizData={data} pdfSessionId={pdfSessionId} expectedPdfName={expectedPdfName} />}
          </div>
        ) : mode === "flashcards" && data && typeof data === "object" && "cards" in data ? (
          <SmartFlashcards data={data} deckId={spaceId} pdfSessionId={pdfSessionId} expectedPdfName={expectedPdfName} />
        ) : (
          <StudyWidgets mode={mode} data={data} />
        )}
      </div>
    </div>
  );
}
