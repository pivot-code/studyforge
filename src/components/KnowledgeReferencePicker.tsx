"use client";

import { useEffect, useState } from "react";
import {
  listKnowledgeLibraries, listLibraryDocuments,
  type KnowledgeLibrary, type LibraryDocument,
} from "@/lib/knowledgeLibraryStore";

export type SelectedKnowledgeDocument = Pick<LibraryDocument, "id" | "libraryId" | "name" | "text"> & { libraryTitle: string };

type Props = {
  selected: SelectedKnowledgeDocument[];
  onChange: (documents: SelectedKnowledgeDocument[]) => void;
  disabled?: boolean;
};

export default function KnowledgeReferencePicker({ selected, onChange, disabled = false }: Props) {
  const [enabled, setEnabled] = useState(false);
  const [libraries, setLibraries] = useState<KnowledgeLibrary[]>([]);
  const [documents, setDocuments] = useState<SelectedKnowledgeDocument[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<string[]>([]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    async function load() {
      try {
        const libs = await listKnowledgeLibraries();
        const groups = await Promise.all(libs.map(async lib => {
          const docs = await listLibraryDocuments(lib.id);
          return docs.map(doc => ({ id: doc.id, libraryId: doc.libraryId, name: doc.name, text: doc.text, libraryTitle: lib.title }));
        }));
        if (active) { setLibraries(libs); setDocuments(groups.flat()); setError(""); }
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : "读取知识库失败");
      } finally { if (active) setLoading(false); }
    }
    void load();
    return () => { active = false; };
  }, []);

  function toggleEnabled(next: boolean) {
    setEnabled(next);
    if (!next) onChange([]);
  }
  function toggleDocument(doc: SelectedKnowledgeDocument) {
    const already = selected.some(s => s.id === doc.id);
    if (!already && selected.length >= 8) { setError("一次最多选择 8 份资料，请精简选择范围。"); return; }
    setError("");
    onChange(already ? selected.filter(s => s.id !== doc.id) : [...selected, doc]);
  }
  function toggleLibrary(libId: string) {
    const group = documents.filter(doc => doc.libraryId === libId);
    const all = group.length > 0 && group.every(doc => selected.some(s => s.id === doc.id));
    if (all) { onChange(selected.filter(s => s.libraryId !== libId)); return; }
    const newDocs = group.filter(doc => !selected.some(s => s.id === doc.id));
    if (selected.length + newDocs.length > 8) { setError("一次最多选择 8 份资料，请逐份选择。"); return; }
    setError(""); onChange([...selected, ...newDocs]);
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-3 sm:p-4" aria-label="知识库参考设置">
      <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-slate-700">
        <input type="checkbox" checked={enabled} disabled={disabled} onChange={e => toggleEnabled(e.target.checked)} className="accent-indigo-600" />
        参考我的知识库
        <span className="ml-auto text-xs font-normal text-slate-400">{enabled ? `已选 ${selected.length} 份` : "默认关闭"}</span>
      </label>
      {enabled && (
        <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
          <p className="text-xs leading-5 text-slate-500">仅本次勾选的资料会用于学习方案和内容生成。可同时使用当前上传的资料。</p>
          {loading && <p className="text-xs text-slate-500">正在读取知识库...</p>}
          {!loading && libraries.length === 0 && <p className="text-xs text-slate-500">还没有知识库，请先在左侧「我的知识库」中创建并上传资料。</p>}
          {libraries.map(lib => {
            const group = documents.filter(doc => doc.libraryId === lib.id);
            const count = group.filter(doc => selected.some(s => s.id === doc.id)).length;
            return (
              <div key={lib.id} className="rounded-lg border border-slate-100 bg-slate-50/50 p-2.5">
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => setExpanded(old => old.includes(lib.id) ? old.filter(id => id !== lib.id) : [...old, lib.id])}
                    className="min-w-0 flex-1 text-left text-sm font-medium text-slate-700" aria-expanded={expanded.includes(lib.id)}>
                    {expanded.includes(lib.id) ? "▾" : "▸"} {lib.title}
                    <span className="ml-2 text-xs font-normal text-slate-400">{count}/{group.length}</span>
                  </button>
                  <button type="button" disabled={disabled || group.length === 0} onClick={() => toggleLibrary(lib.id)}
                    className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-indigo-600 disabled:opacity-40">
                    {group.length > 0 && count === group.length ? "取消全选" : "选择全库"}
                  </button>
                </div>
                {expanded.includes(lib.id) && (
                  <div className="mt-2 space-y-1 border-t border-slate-100 pt-2">
                    {group.length === 0 && <p className="text-xs text-slate-400">暂无资料</p>}
                    {group.map(doc => <label key={doc.id} className="flex cursor-pointer items-center gap-2 rounded-md p-1.5 text-xs text-slate-600 hover:bg-white">
                      <input type="checkbox" disabled={disabled} checked={selected.some(s => s.id === doc.id)} onChange={() => toggleDocument(doc)} className="accent-indigo-600" />
                      <span className="min-w-0 flex-1 break-all">{doc.name}</span>
                    </label>)}
                  </div>
                )}
              </div>
            );
          })}
          {enabled && selected.length === 0 && <p className="text-xs text-amber-700">请选择至少一份资料，否则不会引用知识库。</p>}
          {error && <p role="alert" className="text-xs text-rose-600">{error}</p>}
        </div>
      )}
    </section>
  );
}
