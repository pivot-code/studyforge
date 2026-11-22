
"use client";

import "./studyforge-ui.css";
import { createPortal } from "react-dom";
import QuizConfig, { type QuizSettings } from "@/components/QuizConfig";
import FlashcardConfig, { type FlashcardSettings } from "@/components/FlashcardConfig";
import QuestionBankImport from "@/components/QuestionBankImport";
import AgentPlanner, { type AgentSelection } from "@/components/AgentPlanner";

import {
  useEffect, useRef, useState,
  type ChangeEvent, type KeyboardEvent, type MouseEvent,
} from "react";
import EnhancedQuiz from "@/components/EnhancedQuiz";
import LearningSpaceView from "@/components/LearningSpaceView";
import { deleteSpaceProgress } from "@/lib/spaceProgress";
import KnowledgeLibraryView from "@/components/KnowledgeLibraryView";
import KnowledgeReferencePicker, { type SelectedKnowledgeDocument } from "@/components/KnowledgeReferencePicker";
import { buildStudyContext } from "@/lib/knowledgeContext";
import { parseStudyFile } from "@/lib/parseStudyFile";
import { extractWordYellowHighlight } from "@/lib/wordHighlight";
import { savePdfForSession, deletePdfForSession } from "@/lib/pdfEvidenceStore";
import {
  getSessions, saveSession, deleteSession, makeSession,
  type StudySession, type ChatMessage, type Mode,
} from "@/lib/studyStorage";
import {
  PROGRESS_EVENT, getRecords, getStats,
  toggleFavorite, toggleReview, removeWrong,
  type QuestionRecord,
} from "@/lib/studyProgress";

type View = "chat" | "wrong" | "favorites" | "stats" | "library";

type PendingSpace = {
  id: string;
  sessionId: string;
  mode: Mode;
  recommended: boolean;
  quizSettings?: QuizSettings;
  flashcardSettings?: FlashcardSettings;
  scopedMaterial?: string;
  referenceMaterial?: string;
  sourceNames?: string[];
  experience?: "concept_path";
  title: string;
  error?: string;
};


const modeNames: Record<Mode, string> = {
  flashcards: "闪卡记忆",
  quiz: "选择题测试",
  graph: "知识逻辑图",
  keywords: "核心词速览",
};

const choices = [
  { label: "A. 做闪卡记知识点", value: "flashcards" },
  { label: "B. 出选择题考考我", value: "quiz" },
  { label: "C. 帮我画出逻辑结构图", value: "graph" },
  { label: "D. 我不知道，帮我推荐一下", value: "diagnose" },
] as const;

const difficulties = [
  { label: "1. 背不下来", value: "flashcards" },
  { label: "2. 概念太乱理不清逻辑", value: "graph" },
  { label: "3. 不放心，想做题验证", value: "quiz" },
  { label: "4. 想要快速过一遍核心词", value: "keywords" },
] as const;

function msg(
  role: ChatMessage["role"],
  content: string
): ChatMessage {
  return { id: crypto.randomUUID(), role, content };
}

type NamedSpaceMessage = ChatMessage & {
  spaceTitle?: string;
  spaceKind?: "question_bank";
  experience?: "concept_path";
  spaceScopeMaterial?: string;
  spaceReferenceMaterial?: string;
  spaceReferenceNames?: string[];
  spacePractice?: unknown;
  spaceExplanations?: Record<string, unknown>;
};

function spaceTitleFromMessage(message: ChatMessage, materialName: string): string {
  const named = message as NamedSpaceMessage;
  if (typeof named.spaceTitle === "string" && named.spaceTitle.trim()) return named.spaceTitle;
  const data = message.data;
  const generatedTitle = data && typeof data === "object" && "title" in data && typeof data.title === "string"
    ? data.title.trim() : "";
  const modeLabel = message.mode ? modeNames[message.mode] : "互动学习";
  const fileLabel = materialName.replace(/\.[^.]+$/, "").trim();
  return generatedTitle && generatedTitle !== modeLabel
    ? `${generatedTitle} · ${modeLabel}`
    : fileLabel ? `${fileLabel} · ${modeLabel}` : modeLabel;
}

function makeSpaceTitle(mode: Mode, topic: string | undefined, materialName: string): string {
  const shortTopic = (topic || "").replace(/\s+/g, " ").trim().slice(0, 42);
  const materialLabel = materialName.replace(/\.[^.]+$/, "").trim().slice(0, 42);
  return `${shortTopic || materialLabel || "我的学习"} · ${modeNames[mode]}`;
}

function dateLabel(time: number) {
  return new Date(time).toLocaleDateString("zh-CN", {
    month: "numeric", day: "numeric",
  });
}

export default function Home() {
  const [session, setSession] = useState<StudySession | null>(null);
  const [sessions, setSessions] = useState<StudySession[]>([]);
  const [ready, setReady] = useState(false);
  const [view, setView] = useState<View>("chat");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState("");
  const [storageError, setStorageError] = useState("");
  const [records, setRecords] = useState<QuestionRecord[]>([]);
  const [includeMastered, setIncludeMastered] = useState(false);
  const [practiceIds, setPracticeIds] = useState<string[] | null>(null);
  const [practiceKey, setPracticeKey] = useState(0);
  const [quizConfigOrigin, setQuizConfigOrigin] = useState<"select" | "diagnose" | "complete" | null>(null);
  const [flashcardConfigOrigin, setFlashcardConfigOrigin] = useState<"select" | "diagnose" | "complete" | null>(null);
  const [agentGoal, setAgentGoal] = useState("");
  const [agentRequestKey, setAgentRequestKey] = useState(0);
  const [showQuestionBankImport, setShowQuestionBankImport] = useState(false);
  const [activeSpaceId, setActiveSpaceId] = useState<string | null>(null);
  const [pendingSpace, setPendingSpace] = useState<PendingSpace | null>(null);
  const [libraryDocuments, setLibraryDocuments] = useState<SelectedKnowledgeDocument[]>([]);

  const [menu, setMenu] = useState<{
    id: string; x: number; y: number;
  } | null>(null);
  const [dialog, setDialog] = useState<{
    type: "rename" | "delete"; id: string;
  } | null>(null);
  const [renameText, setRenameText] = useState("");
  const [spaceMenu, setSpaceMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [spaceDialog, setSpaceDialog] = useState<{ id: string; type: "rename" | "delete" } | null>(null);
  const [spaceRenameText, setSpaceRenameText] = useState("");

  const sessionRef = useRef<StudySession | null>(null);
  const activeIdRef = useRef("");
  const requestRef = useRef<AbortController | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const timelineEndRef = useRef<HTMLDivElement>(null);
  const uploadRef = useRef(0);

  useEffect(() => {
    let cancelled = false;

    async function initialize() {
      try {
        const all = await getSessions();
        if (cancelled) return;

        const last = localStorage.getItem("studyforge-last-session");
        const found = all.find(s => s.id === last) ?? all[0];
        const current = found ?? makeSession();

        if (!found) await saveSession(current);
        if (cancelled) return;

        sessionRef.current = current;
        activeIdRef.current = current.id;
        setSession(current);
        setSessions(found ? all : [current]);
        localStorage.setItem("studyforge-last-session", current.id);
      } catch {
        if (cancelled) return;

        const current = makeSession();
        sessionRef.current = current;
        activeIdRef.current = current.id;
        setSession(current);
        setStorageError("本地会话存储不可用。");
      } finally {
        if (!cancelled) setReady(true);
      }
    }

    void initialize();
    return () => {
      cancelled = true;
      requestRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    function refreshProgress() {
      setRecords(getRecords());
    }

    refreshProgress();
    window.addEventListener(PROGRESS_EVENT, refreshProgress);
    window.addEventListener("storage", refreshProgress);

    return () => {
      window.removeEventListener(PROGRESS_EVENT, refreshProgress);
      window.removeEventListener("storage", refreshProgress);
    };
  }, []);

  useEffect(() => {
    if (!ready || !session) return;
    const snapshot = session;

    const timer = window.setTimeout(async () => {
      try {
        await saveSession(snapshot);
        setSessions(prev =>
          [...prev.filter(s => s.id !== snapshot.id), snapshot]
            .sort((a, b) => b.updatedAt - a.updatedAt)
        );
      } catch {
        setStorageError("自动保存失败，请检查浏览器存储。");
      }
    }, 350);

    return () => window.clearTimeout(timer);
  }, [session, ready]);

  useEffect(() => {
    if (view !== "chat" || activeSpaceId) return;
    // Keep the compact welcome screen visible when a fresh session opens.
    if (session?.phase === "upload" && session.messages.length === 1 && !session.material.trim() && libraryDocuments.length === 0) return;
    timelineEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [session?.messages.length, busy, reading, error, view, activeSpaceId]);

  function update(
    transform: (current: StudySession) => StudySession
  ) {
    const current = sessionRef.current;
    if (!current) return;

    const next = {
      ...transform(current),
      updatedAt: Date.now(),
    };

    sessionRef.current = next;
    setSession(next);
  }

  function append(...items: ChatMessage[]) {
    update(s => ({
      ...s,
      messages: [...s.messages, ...items],
    }));
  }

  function openSpaceDialog(id: string, type: "rename" | "delete") {
    const current = sessionRef.current;
    const target = current?.messages.find(item => item.id === id && item.mode && item.data);
    if (!target) return;
    setSpaceRenameText(spaceTitleFromMessage(target, current?.fileInfo?.split(" · ")[0] || current?.title || ""));
    setSpaceDialog({ id, type });
    setSpaceMenu(null);
  }

  function confirmSpaceDialog() {
    if (!spaceDialog) return;
    const { id, type } = spaceDialog;
    if (type === "rename") {
      const nextTitle = spaceRenameText.trim().slice(0, 80);
      if (!nextTitle) return;
      update(current => ({
        ...current,
        messages: current.messages.map(item =>
          item.id === id && item.mode && item.data ? { ...item, spaceTitle: nextTitle } : item
        ),
      }));
    } else {
      // Delete the space and only its own scoped progress. Legacy global records remain intact.
      update(current => ({
        ...current,
        messages: current.messages.filter(item => item.id !== id),
      }));
      try { deleteSpaceProgress(id); } catch { setStorageError("空间已删除，但练习记录清理失败。"); }
      if (activeSpaceId === id) setActiveSpaceId(null);
    }
    setSpaceDialog(null);
  }

  function cancelPending() {
    requestRef.current?.abort();
    requestRef.current = null;
    uploadRef.current++;
    setBusy(false);
    setReading(false);
    setError("");
  }

  async function createSession() {
    cancelPending();

    try {
      if (sessionRef.current) {
        await saveSession(sessionRef.current);
      }
    } catch {
      setStorageError("上一个会话保存失败。");
    }

    const next = makeSession();
    sessionRef.current = next;
    activeIdRef.current = next.id;
    setSession(next);
    setInput("");
    setView("chat");
    setPracticeIds(null);
    setQuizConfigOrigin(null);
    setFlashcardConfigOrigin(null);
    setAgentGoal("");
    setAgentRequestKey(0);
    setSidebarOpen(false);
    setActiveSpaceId(null);
    setSpaceMenu(null);
    setSpaceDialog(null);
    setPendingSpace(null);
    setLibraryDocuments([]);
    setShowQuestionBankImport(false);

    try {
      await saveSession(next);
      setSessions(prev => [next, ...prev]);
      localStorage.setItem("studyforge-last-session", next.id);
    } catch {
      setStorageError("新会话保存失败。");
    }
  }

  async function switchSession(next: StudySession) {
    cancelPending();

    try {
      if (sessionRef.current) {
        await saveSession(sessionRef.current);
      }
    } catch {
      setStorageError("切换前保存失败。");
    }

    sessionRef.current = next;
    activeIdRef.current = next.id;
    setSession(next);
    setInput("");
    setView("chat");
    setPracticeIds(null);
    setQuizConfigOrigin(null);
    setFlashcardConfigOrigin(null);
    setAgentGoal("");
    setAgentRequestKey(0);
    setSidebarOpen(false);
    setActiveSpaceId(null);
    setSpaceMenu(null);
    setSpaceDialog(null);
    setPendingSpace(null);
    setLibraryDocuments([]);
    setShowQuestionBankImport(false);
    localStorage.setItem("studyforge-last-session", next.id);
  }

  function receiveMaterial(text: string, label: string) {
    cancelPending();
    setQuizConfigOrigin(null);
    setFlashcardConfigOrigin(null);
    setAgentGoal("");
    setAgentRequestKey(0);
    setShowQuestionBankImport(false);
    setActiveSpaceId(null);
    setSpaceMenu(null);
    setSpaceDialog(null);
    setPendingSpace(null);

    update(s => ({
      ...s,
      material: text,
      title: s.title === "新学习会话"
        ? label.replace(/^已上传：/, "").slice(0, 36)
        : s.title,
      phase: "select",
      messages: [
        ...s.messages,
        msg("user", label),
        msg("assistant", "材料已收到。告诉我你遇到了什么困难，或直接选择学习方式。"),
      ],
    }));
  }

  function beginDiagnosis() {
    update(s => ({
      ...s,
      phase: "diagnose",
      messages: [
        ...s.messages,
        msg("assistant",
          "没问题，让我们找找最适合你的方式。你觉得自己目前最大的困难是什么？"
        ),
      ],
    }));
  }

  function openQuizConfig(origin: "select" | "diagnose" | "complete") {
    if (busy || reading) return;
    setError("");
    setQuizConfigOrigin(origin);
  }

  function confirmQuizConfig(settings: QuizSettings) {
    const recommended = quizConfigOrigin === "diagnose";
    setQuizConfigOrigin(null);
    setFlashcardConfigOrigin(null);
    void generate("quiz", recommended, settings);
  }

  function openFlashcardConfig(origin: "select" | "diagnose" | "complete") {
    if (busy || reading) return;
    setError("");
    setFlashcardConfigOrigin(origin);
  }

  function confirmFlashcardConfig(settings: FlashcardSettings) {
    const recommended = flashcardConfigOrigin === "diagnose";
    setFlashcardConfigOrigin(null);
    void generate("flashcards", recommended, undefined, settings);
  }

  async function generate(
    mode: Mode,
    recommended = false,
    quizSettings?: QuizSettings,
    flashcardSettings?: FlashcardSettings,
    scopedMaterial?: string,
    spaceTopic?: string,
    experience?: "concept_path"
  ) {
    const current = sessionRef.current;
    if (!current || (!current.material.trim() && libraryDocuments.length === 0)) {
      setError("请先提供学习材料，或勾选知识库资料。");
      return;
    }
    if (mode === "quiz" && !quizSettings) {
      openQuizConfig(current.phase === "diagnose" ? "diagnose" : current.phase === "select" ? "select" : "complete");
      return;
    }
    if (mode === "flashcards" && !flashcardSettings) {
      openFlashcardConfig(current.phase === "diagnose" ? "diagnose" : current.phase === "select" ? "select" : "complete");
      return;
    }

    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    const currentId = current.id;
    const spaceId = crypto.randomUUID();
    const baseTitle = experience === "concept_path"
      ? `${(spaceTopic || current.fileInfo?.split(" · ")[0] || current.title).replace(/\s+/g, " ").trim().slice(0, 42)} · 概念理解空间`
      : makeSpaceTitle(mode, spaceTopic || (mode === "quiz" ? quizSettings?.topic : flashcardSettings?.topic), current.fileInfo?.split(" · ")[0] || current.title);
    const existingTitles = new Set(current.messages
      .filter(item => item.mode && item.data)
      .map(item => spaceTitleFromMessage(item, current.fileInfo?.split(" · ")[0] || current.title)));
    let spaceTitle = baseTitle;
    let duplicateNumber = 2;
    while (existingTitles.has(spaceTitle)) {
      spaceTitle = `${baseTitle} (${duplicateNumber++})`;
    }
    const requestMaterial = scopedMaterial?.trim() || buildStudyContext(
      current.material, libraryDocuments,
      spaceTopic || quizSettings?.topic || flashcardSettings?.topic || ""
    );
    setPendingSpace({
      id: spaceId,
      sessionId: currentId,
      mode,
      recommended,
      quizSettings,
      flashcardSettings,
      scopedMaterial,
      referenceMaterial: requestMaterial,
      sourceNames: libraryDocuments.map(doc => doc.name),
      experience,
      title: spaceTitle,
    });
    setActiveSpaceId(spaceId);

    setBusy(true);
    setError("");

    update(s => ({
      ...s,
      phase: "complete",
      messages: [
        ...s.messages,
        msg("assistant", mode === "flashcards" && flashcardSettings
          ? `正在生成${flashcardSettings.count}张闪卡（${flashcardSettings.scope === "comprehensive" ? "全面复习" : `指定范围：${flashcardSettings.topic}`}）。`
          : mode === "quiz" && quizSettings
          ? `正在生成${quizSettings.count}道选择题（${quizSettings.scope === "comprehensive" ? "全面覆盖" : `指定范围：${quizSettings.topic}`}）。`
          : recommended
          ? `根据你的困难，我建议使用「${modeNames[mode]}」。`
          : `好的，为你生成「${modeNames[mode]}」。`
        ),
      ],
    }));

    try {
      const response = await fetch(mode === "flashcards" ? "/api/flashcards" : "/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ material: requestMaterial, mode, ...(quizSettings ? { quizSettings } : {}), ...(flashcardSettings ? { flashcardSettings } : {}) }),
        signal: controller.signal,
      });

      const raw = await response.text();
      let result: { data?: unknown; error?: string };

      try {
        result = JSON.parse(raw);
      } catch {
        throw new Error(`服务器返回了非JSON内容（HTTP ${response.status}）`);
      }

      if (!response.ok) {
        throw new Error(result.error || "生成失败");
      }
      if (!result.data || typeof result.data !== "object") {
        throw new Error("生成数据格式错误");
      }
      if (
        controller.signal.aborted ||
        activeIdRef.current !== currentId
      ) return;

      const quizData = (mode === "quiz" || mode === "flashcards") && result.data && typeof result.data === "object"
        ? result.data as { requestedCount?: number; generatedCount?: number }
        : null;
      const countNotice = quizData && typeof quizData.requestedCount === "number" &&
        typeof quizData.generatedCount === "number" &&
        quizData.generatedCount < quizData.requestedCount
          ? msg("assistant", mode === "flashcards"
            ? `本次计划生成${quizData.requestedCount}张闪卡，实际生成${quizData.generatedCount}张。`
            : `本次计划生成${quizData.requestedCount}道题，实际有${quizData.generatedCount}道通过校验。未生成的题目不会用缺乏原文依据的内容填充。`)
          : null;

      update(s => ({
        ...s,
        messages: [
          ...s.messages,
          ...(countNotice ? [countNotice] : []),
          {
            id: spaceId,
            role: "assistant",
            spaceTitle,
            experience,
            spaceScopeMaterial: experience === "concept_path" ? requestMaterial : undefined,
            spaceReferenceMaterial: requestMaterial,
            spaceReferenceNames: libraryDocuments.map(doc => doc.name),
            mode,
            data: result.data,
          },
        ],
      }));
      setPendingSpace(null);
    } catch (e) {
      if (
        !controller.signal.aborted &&
        activeIdRef.current === currentId
      ) {
        const reason = e instanceof Error ? e.message : "生成失败";
        setError(reason);
        setPendingSpace(prev => prev?.id === spaceId ? { ...prev, error: reason } : prev);
      }
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        setBusy(false);
      }
    }
  }

  function selectAgentMode(selection: AgentSelection) {
    const { mode, topic, count, detail, scopedMaterial, experience } = selection;
    if (mode === "question_bank") {
      setShowQuestionBankImport(true);
      window.setTimeout(() => document.getElementById("sf-question-bank-import")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
      return;
    }
    const focused = Boolean(topic.trim());
    append(msg("assistant", focused
      ? `已选择「${modeNames[mode]}」，学习范围：${topic}。`
      : `已选择「${modeNames[mode]}」。`));
    if (mode === "quiz") {
      const settings: QuizSettings = {
        scope: focused ? "focused" : "comprehensive",
        topic: focused ? topic : "",
        count: Math.max(5, Math.min(30, count ?? 15)),
      };
      void generate("quiz", true, settings, undefined, scopedMaterial, topic);
    } else if (mode === "flashcards") {
      const settings: FlashcardSettings = {
        scope: focused ? "focused" : "comprehensive",
        topic: focused ? topic : "",
        count: Math.max(5, Math.min(50, count ?? 20)),
        detail: detail ?? "standard",
      };
      void generate("flashcards", true, undefined, settings, scopedMaterial, topic);
    } else {
      // Only send original source passages grounded to selected stage evidence.
      // No new AI endpoint is needed; the existing generator works on this scoped input.
      void generate(mode, true, undefined, undefined, scopedMaterial, topic, experience);
    }
  }

  function createQuestionBankSpace(data: { title: string; questions: { question: string; options: string[]; answerIndex: number; explanation: string; source: string }[] }) {
    if (!data.questions.length) return;
    const id = crypto.randomUUID();
    const current = sessionRef.current;
    if (!current) return;
    const names = current.messages.filter(item => item.mode && item.data).map(item => spaceTitleFromMessage(item, current.title));
    let title = data.title;
    let suffix = 2;
    while (names.includes(title)) title = `${data.title} (${suffix++})`;
    const bank = {
      id, role: "assistant" as const, mode: "quiz" as const,
      data, spaceTitle: title, spaceKind: "question_bank" as const,
    };
    append(bank as ChatMessage);
    setShowQuestionBankImport(false);
    setActiveSpaceId(id);
    setView("chat");
  }

  function saveSpacePractice(spaceId: string, data: unknown) {
    update(current => ({
      ...current,
      messages: current.messages.map(message =>
        message.id === spaceId && message.mode && message.data
          ? { ...message, spacePractice: data }
          : message
      ),
    }));
  }

  function saveSpaceExplanation(spaceId: string, conceptId: string, data: unknown) {
    update(current => ({
      ...current,
      messages: current.messages.map(message => {
        if (message.id !== spaceId || !message.mode || !message.data) return message;
        const existing = (message as NamedSpaceMessage).spaceExplanations ?? {};
        return { ...message, spaceExplanations: { ...existing, [conceptId]: data } };
      }),
    }));
  }

  function requestAgentPlan(goal: string) {
    setAgentGoal(goal);
    setAgentRequestKey(key => key + 1);
  }

  function changeKnowledgeSelection(documents: SelectedKnowledgeDocument[]) {
    // A changed source selection invalidates the earlier plan; do not silently re-run AI.
    setLibraryDocuments(documents);
    setAgentGoal("");
    setAgentRequestKey(0);
  }

  function handleChoice(value: string, label: string) {
    if (sessionRef.current?.phase !== "select") return;
    append(msg("user", label));

    if (value === "diagnose") beginDiagnosis();
    else if (value === "quiz") openQuizConfig("select");
    else if (value === "flashcards") openFlashcardConfig("select");
    else void generate(value as Mode);
  }

  function handleDifficulty(mode: Mode, label: string) {
    if (sessionRef.current?.phase !== "diagnose") return;
    append(msg("user", label));
    if (mode === "quiz") openQuizConfig("diagnose");
    else if (mode === "flashcards") openFlashcardConfig("diagnose");
    else void generate(mode, true);
  }

  function send() {
    const text = input.trim();
    const current = sessionRef.current;
    if (!text || !current || busy || reading || quizConfigOrigin || flashcardConfigOrigin) return;
    setInput("");

    // A new session accepts both study goals and pasted source material.
    // A short natural-language goal must never be mislabeled as an uploaded document.
    // Users can explicitly prefix short pasted content with “材料：”.
    if (!current.material.trim() && libraryDocuments.length === 0) {
      const explicitMaterial = /^(?:学习材料|课件内容|原始材料|材料|资料)\s*[:：]/u.test(text);
      const contentToImport = explicitMaterial
        ? text.replace(/^(?:学习材料|课件内容|原始材料|材料|资料)\s*[:：]\s*/u, "")
        : text;
      const multilineMaterial = contentToImport.split(/\r?\n/u).filter(line => line.trim()).length >= 3
        && contentToImport.length >= 120;
      const pastedMaterial = current.phase === "upload" &&
        (explicitMaterial || contentToImport.length >= 600 || multilineMaterial);

      if (pastedMaterial) {
        if (!contentToImport.trim()) {
          setError("请在「材料：」后粘贴学习内容。");
          return;
        }
        if (contentToImport.length > 100000) {
          setError("材料不能超过100000字符。");
          return;
        }
        receiveMaterial(contentToImport, "已粘贴学习材料");
        return;
      }

      append(
        msg("user", text),
        msg("assistant", "我了解你的学习目标。目前尚未收到学习资料。请上传课件，或主动勾选知识库中的资料，再生成基于材料的学习方案。如果要直接粘贴较短的资料，请以「材料：」开头。")
      );
      setError("");
      return;
    }

    append(msg("user", text));

    if (current.phase === "select") {
      if (/^d$/i.test(text)) {
        beginDiagnosis();
        return;
      }

      const mode: Mode | null =
        /^a$|闪卡|背诵|记忆/i.test(text) ? "flashcards" :
        /^b$|做题|选择题|刷题|测试/i.test(text) ? "quiz" :
        /^c$|逻辑|知识图谱|结构图/i.test(text) ? "graph" :
        /核心词|关键词|速览/.test(text) ? "keywords" : null;

      if (mode === "quiz") openQuizConfig("select");
      else if (mode === "flashcards") openFlashcardConfig("select");
      else if (mode) void generate(mode);
      else requestAgentPlan(text);
      return;
    }

    if (current.phase === "diagnose") {
      const mode: Mode | null =
        /^1$|背|记不住/.test(text) ? "flashcards" :
        /^2$|概念|逻辑|混乱/.test(text) ? "graph" :
        /^3$|做题|验证|测试/.test(text) ? "quiz" :
        /^4$|核心词|快速|关键词/.test(text) ? "keywords" : null;

      if (mode === "quiz") openQuizConfig("diagnose");
      else if (mode === "flashcards") openFlashcardConfig("diagnose");
      else if (mode) void generate(mode, true);
      else requestAgentPlan(text);
      return;
    }

    requestAgentPlan(text);
  }

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || busy || reading) return;

    const taskId = ++uploadRef.current;
    const currentId = activeIdRef.current;

    setReading(true);
    setError("");

    try {
      const parsed = await parseStudyFile(file);
      let materialText = parsed.text;
      if (file.name.toLowerCase().endsWith(".docx")) {
        const highlighted = await extractWordYellowHighlight(file);
        if (highlighted?.confirmedGroups && highlighted.text.length <= 100000) {
          materialText = highlighted.text;
        }
      }

      if (
        taskId !== uploadRef.current ||
        currentId !== activeIdRef.current
      ) return;

      const details = [
        parsed.kind.toUpperCase(),
        parsed.pages ? `${parsed.pages}页` : "",
        `${materialText.length}字符`,
      ].filter(Boolean).join(" · ");

      // 保存原始 PDF，供历史会话里的公式截图引用使用。
      try {
        if (file.name.toLowerCase().endsWith(".pdf")) {
          await savePdfForSession(currentId, file);
        } else {
          await deletePdfForSession(currentId);
        }
      } catch {
        setStorageError("文件文字已解析，但原始 PDF 保存失败。仍可在引用处重新关联 PDF。");
      }
      if (taskId !== uploadRef.current || currentId !== activeIdRef.current) return;

      receiveMaterial(materialText, `已上传：${parsed.name}`);

      update(s => ({
        ...s,
        fileInfo: `${parsed.name} · ${details}`,
        messages: [
          ...s.messages,
          msg("assistant", `文件解析成功：${details}`),
        ],
      }));
    } catch (e) {
      if (taskId === uploadRef.current) {
        setError(e instanceof Error ? e.message : "文件解析失败");
      }
    } finally {
      if (taskId === uploadRef.current) setReading(false);
    }
  }

  function openMenu(event: MouseEvent, id: string) {
    event.preventDefault();
    setMenu({
      id,
      x: Math.max(0, Math.min(event.clientX, window.innerWidth - 175)),
      y: Math.max(0, Math.min(event.clientY, window.innerHeight - 105)),
    });
  }

  function openDialog(type: "rename" | "delete", id: string) {
    const target = sessions.find(s => s.id === id);
    if (!target) return;

    setRenameText(target.title);
    setDialog({ type, id });
    setMenu(null);
  }

  async function confirmDialog() {
    if (!dialog) return;
    const { id, type } = dialog;

    try {
      if (type === "rename") {
        const title = renameText.trim().slice(0, 60);
        if (!title) return;
        const target = sessions.find(s => s.id === id);
        if (!target) return;

        const next = { ...target, title, updatedAt: Date.now() };
        await saveSession(next);
        setSessions(prev => prev.map(s => s.id === id ? next : s));

        if (sessionRef.current?.id === id) {
          sessionRef.current = next;
          setSession(next);
        }
      } else {
        if (sessionRef.current?.id === id) {
          cancelPending();
          const next = sessions.find(s => s.id !== id) ?? makeSession();

          sessionRef.current = next;
          activeIdRef.current = next.id;
          setSession(next);
          setInput("");
          setView("chat");
          setPracticeIds(null);
          setQuizConfigOrigin(null);
          setFlashcardConfigOrigin(null);
          setActiveSpaceId(null);
          setPendingSpace(null);
          setLibraryDocuments([]);
          setAgentGoal("");
          setAgentRequestKey(0);
          setShowQuestionBankImport(false);

          localStorage.setItem("studyforge-last-session", next.id);
          await saveSession(next);
        }

        const removedSession = sessions.find(s => s.id === id);
        await deleteSession(id);
        if (removedSession) for (const message of removedSession.messages) {
          if (message.mode && message.data) {
            try { deleteSpaceProgress(message.id); } catch {
              setStorageError("会话已删除，但部分练习记录清理失败。");
            }
          }
        }
        try { await deletePdfForSession(id); } catch {
          setStorageError("会话已删除，但原始 PDF 缓存清理失败。");
        }
        setSessions(await getSessions());
      }

      setDialog(null);
    } catch {
      setStorageError("会话操作失败，请检查本地存储。");
    }
  }

  useEffect(() => {
    if (!spaceMenu) return;
    const close = () => setSpaceMenu(null);
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [spaceMenu]);

  function changeView(next: View) {
    setView(next);
    if (next === "library") setLibraryDocuments([]);
    setPracticeIds(null);
    setQuizConfigOrigin(null);
    setFlashcardConfigOrigin(null);
    setAgentGoal("");
    setAgentRequestKey(0);
    setActiveSpaceId(null);
    setSpaceMenu(null);
    setSpaceDialog(null);
    setPendingSpace(null);
    setSidebarOpen(false);
  }

  function updateSaved(
    operation: () => unknown
  ) {
    try {
      operation();
      setRecords(getRecords());
      setError("");
    } catch {
      setStorageError("学习记录保存失败，请检查浏览器存储。");
    }
  }

  function keyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (
      e.key === "Enter" &&
      !e.shiftKey &&
      !e.nativeEvent.isComposing
    ) {
      e.preventDefault();
      send();
    }
  }

  const wrongRecords = records.filter(
    r => r.wrong && (includeMastered || !r.mastered)
  );
  const favoriteRecords = records.filter(r => r.favorite);
  const stats = {
    attempts: records.reduce((n, r) => n + r.attempts, 0),
    correct: records.reduce((n, r) => n + r.correct, 0),
    wrong: records.filter(r => r.wrong && !r.mastered).length,
    mastered: records.filter(r => r.mastered).length,
    favorites: favoriteRecords.length,
    review: records.filter(r => r.review).length,
  };
  const accuracy = stats.attempts
    ? Math.round(stats.correct / stats.attempts * 100)
    : 0;

  const practiceQuestions = practiceIds
    ?.map(id => records.find(r => r.id === id)?.question)
    .filter((q): q is QuestionRecord["question"] => Boolean(q)) ?? [];

  const activeSpace = activeSpaceId
    ? session?.messages.find(message => message.id === activeSpaceId && message.mode && message.data)
    : null;
  const activePendingSpace = pendingSpace &&
    pendingSpace.sessionId === session?.id &&
    pendingSpace.id === activeSpaceId && !activeSpace ? pendingSpace : null;
  const isSpaceOpen = Boolean(activeSpace || activePendingSpace);
  const showWelcome = Boolean(session?.phase === "upload" && session.messages.length === 1 && !session.material.trim() && libraryDocuments.length === 0);

  return (
    <main className="sf-polish flex h-dvh overflow-hidden bg-[#f8f9fc] text-slate-800">
      {sidebarOpen && (
        <button
          className="fixed inset-0 z-30 bg-slate-900/30 md:hidden"
          aria-label="关闭侧边栏"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside className={`fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r border-slate-200 bg-[#f2f3fa] transition-transform md:static md:translate-x-0 ${
        sidebarOpen ? "translate-x-0" : "-translate-x-full"
      }`}>
        <div className="flex items-center gap-3 px-5 py-6">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-indigo-600 text-lg font-bold text-white">
            S
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-bold">StudyForge</h1>
            <p className="text-xs text-slate-500">AI Learning Companion</p>
          </div>
          <button
            onClick={() => setSidebarOpen(false)}
            className="text-slate-500 md:hidden"
          >
            ✕
          </button>
        </div>

        <div className="px-4">
          <button
            onClick={() => void createSession()}
            className="w-full rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white hover:bg-indigo-700"
          >
            + 新建学习
          </button>
        </div>

        <div className="mt-5 space-y-1 px-3">
          {([
            ["library", "我的知识库", "library"],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              onClick={() => changeView(id)}
              className={`flex w-full items-center justify-between rounded-xl px-4 py-3 text-left text-sm transition ${
                view === id
                  ? "bg-white font-semibold text-indigo-700 shadow-sm"
                  : "text-slate-600 hover:bg-white/70"
              }`}
            >
              <span>{label}</span>
              <span className="text-xs text-slate-400">
                ›
              </span>
            </button>
          ))}
        </div>

        <details className="mx-3 mt-2 rounded-xl border border-slate-200 px-3 py-2 text-xs text-slate-500">
          <summary className="cursor-pointer select-none">历史未分类记录（旧版）</summary>
          <p className="mt-2 leading-5">升级前的错题和统计无法可靠判断属于哪个学习空间，已保留在这里。</p>
          <div className="mt-2 flex flex-col gap-1">
            {([ ["wrong", "历史错题"], ["favorites", "历史收藏"], ["stats", "历史统计"] ] as const).map(([id, label]) => (
              <button key={id} type="button" onClick={() => changeView(id)} className="rounded-lg px-3 py-2 text-left hover:bg-white">{label}</button>
            ))}
          </div>
        </details>

        <div className="mb-2 mt-6 px-5 text-[11px] font-semibold tracking-wider text-slate-400">
          最近会话
        </div>

        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3">
          {sessions.map(item => (
            <div
              key={item.id}
              onContextMenu={e => openMenu(e, item.id)}
              className={`flex items-center gap-1 rounded-xl px-2 py-1 ${
                view === "chat" && session?.id === item.id
                  ? "bg-white shadow-sm"
                  : "hover:bg-white/70"
              }`}
            >
              <button
                onClick={() => void switchSession(item)}
                className="flex min-w-0 flex-1 items-center gap-3 p-2 text-left"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {item.title}
                  </span>
                  <span className="text-[11px] text-slate-400">
                    {dateLabel(item.updatedAt)}
                  </span>
                </span>
              </button>
              <button
                title="重命名或删除"
                aria-label="会话操作"
                onClick={e => openMenu(e, item.id)}
                className="rounded-lg px-2 py-1 text-slate-400 hover:bg-slate-100"
              >
                ⋯
              </button>
            </div>
          ))}
        </div>

        <div className="border-t border-slate-200 px-5 py-4">
          <p className="text-xs text-slate-500">
            ● 浏览器本地存储
          </p>
          <p className="mt-1 text-[11px] text-slate-400">
            会话和学习记录保存在当前浏览器
          </p>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4 sm:px-6">
          <button
            onClick={() => setSidebarOpen(true)}
            className="rounded-lg p-2 hover:bg-slate-100 md:hidden"
            aria-label="打开侧边栏"
          >
            ☰
          </button>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-semibold">
              {view === "library" ? "我的知识库" :
               view === "wrong" ? "错题本" :
               view === "favorites" ? "我的收藏" :
               view === "stats" ? "学习统计" :
               (activeSpace as NamedSpaceMessage | null)?.experience === "concept_path" ? "概念理解空间" : activeSpace?.mode ? modeNames[activeSpace.mode] : activePendingSpace?.experience === "concept_path" ? "概念理解空间" : activePendingSpace ? modeNames[activePendingSpace.mode] : session?.title ?? "StudyForge"}
            </h2>
            <p className="text-xs text-slate-400">
              {view === "chat"
                ? (isSpaceOpen ? "互动学习空间" : "AI 学习工作台")
                : "Personal Learning Workspace"}
            </p>
          </div>
          {view !== "chat" && (
            <button
              onClick={() => changeView("chat")}
              className="rounded-lg border border-slate-200 px-3 py-2 text-xs hover:bg-slate-50"
            >
              返回聊天
            </button>
          )}
        </header>

        {storageError && (
          <div className="bg-amber-50 px-5 py-2 text-xs text-amber-800">
            {storageError}
          </div>
        )}

        <section className="min-h-0 flex-1 overflow-y-auto">
          {view === "chat" ? (
            <>
            <div className={`${isSpaceOpen ? "hidden " : ""}mx-auto w-full ${showWelcome ? "max-w-4xl" : "max-w-[1500px]"} px-4 py-4 sm:px-6`}>
              {!ready && <p className="text-sm text-slate-400">正在恢复学习记录...</p>}
              {showWelcome && (
                <section className="mx-auto mb-4 max-w-3xl pt-2 text-center" aria-label="欢迎使用 StudyForge">
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-600 text-xl font-bold text-white shadow-sm">S</div>
                  <p className="mt-3 text-[11px] font-semibold tracking-[0.24em] text-indigo-500">YOUR AI LEARNING COMPANION</p>
                  <h2 className="mt-1 text-2xl font-bold tracking-tight text-slate-800 sm:text-3xl">What will you learn today?</h2>
                  <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-500">上传课件、选择知识库资料，或粘贴笔记，让 StudyForge 为你创建个性化互动学习空间。</p>
                  <div className="mt-5 grid gap-3 sm:grid-cols-2">
                    <button type="button" onClick={() => fileRef.current?.click()} className="rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-indigo-300 hover:shadow-md">
                      <span className="mb-2 inline-flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-50 text-xl text-indigo-600">↑</span>
                      <span className="block text-sm font-semibold text-slate-800">上传学习资料</span>
                      <span className="mt-1 block text-xs text-slate-500">支持 PDF、DOCX、TXT</span>
                    </button>
                    <button type="button" onClick={() => textareaRef.current?.focus()} className="rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-indigo-300 hover:shadow-md">
                      <span className="mb-2 inline-flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-50 text-lg text-indigo-600">✎</span>
                      <span className="block text-sm font-semibold text-slate-800">粘贴笔记或描述学习困难</span>
                      <span className="mt-1 block text-xs text-slate-500">在下方输入框开始</span>
                    </button>
                  </div>
                  <p className="mt-3 text-xs text-slate-400">已存课件？直接在下方勾选「参考我的知识库」。</p>
                </section>
              )}
              <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
                {session?.messages
                  .filter((_, index) => !(session?.phase === "upload" && session?.messages.length === 1 && index === 0))
                  .map(message => message.mode && message.data ? (
                    <div key={message.id} className="flex flex-col gap-2" aria-label="已创建的学习空间">
                      <span className="pl-1 text-xs font-medium text-slate-500">已创建学习空间</span>
                    <div className="relative flex min-w-0 items-center rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:border-indigo-300 hover:shadow-md">
                        <button type="button" onClick={() => { setSpaceMenu(null); setActiveSpaceId(message.id); }}
                          className="group flex min-w-0 flex-1 items-center gap-4 rounded-2xl p-4 pr-2 text-left">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-xl text-indigo-600">
                            {message.mode === "graph" ? "◇" : message.mode === "flashcards" ? "▤" : message.mode === "quiz" ? "✓" : "≡"}
                          </div>
                          <div className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold text-slate-800" title={spaceTitleFromMessage(message, session?.fileInfo?.split(" · ")[0] || session?.title || "")}>
                              {spaceTitleFromMessage(message, session?.fileInfo?.split(" · ")[0] || session?.title || "")}
                            </span>
                            <span className="mt-1 block text-xs leading-5 text-slate-500">
                              {(message as NamedSpaceMessage).spaceKind === "question_bank" ? "原题题库 · 专属练习和统计" : (message as NamedSpaceMessage).experience === "concept_path" ? "概念讲解 · 知识关系 · 理解检查" : message.mode ? modeNames[message.mode] : "互动学习"} · 点击进入
                            </span>
                            {Boolean((message as NamedSpaceMessage).spaceReferenceNames?.length) && (
                              <span className="mt-1 block truncate text-xs text-slate-400" title={(message as NamedSpaceMessage).spaceReferenceNames?.join("、")}>
                                参考：{(message as NamedSpaceMessage).spaceReferenceNames?.join("、")}
                              </span>
                            )}
                          </div>
                          <span className="shrink-0 text-xs text-indigo-500">进入 →</span>
                        </button>
                        <div className="relative mr-3 shrink-0">
                          <button type="button" aria-label="学习空间操作" aria-haspopup="menu" aria-expanded={spaceMenu?.id === message.id}
                            onClick={event => {
                              if (spaceMenu?.id === message.id) { setSpaceMenu(null); return; }
                              const rect = event.currentTarget.getBoundingClientRect();
                              const menuWidth = 160;
                              const menuHeight = 96;
                              const x = Math.max(8, Math.min(window.innerWidth - menuWidth - 8, rect.right - menuWidth));
                              const y = rect.bottom + menuHeight + 8 <= window.innerHeight
                                ? rect.bottom + 6
                                : Math.max(8, rect.top - menuHeight - 6);
                              setSpaceMenu({ id: message.id, x, y });
                            }}
                            className="rounded-lg px-2 py-2 text-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700">⋯</button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div key={message.id} className={`flex min-w-0 ${message.role === "user" ? "justify-end" : "justify-start"}`}>
                      <div className={`max-w-[90%] whitespace-pre-wrap break-words rounded-2xl px-5 py-3 text-sm leading-7 shadow-sm sm:max-w-[80%] ${message.role === "user"
                        ? "rounded-br-sm bg-indigo-600 text-white"
                        : "rounded-bl-sm border border-slate-200 bg-white"}`}>
                        {message.content}
                      </div>
                    </div>
                  ))}

                {pendingSpace !== null && session !== null && pendingSpace.sessionId === session.id && !session.messages.some(message => message.id === pendingSpace.id && message.data) && (
                  <button type="button" onClick={() => setActiveSpaceId(pendingSpace.id)}
                    className="flex w-full items-center justify-between gap-3 rounded-2xl border border-indigo-200 bg-white p-4 text-left shadow-sm hover:border-indigo-400">
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-slate-800">{pendingSpace.title}</span>
                      <span className="mt-1 block text-xs text-slate-500">{pendingSpace.error ? "生成失败 · 点击查看并重试" : "正在创建 · 点击进入"}</span>
                      {Boolean(pendingSpace.sourceNames?.length) && <span className="mt-1 block text-xs text-slate-400">参考：{pendingSpace.sourceNames?.join("、")}</span>}
                    </span>
                    <span className="shrink-0 text-sm text-indigo-600">进入 →</span>
                  </button>
                )}

              {quizConfigOrigin && (
                <QuizConfig
                  key={`${session?.id ?? "new"}-${quizConfigOrigin}`}
                  onGenerate={confirmQuizConfig}
                  onCancel={() => setQuizConfigOrigin(null)}
                  disabled={busy || reading}
                />
              )}

              {flashcardConfigOrigin && (
                <FlashcardConfig
                  key={`${session?.id ?? "new"}-${flashcardConfigOrigin}`}
                  onGenerate={confirmFlashcardConfig}
                  onCancel={() => setFlashcardConfigOrigin(null)}
                  disabled={busy || reading}
                />
              )}

              {session && (session.material.trim() || libraryDocuments.length > 0) && (
                <AgentPlanner
                  key={`${session.id}-${libraryDocuments.map(d => d.id).join(",")}`}
                  sessionId={session.id}
                  material={buildStudyContext(session.material, libraryDocuments)}
                  materialForGoal={goal => buildStudyContext(session.material, libraryDocuments, goal)}
                  initialGoal={agentGoal}
                  requestKey={agentRequestKey}
                  disabled={busy || reading || Boolean(quizConfigOrigin) || Boolean(flashcardConfigOrigin)}
                  onSelect={selectAgentMode}
                />
              )}

              {session && (
                <KnowledgeReferencePicker
                  key={session.id}
                  selected={libraryDocuments}
                  onChange={changeKnowledgeSelection}
                  disabled={busy || reading}
                />
              )}

              {session && (session.material.trim() || libraryDocuments.length > 0) && (session.phase === "select" || session.phase === "complete" || session.phase === "diagnose" || libraryDocuments.length > 0) && (
                <section className="rounded-xl border border-slate-200 bg-white p-3" aria-label="原题导入">
                  <button type="button" onClick={() => setShowQuestionBankImport(v => !v)}
                    className="flex w-full items-center justify-between gap-3 text-left">
                    <span className="text-sm font-medium text-slate-700">原题导入 <span className="ml-2 text-xs font-normal text-slate-400">仅在需要练习已有题库时使用</span></span>
                    <span className="text-xs text-indigo-600">{showQuestionBankImport ? "收起" : "展开"}</span>
                  </button>
                  {showQuestionBankImport && <div id="sf-question-bank-import" className="mt-3">
                    <QuestionBankImport key={session.id} sessionId={session.id} material={buildStudyContext(session.material, libraryDocuments)} onCreateSpace={createQuestionBankSpace} />
                  </div>}
                </section>
              )}

              {(session?.phase === "select" || session?.phase === "complete" || libraryDocuments.length > 0) && !quizConfigOrigin && !flashcardConfigOrigin && (
                <div className="flex flex-wrap items-center gap-2" aria-label="手动学习方式">
                  <span className="text-xs text-slate-500">直接选择：</span>
                  {choices.map(item => (
                    <button key={item.value} onClick={() => {
                      if (session?.phase === "select" && libraryDocuments.length === 0) { handleChoice(item.value, item.label); return; }
                      if (item.value === "diagnose") { requestAgentPlan("请根据当前学习材料帮我推荐学习方式"); return; }
                      if (item.value === "quiz") { openQuizConfig("complete"); return; }
                      if (item.value === "flashcards") { openFlashcardConfig("complete"); return; }
                      void generate(item.value as Mode);
                    }}
                      className="rounded-lg border border-indigo-100 bg-indigo-50 px-3 py-2 text-xs text-indigo-700 hover:bg-indigo-100">
                      {item.value === "flashcards" ? "闪卡" : item.value === "quiz" ? "选择题" : item.value === "graph" ? "知识图谱" : "AI 推荐"}
                    </button>
                  ))}
                </div>
              )}

              {session?.phase === "diagnose" && !quizConfigOrigin && (
                <div className="grid gap-3 sm:grid-cols-2">
                  {difficulties.map(item => (
                    <button
                      key={item.value}
                      onClick={() =>
                        handleDifficulty(item.value as Mode, item.label)
                      }
                      className="rounded-xl border border-slate-200 bg-white p-4 text-left text-sm hover:border-indigo-400 hover:bg-indigo-50"
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              )}

              {(busy || reading) && (
                <div className="flex items-center gap-3 self-start rounded-2xl border border-slate-200 bg-white px-5 py-4 text-sm text-slate-500">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-indigo-100 border-t-indigo-600" />
                  {reading ? "正在解析资料..." : "DeepSeek 正在生成内容..."}
                </div>
              )}

              {error && (
                <div className="rounded-xl bg-red-50 p-4 text-sm text-red-600">
                  {error}
                </div>
              )}
              <div ref={timelineEndRef} />
              </div>
            </div>
            {activeSpace?.mode && activeSpace.data && (
              <LearningSpaceView
                key={activeSpace.id}
                mode={activeSpace.mode}
                questionBank={(activeSpace as NamedSpaceMessage).spaceKind === "question_bank"}
                data={activeSpace.data}
                spaceId={activeSpace.id}
                title={spaceTitleFromMessage(activeSpace, session?.fileInfo?.split(" · ")[0] || session?.title || "")}
                experience={(activeSpace as NamedSpaceMessage).experience}
                scopeMaterial={(activeSpace as NamedSpaceMessage).spaceScopeMaterial}
                practiceData={(activeSpace as NamedSpaceMessage).spacePractice}
                explanations={(activeSpace as NamedSpaceMessage).spaceExplanations}
                onPracticeGenerated={data => saveSpacePractice(activeSpace.id, data)}
                onExplanationGenerated={(conceptId, data) => saveSpaceExplanation(activeSpace.id, conceptId, data)}
                material={(activeSpace as NamedSpaceMessage).spaceReferenceMaterial || session?.material || ""}
                pdfSessionId={session?.fileInfo?.toLowerCase().includes(".pdf") ? session.id : undefined}
                expectedPdfName={session?.fileInfo?.split(" · ")[0]}
                onBack={() => setActiveSpaceId(null)}
              />
            )}
            {activePendingSpace && (
              <LearningSpaceView
                key={activePendingSpace.id}
                mode={activePendingSpace.mode}
                data={null}
                spaceId={activePendingSpace.id}
                title={activePendingSpace.title}
                experience={activePendingSpace.experience}
                material={activePendingSpace.referenceMaterial || session?.material || ""}
                pdfSessionId={session?.fileInfo?.toLowerCase().includes(".pdf") ? session.id : undefined}
                expectedPdfName={session?.fileInfo?.split(" · ")[0]}
                loading={!activePendingSpace.error}
                generationError={activePendingSpace.error}
                onRetry={() => void generate(
                  activePendingSpace.mode,
                  activePendingSpace.recommended,
                  activePendingSpace.quizSettings,
                  activePendingSpace.flashcardSettings,
                  activePendingSpace.referenceMaterial || activePendingSpace.scopedMaterial,
                  undefined,
                  activePendingSpace.experience
                )}
                onBack={() => setActiveSpaceId(null)}
              />
            )}
            </>
          ) : view === "library" ? (
            <KnowledgeLibraryView />
          ) : view === "stats" ? (
            <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
              <h3 className="text-xl font-semibold">学习概览</h3>
              <p className="mt-2 text-sm text-slate-500">
                根据保存在本浏览器中的实际答题记录统计。
              </p>
              <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
                {[
                  ["累计答题", stats.attempts, "次"],
                  ["正确率", accuracy, "%"],
                  ["待掌握错题", stats.wrong, "题"],
                  ["已掌握", stats.mastered, "题"],
                  ["已收藏", stats.favorites, "题"],
                  ["重点复习", stats.review, "题"],
                ].map(([label, value, unit]) => (
                  <div
                    key={String(label)}
                    className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
                  >
                    <p className="text-xs text-slate-500">{label}</p>
                    <p className="mt-3 text-2xl font-bold text-indigo-700">
                      {value}
                      <span className="ml-1 text-xs font-normal text-slate-400">
                        {unit}
                      </span>
                    </p>
                  </div>
                ))}
              </div>
              <p className="mt-5 text-xs leading-6 text-slate-400">
                历史旧版错题已迁移，但旧版没有记录的答题次数无法恢复。
                正确率 = 正确作答次数 / 总作答次数。
              </p>
            </div>
          ) : (
            <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
              {practiceIds ? (
                <div>
                  <button
                    onClick={() => setPracticeIds(null)}
                    className="mb-5 text-sm text-indigo-600"
                  >
                    ← 返回题目列表
                  </button>
                  <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                    <EnhancedQuiz
                      key={practiceKey}
                      reviewMode
                      data={{
                        title: "个人复习练习",
                        questions: practiceQuestions,
                      }}
                    />
                  </div>
                </div>
              ) : (
                <>
                  <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="text-xl font-semibold">
                        {view === "wrong" ? "我的错题" : "收藏的题目"}
                      </h3>
                      <p className="mt-1 text-sm text-slate-500">
                        {view === "wrong"
                          ? "答错的题目自动记录，可重复练习。"
                          : "答对或答错的题目都可以主动收藏。"}
                      </p>
                    </div>

                    {view === "wrong" && (
                      <label className="flex items-center gap-2 text-xs text-slate-500">
                        <input
                          type="checkbox"
                          checked={includeMastered}
                          onChange={e =>
                            setIncludeMastered(e.target.checked)
                          }
                        />
                        显示已掌握
                      </label>
                    )}
                  </div>

                  {(view === "wrong"
                    ? wrongRecords
                    : favoriteRecords
                  ).length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-10 text-center">
                      <p className="text-sm text-slate-500">
                        {view === "wrong"
                          ? "目前没有需要复习的错题。"
                          : "暂时还没有收藏题目。"}
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {(view === "wrong"
                        ? wrongRecords
                        : favoriteRecords
                      ).map(record => (
                        <div
                          key={record.id}
                          className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
                        >
                          <div className="flex flex-wrap gap-2">
                            {record.wrong && (
                              <span className="rounded-full bg-rose-50 px-2 py-1 text-[11px] text-rose-600">
                                历史错题
                              </span>
                            )}
                            {record.mastered && (
                              <span className="rounded-full bg-emerald-50 px-2 py-1 text-[11px] text-emerald-700">
                                已掌握
                              </span>
                            )}
                            {record.review && (
                              <span className="rounded-full bg-indigo-50 px-2 py-1 text-[11px] text-indigo-700">
                                重点复习
                              </span>
                            )}
                          </div>

                          <p className="mt-3 break-words text-sm font-semibold leading-7">
                            {record.question.question}
                          </p>

                          <p className="mt-2 text-xs text-slate-400">
                            作答 {record.attempts} 次 ·
                            答对 {record.correct} 次
                          </p>

                          <div className="mt-4 flex flex-wrap gap-2">
                            <button
                              onClick={() => {
                                setPracticeIds([record.id]);
                                setPracticeKey(v => v + 1);
                              }}
                              className="rounded-lg bg-indigo-600 px-3 py-2 text-xs text-white"
                            >
                              重新练习
                            </button>
                            <button
                              onClick={() => updateSaved(() =>
                                toggleFavorite(record.question)
                              )}
                              className="rounded-lg border border-slate-200 px-3 py-2 text-xs hover:bg-slate-50"
                            >
                              {record.favorite ? "取消收藏" : "收藏"}
                            </button>
                            <button
                              onClick={() => updateSaved(() =>
                                toggleReview(record.question)
                              )}
                              className="rounded-lg border border-slate-200 px-3 py-2 text-xs hover:bg-slate-50"
                            >
                              {record.review ? "取消重点" : "重点复习"}
                            </button>
                            {view === "wrong" && record.wrong && (
                              <button
                                onClick={() => updateSaved(() =>
                                  removeWrong(record.question)
                                )}
                                className="rounded-lg border border-rose-100 px-3 py-2 text-xs text-rose-600"
                              >
                                移出错题本
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {(view === "wrong" ? wrongRecords : favoriteRecords)
                    .length > 1 && (
                    <button
                      onClick={() => {
                        const list = view === "wrong"
                          ? wrongRecords : favoriteRecords;
                        setPracticeIds(list.map(r => r.id));
                        setPracticeKey(v => v + 1);
                      }}
                      className="mt-5 rounded-xl bg-indigo-600 px-5 py-3 text-sm text-white"
                    >
                      练习当前列表全部题目
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </section>

        {view === "chat" && !isSpaceOpen && (
          <footer className="shrink-0 border-t border-slate-200 bg-white px-4 py-4">
            <div className="mx-auto max-w-3xl">
              <input
                ref={fileRef}
                type="file"
                accept=".txt,.pdf,.docx"
                className="hidden"
                onChange={e => void upload(e)}
              />
              <div className="flex items-end gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-2 focus-within:border-indigo-400">
                <button
                  onClick={() => fileRef.current?.click()}
                  disabled={busy || reading || !ready}
                  className="h-10 w-10 shrink-0 rounded-xl text-2xl text-slate-500 hover:bg-slate-200 disabled:opacity-40"
                  title="上传资料"
                >
                  +
                </button>
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={keyDown}
                  disabled={busy || reading || !ready || Boolean(quizConfigOrigin)}
                  rows={1}
                  placeholder="输入学习资料或继续对话..."
                  className="max-h-32 min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-sm outline-none disabled:opacity-50"
                />
                <button
                  onClick={send}
                  disabled={!input.trim() || busy || reading || !ready || Boolean(quizConfigOrigin)}
                  className="h-10 shrink-0 rounded-xl bg-indigo-600 px-5 text-sm text-white disabled:opacity-40"
                >
                  发送
                </button>
              </div>
              <p className="mt-2 text-center text-[11px] text-slate-400">
                StudyForge · Learn Smarter, Not Harder
              </p>
            </div>
          </footer>
        )}
      </div>

      {spaceMenu && typeof document !== "undefined" && createPortal(
        <>
          <button type="button" aria-label="关闭学习空间菜单"
            className="fixed inset-0 z-[60] cursor-default"
            onClick={() => setSpaceMenu(null)} />
          <div role="menu" aria-label="学习空间操作"
            className="fixed z-[70] w-40 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl"
            style={{ left: spaceMenu.x, top: spaceMenu.y }}>
            <button type="button" role="menuitem"
              onClick={() => { const id = spaceMenu.id; setSpaceMenu(null); openSpaceDialog(id, "rename"); }}
              className="w-full rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100">重命名</button>
            <button type="button" role="menuitem"
              onClick={() => { const id = spaceMenu.id; setSpaceMenu(null); openSpaceDialog(id, "delete"); }}
              className="w-full rounded-lg px-3 py-2 text-left text-sm text-rose-600 hover:bg-rose-50">删除空间</button>
          </div>
        </>, document.body
      )}

      {spaceDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onMouseDown={event => { if (event.target === event.currentTarget) setSpaceDialog(null); }}>
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl">
            <h3 className="text-lg font-semibold text-slate-800">{spaceDialog.type === "rename" ? "重命名学习空间" : "删除学习空间"}</h3>
            {spaceDialog.type === "rename" ? (
              <input autoFocus maxLength={80} value={spaceRenameText} onChange={e => setSpaceRenameText(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") confirmSpaceDialog(); }}
                className="mt-5 w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-indigo-500" />
            ) : (
              <p className="mt-4 text-sm leading-7 text-slate-500">删除后无法恢复该学习空间，当前空间的错题、收藏与统计也将清除。原始资料、其他学习空间和旧版历史记录不受影响。</p>
            )}
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={() => setSpaceDialog(null)} className="rounded-xl border border-slate-200 px-4 py-2 text-sm">取消</button>
              <button type="button" onClick={confirmSpaceDialog}
                disabled={spaceDialog.type === "rename" && !spaceRenameText.trim()}
                className={`rounded-xl px-4 py-2 text-sm text-white disabled:opacity-40 ${spaceDialog.type === "delete" ? "bg-rose-600" : "bg-indigo-600"}`}>
                {spaceDialog.type === "rename" ? "保存" : "确认删除"}
              </button>
            </div>
          </div>
        </div>
      )}

      {menu && (
        <>
          <button
            className="fixed inset-0 z-40 cursor-default"
            aria-label="关闭菜单"
            onClick={() => setMenu(null)}
          />
          <div
            className="fixed z-50 w-40 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl"
            style={{ left: menu.x, top: menu.y }}
          >
            <button
              onClick={() => openDialog("rename", menu.id)}
              className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-100"
            >
              重命名
            </button>
            <button
              onClick={() => openDialog("delete", menu.id)}
              className="w-full rounded-lg px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50"
            >
              删除会话
            </button>
          </div>
        </>
      )}

      {dialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl">
            <h3 className="text-lg font-semibold">
              {dialog.type === "rename" ? "重命名会话" : "删除会话"}
            </h3>

            {dialog.type === "rename" ? (
              <input
                autoFocus
                value={renameText}
                maxLength={60}
                onChange={e => setRenameText(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter") void confirmDialog();
                }}
                className="mt-5 w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-indigo-500"
              />
            ) : (
              <p className="mt-4 text-sm leading-7 text-slate-500">
                删除后无法恢复该会话。收藏和答题统计仍会保留。
              </p>
            )}

            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setDialog(null)}
                className="rounded-xl border border-slate-200 px-4 py-2 text-sm"
              >
                取消
              </button>
              <button
                onClick={() => void confirmDialog()}
                disabled={dialog.type === "rename" && !renameText.trim()}
                className={`rounded-xl px-4 py-2 text-sm text-white disabled:opacity-40 ${
                  dialog.type === "delete" ? "bg-red-600" : "bg-indigo-600"
                }`}
              >
                {dialog.type === "delete" ? "确认删除" : "保存"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
