
export type Mode = "flashcards" | "quiz" | "graph" | "keywords";
export type Phase = "upload" | "select" | "diagnose" | "complete";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content?: string;
  mode?: Mode;
  data?: unknown;
};

export type StudySession = {
  id: string;
  title: string;
  updatedAt: number;
  phase: Phase;
  material: string;
  fileInfo: string | null;
  messages: ChatMessage[];
};

const DB_NAME = "studyforge-db";
const DB_VERSION = 1;
const STORE_NAME = "sessions";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function transact<T>(
  type: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, type);
    const request = operation(transaction.objectStore(STORE_NAME));

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.onerror = () => reject(transaction.error);
    transaction.oncomplete = () => db.close();
    transaction.onabort = () => {
      db.close();
      reject(transaction.error);
    };
  });
}

export async function getSessions(): Promise<StudySession[]> {
  const sessions = await transact<StudySession[]>(
    "readonly",
    store => store.getAll()
  );
  return sessions.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getSession(
  id: string
): Promise<StudySession | undefined> {
  return transact<StudySession | undefined>(
    "readonly",
    store => store.get(id)
  );
}

export async function saveSession(
  session: StudySession
): Promise<void> {
  await transact<IDBValidKey>(
    "readwrite",
    store => store.put(session)
  );
}

export async function deleteSession(id: string): Promise<void> {
  await transact<undefined>(
    "readwrite",
    store => store.delete(id)
  );
}

export function makeSession(): StudySession {
  return {
    id: crypto.randomUUID(),
    title: "新学习会话",
    updatedAt: Date.now(),
    phase: "upload",
    material: "",
    fileInfo: null,
    messages: [{
      id: crypto.randomUUID(),
      role: "assistant",
      content:
        "你好，我是你的复习导师。请把你的学习资料发给我，或者告诉我你想复习的主题。",
    }],
  };
}
