"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { parseStudyFile } from "@/lib/parseStudyFile";
import {
  addLibraryDocument,
  createKnowledgeLibrary,
  deleteKnowledgeLibrary,
  deleteLibraryDocument,
  listKnowledgeLibraries,
  listLibraryDocuments,
  renameKnowledgeLibrary,
  type KnowledgeLibrary,
  type LibraryDocument,
} from "@/lib/knowledgeLibraryStore";

type Edit = { kind: "create" } | { kind: "rename"; item: KnowledgeLibrary } | null;
type DeleteTarget = { kind: "library"; id: string; label: string } | { kind: "document"; id: string; label: string } | null;

function formatSize(size: number) {
  return size < 1024 * 1024 ? `${Math.ceil(size / 1024)} KB` : `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : "操作失败，请重试。";
}

export default function KnowledgeLibraryView() {
  const [libraries, setLibraries] = useState<KnowledgeLibrary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [documents, setDocuments] = useState<LibraryDocument[]>([]);
  const [activeDocId, setActiveDocId] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [edit, setEdit] = useState<Edit>(null);
  const [name, setName] = useState("");
  const [deleting, setDeleting] = useState<DeleteTarget>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [uploadStatus, setUploadStatus] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  const selected = libraries.find(item => item.id === selectedId) ?? null;
  const activeDoc = documents.find(item => item.id === activeDocId) ?? null;

  async function refreshLibraries() {
    const items = await listKnowledgeLibraries();
    setLibraries(items);
    return items;
  }

  useEffect(() => {
    let cancelled = false;
    listKnowledgeLibraries().then(items => {
      if (!cancelled) setLibraries(items);
    }).catch(e => {
      if (!cancelled) setError(errorText(e));
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setDocuments([]);
    setActiveDocId(null);
    setUploadStatus("");
    if (!selectedId) return;
    listLibraryDocuments(selectedId).then(items => {
      if (!cancelled) setDocuments(items);
    }).catch(e => {
      if (!cancelled) setError(errorText(e));
    });
    return () => { cancelled = true; };
  }, [selectedId]);

  useEffect(() => {
    if (!activeDoc || activeDoc.kind !== "pdf") {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(activeDoc.original);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [activeDoc]);

  async function saveName() {
    if (!edit || !name.trim() || working) return;
    setWorking(true);
    setError("");
    try {
      if (edit.kind === "create") {
        const item = await createKnowledgeLibrary(name);
        await refreshLibraries();
        setSelectedId(item.id);
      } else {
        await renameKnowledgeLibrary(edit.item, name);
        await refreshLibraries();
      }
      setEdit(null);
      setName("");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setWorking(false);
    }
  }

  async function confirmDelete() {
    if (!deleting || working) return;
    setWorking(true);
    setError("");
    try {
      if (deleting.kind === "library") {
        await deleteKnowledgeLibrary(deleting.id);
        if (selectedId === deleting.id) setSelectedId(null);
        await refreshLibraries();
      } else {
        await deleteLibraryDocument(deleting.id);
        if (activeDocId === deleting.id) setActiveDocId(null);
        if (selectedId) setDocuments(await listLibraryDocuments(selectedId));
      }
      setDeleting(null);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setWorking(false);
    }
  }

  async function addFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    const targetId = selectedId;
    if (!files.length || !targetId || uploading) return;
    setUploading(true);
    setError("");
    let success = 0;
    const failures: string[] = [];
    for (let index = 0; index < files.length; index++) {
      const file = files[index];
      setUploadStatus(`正在解析 ${index + 1}/${files.length}：${file.name}`);
      try {
        if (!/\.(pdf|docx|txt)$/i.test(file.name)) throw new Error("仅支持 PDF、DOCX、TXT 文件");
        if (file.size > 20 * 1024 * 1024) throw new Error("单个文件不得超过 20 MB");
        const result = await parseStudyFile(file);
        if (!result.text.trim()) throw new Error("未能提取可阅读的文字");
        const kind = file.name.toLowerCase().endsWith(".pdf") ? "pdf" : file.name.toLowerCase().endsWith(".docx") ? "docx" : "txt";
        await addLibraryDocument({
          id: crypto.randomUUID(), libraryId: targetId, name: file.name,
          mimeType: file.type, size: file.size, kind,
          pages: result.pages, text: result.text,
          createdAt: Date.now(), original: file,
        });
        success++;
      } catch (e) {
        failures.push(`${file.name}：${errorText(e)}`);
      }
    }
    try {
      if (selectedId === targetId) setDocuments(await listLibraryDocuments(targetId));
      await refreshLibraries();
    } catch (e) { failures.push(errorText(e)); }
    setUploadStatus(success ? `已添加 ${success} 份资料。` : "");
    if (failures.length) setError(failures.join("；"));
    setUploading(false);
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-7 sm:px-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-slate-800">我的知识库</h2>
          <p className="mt-2 text-sm text-slate-500">按主题整理课件、笔记和题库，随时查看原始资料。</p>
        </div>
        <button type="button" onClick={() => { setName(""); setEdit({ kind: "create" }); setError(""); }} className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-700">＋ 新建知识库</button>
      </div>
      <div className="mb-5 rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs leading-6 text-slate-500">
        知识库保存在当前浏览器。目前只有你在此页面上传的资料会进入知识库；AI 不会自动读取它们。后续接入 AI 时，你可以自行勾选是否参考知识库。
      </div>
      {error && <div role="alert" className="mb-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}
      {loading ? <p className="text-sm text-slate-500">正在读取知识库…</p> : (
        <div className="grid min-h-[420px] gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
          <div className="space-y-2">
            {libraries.length === 0 && <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">还没有知识库。先创建一个学习主题。</div>}
            {libraries.map(item => (
              <div key={item.id} className={`rounded-xl border p-3 transition ${selectedId === item.id ? "border-indigo-300 bg-indigo-50/70" : "border-slate-200 bg-white"}`}>
                <div className="flex items-center gap-2">
                  <button className="min-w-0 flex-1 text-left" onClick={() => setSelectedId(item.id)} type="button">
                    <span className="block truncate text-sm font-semibold text-slate-800">{item.title}</span>
                    <span className="mt-1 block text-xs text-slate-400">更新于 {new Date(item.updatedAt).toLocaleDateString("zh-CN")}</span>
                  </button>
                  <button type="button" aria-label={`重命名${item.title}`} title="重命名" className="rounded-lg px-2 py-1 text-sm text-indigo-600 hover:bg-indigo-100" onClick={() => { setName(item.title); setEdit({ kind: "rename", item }); }}>编辑</button>
                  <button type="button" aria-label={`删除${item.title}`} title="删除" className="rounded-lg px-2 py-1 text-sm text-rose-600 hover:bg-rose-50" onClick={() => setDeleting({ kind: "library", id: item.id, label: item.title })}>删除</button>
                </div>
              </div>
            ))}
          </div>
          <div className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
            {!selected ? <div className="flex h-full min-h-[260px] items-center justify-center text-sm text-slate-400">选择左侧的知识库，查看和管理资料。</div> : (
              <>
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate text-base font-semibold text-slate-800">{selected.title}</h3>
                    <p className="mt-1 text-xs text-slate-500">{documents.length} 份资料</p>
                  </div>
                  <button type="button" disabled={uploading} onClick={() => fileInput.current?.click()} className="rounded-xl border border-indigo-200 px-4 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-50 disabled:opacity-40">上传资料</button>
                  <input ref={fileInput} className="hidden" type="file" multiple accept=".pdf,.docx,.txt" onChange={e => void addFiles(e)} />
                </div>
                {uploadStatus && <p className="mb-3 text-xs text-indigo-600" role="status">{uploadStatus}</p>}
                {documents.length === 0 && <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-500">这里还没有资料。支持 PDF、DOCX 和 TXT，可一次上传多份。</div>}
                {documents.length > 0 && (
                  <div className="grid gap-4 xl:grid-cols-[minmax(0,260px)_minmax(0,1fr)]">
                    <div className="space-y-2">
                      {documents.map(doc => (
                        <div key={doc.id} className={`flex items-center gap-2 rounded-xl border p-3 ${activeDocId === doc.id ? "border-indigo-300 bg-indigo-50" : "border-slate-200"}`}>
                          <button type="button" onClick={() => setActiveDocId(doc.id)} className="min-w-0 flex-1 text-left">
                            <span className="block break-all text-sm font-medium text-slate-800">{doc.name}</span>
                            <span className="mt-1 block text-xs text-slate-500">{doc.kind.toUpperCase()} · {formatSize(doc.size)}</span>
                          </button>
                          <button type="button" title="删除资料" aria-label={`删除${doc.name}`} onClick={() => setDeleting({ kind: "document", id: doc.id, label: doc.name })} className="rounded-lg px-2 py-1 text-xs text-rose-600 hover:bg-rose-50">删除</button>
                        </div>
                      ))}
                    </div>
                    <div className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
                      {!activeDoc ? <div className="flex min-h-[240px] items-center justify-center p-5 text-sm text-slate-400">点击资料名称预览</div> : (
                        <>
                          <div className="border-b border-slate-200 bg-white px-4 py-3">
                            <p className="break-all text-sm font-semibold text-slate-800">{activeDoc.name}</p>
                            <p className="mt-1 text-xs text-slate-500">{activeDoc.pages ? `${activeDoc.pages} 页 · ` : ""}{activeDoc.text.length} 字符（提取文本）</p>
                          </div>
                          {activeDoc.kind === "pdf" && previewUrl ? (
                            <iframe title={`${activeDoc.name} 原始 PDF`} src={previewUrl} className="h-[480px] w-full bg-white" />
                          ) : (
                            <pre className="max-h-[480px] overflow-auto whitespace-pre-wrap break-words p-4 font-sans text-sm leading-7 text-slate-700">{activeDoc.text}</pre>
                          )}
                          {activeDoc.kind === "pdf" && <details className="border-t border-slate-200 p-3 text-xs text-slate-600"><summary className="cursor-pointer">查看提取文本</summary><pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-words font-sans">{activeDoc.text}</pre></details>}
                        </>
                      )}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
      {edit && <div role="presentation" className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 p-4"><div role="dialog" aria-modal="true" aria-label={edit.kind === "create" ? "新建知识库" : "重命名知识库"} className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"><h3 className="text-lg font-semibold">{edit.kind === "create" ? "新建知识库" : "重命名知识库"}</h3><input autoFocus maxLength={60} className="mt-5 w-full rounded-xl border border-slate-300 px-3 py-3 text-sm outline-none focus:border-indigo-500" placeholder="例如：自动控制原理" value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === "Enter") void saveName(); }} /><div className="mt-5 flex justify-end gap-2"><button className="rounded-xl border border-slate-200 px-4 py-2 text-sm" onClick={() => setEdit(null)} disabled={working}>取消</button><button className="rounded-xl bg-indigo-600 px-4 py-2 text-sm text-white disabled:opacity-40" disabled={working || !name.trim()} onClick={() => void saveName()}>保存</button></div></div></div>}
      {deleting && <div role="presentation" className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 p-4"><div role="alertdialog" aria-modal="true" aria-label="确认删除" className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"><h3 className="text-lg font-semibold">确认删除？</h3><p className="mt-3 break-all text-sm leading-7 text-slate-600">{deleting.kind === "library" ? "删除知识库将同时删除库内所有资料。" : "即将删除这份资料。"}<br />{deleting.label}<br />此操作无法撤销，不会删除其他学习会话。</p><div className="mt-5 flex justify-end gap-2"><button disabled={working} className="rounded-xl border border-slate-200 px-4 py-2 text-sm" onClick={() => setDeleting(null)}>取消</button><button disabled={working} className="rounded-xl bg-rose-600 px-4 py-2 text-sm text-white disabled:opacity-40" onClick={() => void confirmDelete()}>确认删除</button></div></div></div>}
    </div>
  );
}
