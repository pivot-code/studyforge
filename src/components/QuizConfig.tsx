
"use client";

import { useState } from "react";

export type QuizSettings = {
  scope: "comprehensive" | "focused";
  topic: string;
  count: number;
};

type Props = {
  onGenerate: (settings: QuizSettings) => void;
  onCancel: () => void;
  disabled?: boolean;
};

export default function QuizConfig({
  onGenerate,
  onCancel,
  disabled = false,
}: Props) {
  const [scope, setScope] =
    useState<QuizSettings["scope"]>("comprehensive");
  const [topic, setTopic] = useState("");
  const [count, setCount] = useState(15);

  const focused = scope === "focused";
  const canGenerate =
    !disabled && (!focused || topic.trim().length > 0);

  function submit() {
    if (!canGenerate) return;

    onGenerate({
      scope,
      topic: focused ? topic.trim() : "",
      count,
    });
  }

  return (
    <div className="w-full rounded-2xl border border-indigo-100 bg-white p-5 shadow-sm sm:p-6">
      <div className="mb-6">
        <span className="text-xs font-semibold tracking-wider text-indigo-500">
          CUSTOM QUIZ
        </span>
        <h3 className="mt-2 text-xl font-bold text-slate-800">
          创建专属测验
        </h3>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          选择复习范围与题目数量，生成适合当前学习目标的练习。
        </p>
      </div>

      <div className="space-y-3">
        <p className="text-sm font-semibold text-slate-700">
          出题范围
        </p>

        <button
          type="button"
          onClick={() => setScope("comprehensive")}
          disabled={disabled}
          className={`w-full rounded-xl border p-4 text-left transition ${
            !focused
              ? "border-indigo-400 bg-indigo-50"
              : "border-slate-200 hover:border-indigo-200"
          }`}
        >
          <div className="flex items-center gap-3">
            <span className={`flex h-4 w-4 items-center justify-center rounded-full border ${
              !focused
                ? "border-indigo-600"
                : "border-slate-300"
            }`}>
              {!focused && (
                <span className="h-2 w-2 rounded-full bg-indigo-600" />
              )}
            </span>
            <span className="text-sm font-semibold text-slate-800">
              全面覆盖
            </span>
          </div>
          <p className="ml-7 mt-2 text-xs leading-6 text-slate-500">
            尽量覆盖学习材料中的主要章节和知识点。
          </p>
        </button>

        <button
          type="button"
          onClick={() => setScope("focused")}
          disabled={disabled}
          className={`w-full rounded-xl border p-4 text-left transition ${
            focused
              ? "border-indigo-400 bg-indigo-50"
              : "border-slate-200 hover:border-indigo-200"
          }`}
        >
          <div className="flex items-center gap-3">
            <span className={`flex h-4 w-4 items-center justify-center rounded-full border ${
              focused
                ? "border-indigo-600"
                : "border-slate-300"
            }`}>
              {focused && (
                <span className="h-2 w-2 rounded-full bg-indigo-600" />
              )}
            </span>
            <span className="text-sm font-semibold text-slate-800">
              指定范围
            </span>
          </div>
          <p className="ml-7 mt-2 text-xs leading-6 text-slate-500">
            围绕指定章节、主题或知识点出题。
          </p>
        </button>

        {focused && (
          <div className="pt-2">
            <label
              htmlFor="quiz-topic"
              className="mb-2 block text-xs font-medium text-slate-600"
            >
              请输入复习范围
            </label>
            <input
              id="quiz-topic"
              value={topic}
              maxLength={120}
              onChange={e => setTopic(e.target.value)}
              disabled={disabled}
              placeholder="例如：第三章 PID 控制器"
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-indigo-400"
            />
            <p className="mt-2 text-xs text-slate-400">
              仅根据当前学习材料中与指定主题相关的内容出题。
            </p>
          </div>
        )}
      </div>

      <div className="my-6 border-t border-slate-100" />

      <div>
        <div className="mb-4 flex items-center justify-between">
          <span className="text-sm font-semibold text-slate-700">
            题目数量
          </span>
          <span className="rounded-lg bg-indigo-50 px-3 py-1.5 text-sm font-semibold text-indigo-700">
            {count} 题
          </span>
        </div>

        <input
          type="range"
          min={5}
          max={30}
          step={1}
          value={count}
          disabled={disabled}
          onChange={e => setCount(Number(e.target.value))}
          className="w-full cursor-pointer accent-indigo-600"
          aria-label="题目数量"
        />

        <div className="mt-2 flex justify-between text-xs text-slate-400">
          <span>5 题</span>
          <span>最多 30 题</span>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <label
            htmlFor="quiz-count"
            className="text-xs text-slate-500"
          >
            精确输入
          </label>
          <input
            id="quiz-count"
            type="number"
            min={5}
            max={30}
            value={count}
            disabled={disabled}
            onChange={e => {
              const value = Number(e.target.value);
              if (Number.isFinite(value)) {
                setCount(Math.max(5, Math.min(30, Math.round(value))));
              }
            }}
            className="w-24 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400"
          />
          <span className="text-xs text-slate-400">题</span>
        </div>
      </div>

      <div className="mt-7 flex flex-col-reverse gap-3 sm:flex-row">
        <button
          type="button"
          onClick={onCancel}
          disabled={disabled}
          className="rounded-xl border border-slate-200 px-5 py-3 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40"
        >
          返回
        </button>

        <button
          type="button"
          onClick={submit}
          disabled={!canGenerate}
          className="flex-1 rounded-xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          生成 {count} 道选择题 →
        </button>
      </div>
    </div>
  );
}
