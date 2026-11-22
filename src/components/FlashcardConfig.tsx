"use client";

import { useState } from "react";

export type FlashcardSettings = {
  scope: "comprehensive" | "focused";
  topic: string;
  count: number;
  detail: "concise" | "standard" | "detailed";
};

type Props = {
  onGenerate: (settings: FlashcardSettings) => void;
  onCancel: () => void;
  disabled?: boolean;
};

export default function FlashcardConfig({ onGenerate, onCancel, disabled = false }: Props) {
  const [scope, setScope] = useState<FlashcardSettings["scope"]>("comprehensive");
  const [topic, setTopic] = useState("");
  const [count, setCount] = useState(20);
  const [detail, setDetail] = useState<FlashcardSettings["detail"]>("standard");
  const canSubmit = !disabled && (scope === "comprehensive" || topic.trim().length > 0);

  return (
    <section className="rounded-2xl border border-indigo-100 bg-white p-5 shadow-sm sm:p-6">
      <h3 className="text-lg font-semibold text-slate-900">创建闪卡</h3>
      <p className="mt-1 text-sm text-slate-500">按你的复习目标生成卡组。</p>

      <div className="mt-5 space-y-3">
        <p className="text-sm font-semibold text-slate-700">复习范围</p>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
          <input type="radio" name="flashcard-scope" checked={scope === "comprehensive"} onChange={() => setScope("comprehensive")} />
          全面复习
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
          <input type="radio" name="flashcard-scope" checked={scope === "focused"} onChange={() => setScope("focused")} />
          指定章节或知识点
        </label>
        {scope === "focused" && (
          <input
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400"
            value={topic}
            onChange={event => setTopic(event.target.value)}
            maxLength={120}
            placeholder="例如：二阶系统的时域响应"
            aria-label="指定知识点"
          />
        )}
      </div>

      <div className="mt-6">
        <div className="flex items-center justify-between">
          <label htmlFor="sf-flashcard-count" className="text-sm font-semibold text-slate-700">生成数量</label>
          <span className="text-sm font-semibold text-indigo-700">{count} 张</span>
        </div>
        <input id="sf-flashcard-count" className="mt-3 w-full accent-indigo-600" type="range" min={5} max={50} step={5} value={count} onChange={event => setCount(Number(event.target.value))} />
        <div className="flex justify-between text-xs text-slate-400"><span>5 张</span><span>50 张</span></div>
      </div>

      <fieldset className="mt-6 space-y-3">
        <legend className="mb-3 text-sm font-semibold text-slate-700">答案详细程度</legend>
        {([
          ["concise", "精简", "适合快速记忆"],
          ["standard", "标准", "概念与必要解释"],
          ["detailed", "详细", "包含推导思路或补充说明"],
        ] as const).map(([value, label, description]) => (
          <label key={value} className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
            <input type="radio" name="flashcard-detail" checked={detail === value} onChange={() => setDetail(value)} />
            <span>{label}<span className="ml-2 text-xs text-slate-400">{description}</span></span>
          </label>
        ))}
      </fieldset>

      <div className="mt-7 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">取消</button>
        <button type="button" disabled={!canSubmit} onClick={() => onGenerate({ scope, topic: scope === "focused" ? topic.trim() : "", count, detail })} className="rounded-xl bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50">生成闪卡</button>
      </div>
    </section>
  );
}
