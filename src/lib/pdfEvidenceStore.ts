"use client";

const DATABASE = "studyforge-pdf-evidence";
const STORE = "pdfs";
const VERSION = 1;

export type StoredPdf = {
  sessionId: string;
  filename: string;
  blob: Blob;
  savedAt: number;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE, { keyPath: "sessionId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("PDF 存储初始化失败"));
  });
}

async function transaction<T>(
  type: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, type);
    const req = action(tx.objectStore(STORE));
    let value: T;
    req.onsuccess = () => { value = req.result; };
    req.onerror = () => reject(req.error ?? new Error("PDF 读写失败"));
    tx.oncomplete = () => { db.close(); resolve(value); };
    tx.onerror = () => { db.close(); reject(tx.error ?? new Error("PDF 读写失败")); };
    tx.onabort = () => { db.close(); reject(tx.error ?? new Error("PDF 读写已取消")); };
  });
}

export async function savePdfForSession(sessionId: string, file: File): Promise<void> {
  if (!file.name.toLowerCase().endsWith(".pdf")) {
    throw new Error("只能保存 PDF 文件。");
  }
  const record: StoredPdf = {
    sessionId,
    filename: file.name,
    blob: file,
    savedAt: Date.now(),
  };
  await transaction<IDBValidKey>("readwrite", store => store.put(record));
}

export async function getPdfForSession(sessionId: string): Promise<StoredPdf | undefined> {
  return transaction<StoredPdf | undefined>("readonly", store => store.get(sessionId));
}

export async function deletePdfForSession(sessionId: string): Promise<void> {
  await transaction<undefined>("readwrite", store => store.delete(sessionId));
}
