// localStorage に保存する小さなストア。useSyncExternalStore から使う。
// 読み書きは try/catch で囲み、localStorage が使えない環境ではメモリ上だけで動く。

export type Store<T> = {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => T;
  getServerSnapshot: () => T;
  update: (updater: (current: T) => T) => void;
};

/**
 * @param key localStorage のキー
 * @param parse 保存されている値（JSON.parse 済み）を検証して T にする。不正なら empty を返す
 * @param empty 何も保存されていないときの値（参照を保つこと）
 */
export function createStore<T>(key: string, parse: (raw: unknown) => T, empty: T): Store<T> {
  const listeners = new Set<() => void>();
  let useMemory = false;
  let memory = empty;
  let cachedRaw: string | null | undefined;
  let cached = empty;

  function emit() {
    listeners.forEach((listener) => listener());
  }

  function getSnapshot(): T {
    if (useMemory) return memory;
    let raw: string | null;
    try {
      raw = localStorage.getItem(key);
    } catch {
      useMemory = true;
      return memory;
    }
    if (raw !== cachedRaw) {
      cachedRaw = raw;
      try {
        cached = raw === null ? empty : parse(JSON.parse(raw));
      } catch {
        cached = empty;
      }
    }
    return cached;
  }

  function update(updater: (current: T) => T) {
    const next = updater(getSnapshot());
    if (!useMemory) {
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        useMemory = true;
      }
    }
    if (useMemory) memory = next;
    emit();
  }

  function subscribe(listener: () => void) {
    listeners.add(listener);
    const onStorage = (event: StorageEvent) => {
      if (event.key === key || event.key === null) listener();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      listeners.delete(listener);
      window.removeEventListener("storage", onStorage);
    };
  }

  return { subscribe, getSnapshot, getServerSnapshot: () => empty, update };
}
