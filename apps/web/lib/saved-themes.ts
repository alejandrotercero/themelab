// localStorage-backed library of saved themes. A tiny module-level store with an
// external-store subscription (useSyncExternalStore-friendly) so the toolbar
// "My Themes" dialog and the /library page stay in lockstep — and across tabs
// via the window `storage` event. No backend, no dependency.

import type { ThemeStyles } from "@themelab/shared";

export interface SavedTheme {
  id: string;
  name: string;
  theme: ThemeStyles; // resolved light + dark
  radius: string; // e.g. "0.625rem"
  source: string; // origin label, e.g. "ThemeLab palette"
  favorite: boolean;
  createdAt: number;
  updatedAt: number;
}

const KEY = "tl-saved-themes";

const listeners = new Set<() => void>();
let cache: SavedTheme[] = [];
let hydrated = false;

function isBrowser() {
  return typeof window !== "undefined";
}

function read(): SavedTheme[] {
  if (!isBrowser()) return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SavedTheme[]) : [];
  } catch {
    return [];
  }
}

function ensureHydrated() {
  if (hydrated || !isBrowser()) return;
  cache = read();
  hydrated = true;
  window.addEventListener("storage", (e) => {
    if (e.key !== null && e.key !== KEY) return;
    cache = read();
    emit();
  });
}

function write(next: SavedTheme[]) {
  cache = next;
  if (isBrowser()) {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // quota / private mode — keep the in-memory copy so the UI still works.
    }
  }
  emit();
}

function emit() {
  for (const l of listeners) l();
}

/** Favorites first, then most-recently-updated. */
function sortForDisplay(items: SavedTheme[]): SavedTheme[] {
  return [...items].sort((a, b) => {
    if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
    return b.updatedAt - a.updatedAt;
  });
}

function newId(): string {
  if (isBrowser() && typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `t_${Date.now().toString(36)}`;
}

function uniqueName(name: string, items: SavedTheme[], ignoreId?: string): string {
  const taken = new Set(items.filter((t) => t.id !== ignoreId).map((t) => t.name));
  if (!taken.has(name)) return name;
  let n = 2;
  while (taken.has(`${name} (${n})`)) n++;
  return `${name} (${n})`;
}

// --- public store API ---------------------------------------------------

export const savedThemesStore = {
  subscribe(listener: () => void): () => void {
    ensureHydrated();
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  /** Snapshot for useSyncExternalStore — stable reference between writes. */
  getSnapshot(): SavedTheme[] {
    ensureHydrated();
    return cache;
  },

  getServerSnapshot(): SavedTheme[] {
    return [];
  },

  list(): SavedTheme[] {
    ensureHydrated();
    return sortForDisplay(cache);
  },

  get(id: string): SavedTheme | undefined {
    ensureHydrated();
    return cache.find((t) => t.id === id);
  },

  saveNew(input: { name: string; theme: ThemeStyles; radius: string; source: string }): SavedTheme {
    ensureHydrated();
    const now = Date.now();
    const item: SavedTheme = {
      id: newId(),
      name: uniqueName(input.name.trim() || "Untitled theme", cache),
      theme: input.theme,
      radius: input.radius,
      source: input.source,
      favorite: false,
      createdAt: now,
      updatedAt: now,
    };
    write([item, ...cache]);
    return item;
  },

  update(id: string, patch: Partial<Pick<SavedTheme, "theme" | "radius" | "source" | "name">>): void {
    ensureHydrated();
    write(
      cache.map((t) =>
        t.id === id
          ? {
              ...t,
              ...patch,
              name: patch.name ? uniqueName(patch.name.trim() || t.name, cache, id) : t.name,
              updatedAt: Date.now(),
            }
          : t,
      ),
    );
  },

  rename(id: string, name: string): void {
    this.update(id, { name });
  },

  duplicate(id: string): SavedTheme | undefined {
    ensureHydrated();
    const src = cache.find((t) => t.id === id);
    if (!src) return undefined;
    const now = Date.now();
    const copy: SavedTheme = {
      ...src,
      id: newId(),
      name: uniqueName(`${src.name} copy`, cache),
      favorite: false,
      createdAt: now,
      updatedAt: now,
    };
    write([copy, ...cache]);
    return copy;
  },

  remove(id: string): void {
    ensureHydrated();
    write(cache.filter((t) => t.id !== id));
  },

  toggleFavorite(id: string): void {
    ensureHydrated();
    write(cache.map((t) => (t.id === id ? { ...t, favorite: !t.favorite, updatedAt: Date.now() } : t)));
  },
};
