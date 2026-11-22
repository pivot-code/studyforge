/** StudyForge knowledge libraries. Browser-local IndexedDB; separate from chat session storage. */
export type KnowledgeLibrary = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
};

export type LibraryDocument = {
  id: string;
  libraryId: string;
  name: string;
  mimeType: string;
  size: number;
  kind: "pdf" | "docx" | "txt";
  pages?: number;
  text: string;
  createdAt: number;
  original: Blob;
};

const DB_NAME = "studyforge-knowledge-libraries";
const DB_VERSION = 1;
const LIBRARIES = "libraries";
const DOCUMENTS = "documents";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("当前浏览器不支持本地知识库存储。"));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(LIBRARIES)) {
        db.createObjectStore(LIBRARIES, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(DOCUMENTS)) {
        const store = db.createObjectStore(DOCUMENTS, { keyPath: "id" });
        store.createIndex("libraryId", "libraryId", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("无法打开知识库存储。"));
    request.onblocked = () => reject(new Error("知识库存储被其他页面占用，请关闭其他标签页后重试。"));
  });
}

async function readAll<T>(storeName: string): Promise<T[]> {
  const db = await openDB();
  try {
    return await new Promise<T[]>((resolve, reject) => {
      const request = db.transaction(storeName, "readonly").objectStore(storeName).getAll();
      request.onsuccess = () => resolve(request.result as T[]);
      request.onerror = () => reject(request.error || new Error("读取失败。"));
    });
  } finally {
    db.close();
  }
}

async function putRecord<T>(storeName: string, record: T): Promise<void> {
  const db = await openDB();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeName, "readwrite");
      tx.objectStore(storeName).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("保存失败。"));
      tx.onabort = () => reject(tx.error || new Error("保存已取消。"));
    });
  } finally {
    db.close();
  }
}

async function removeRecord(storeName: string, id: string): Promise<void> {
  const db = await openDB();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeName, "readwrite");
      tx.objectStore(storeName).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("删除失败。"));
      tx.onabort = () => reject(tx.error || new Error("删除已取消。"));
    });
  } finally {
    db.close();
  }
}

export async function listKnowledgeLibraries(): Promise<KnowledgeLibrary[]> {
  const all = await readAll<KnowledgeLibrary>(LIBRARIES);
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function createKnowledgeLibrary(title: string): Promise<KnowledgeLibrary> {
  const clean = title.trim().slice(0, 60);
  if (!clean) throw new Error("请输入知识库名称。");
  const now = Date.now();
  const library: KnowledgeLibrary = { id: crypto.randomUUID(), title: clean, createdAt: now, updatedAt: now };
  await putRecord(LIBRARIES, library);
  return library;
}

export async function renameKnowledgeLibrary(library: KnowledgeLibrary, title: string): Promise<KnowledgeLibrary> {
  const clean = title.trim().slice(0, 60);
  if (!clean) throw new Error("请输入知识库名称。");
  const updated = { ...library, title: clean, updatedAt: Date.now() };
  await putRecord(LIBRARIES, updated);
  return updated;
}

export async function listLibraryDocuments(libraryId: string): Promise<LibraryDocument[]> {
  const db = await openDB();
  try {
    return await new Promise<LibraryDocument[]>((resolve, reject) => {
      const tx = db.transaction(DOCUMENTS, "readonly");
      const request = tx.objectStore(DOCUMENTS).index("libraryId").getAll(libraryId);
      request.onsuccess = () => resolve((request.result as LibraryDocument[]).sort((a, b) => b.createdAt - a.createdAt));
      request.onerror = () => reject(request.error || new Error("读取资料失败。"));
    });
  } finally {
    db.close();
  }
}

export async function addLibraryDocument(document: LibraryDocument): Promise<void> {
  const db = await openDB();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([LIBRARIES, DOCUMENTS], "readwrite");
      const docStore = tx.objectStore(DOCUMENTS);
      const libraryStore = tx.objectStore(LIBRARIES);
      const query = libraryStore.get(document.libraryId);
      query.onsuccess = () => {
        const library = query.result as KnowledgeLibrary | undefined;
        if (!library) {
          tx.abort();
          return;
        }
        docStore.put(document);
        libraryStore.put({ ...library, updatedAt: Date.now() });
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("保存资料失败，可能已达到浏览器存储上限。"));
      tx.onabort = () => reject(tx.error || new Error("保存资料失败，知识库可能已被删除。"));
    });
  } finally {
    db.close();
  }
}

export async function deleteLibraryDocument(id: string): Promise<void> {
  await removeRecord(DOCUMENTS, id);
}

export async function deleteKnowledgeLibrary(id: string): Promise<void> {
  const db = await openDB();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([LIBRARIES, DOCUMENTS], "readwrite");
      const docs = tx.objectStore(DOCUMENTS);
      const index = docs.index("libraryId");
      const request = index.openKeyCursor(IDBKeyRange.only(id));
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          docs.delete(cursor.primaryKey);
          cursor.continue();
        }
      };
      tx.objectStore(LIBRARIES).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("删除知识库失败。"));
      tx.onabort = () => reject(tx.error || new Error("删除知识库失败。"));
    });
  } finally {
    db.close();
  }
}
