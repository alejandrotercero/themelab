// packages/overlay/src/bridge.ts
//
// This module intentionally knows nothing about theme-state, variant-target, or
// any other consumer — it only owns the WebSocket connection and a generic
// onMessage subscription API. Message-type-specific handling (tailwindTokens,
// themeStyles, updateThemeComplete, etc.) is registered by the owning modules
// via onMessage() from their init function, to avoid import cycles (bridge must
// stay a leaf that nothing importing it gets imported back by).
import type { ClientMessage, ServerMessage } from "@themelab/shared";

type MessageHandler = (msg: ServerMessage) => void;

let ws: WebSocket | null = null;
let messageHandlers: MessageHandler[] = [];
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let onMaxRetriesExhausted: (() => void) | null = null;
let onTabTakenOver: (() => void) | null = null;
let onReconnectedCallback: (() => void) | null = null;
let savedPort: number | null = null;

type CommitResultListener = (
  success: boolean,
  errorCode?: string,
  errorMessage?: string
) => void;
let commitResultListener: CommitResultListener | null = null;

export function onCommitResult(fn: CommitResultListener): void {
  commitResultListener = fn;
}

export function connect(port: number): void {
  if (ws && ws.readyState === WebSocket.OPEN) {
    return;
  }
  savedPort = port;

  ws = new WebSocket(`ws://localhost:${port}`);

  ws.addEventListener("open", () => {
    const wasReconnect = reconnectAttempts > 0;
    reconnectAttempts = 0;
    if (wasReconnect && onReconnectedCallback) {
      onReconnectedCallback();
    }
  });

  ws.addEventListener("message", (event) => {
    try {
      const msg: ServerMessage = JSON.parse(event.data);
      // Surface transform commit results
      if (msg.type === "updatePropertyComplete" && commitResultListener) {
        commitResultListener(msg.success, msg.errorCode, msg.error);
      }
      for (const handler of messageHandlers) {
        handler(msg);
      }
    } catch {
      // Ignore malformed messages
    }
  });

  ws.addEventListener("close", (event) => {
    ws = null;

    if (event.code === 4001) {
      // Replaced by another tab — notify via disconnect callback
      if (onTabTakenOver) {
        onTabTakenOver();
      }
      return; // Don't reconnect
    }

    // Attempt reconnection with exponential backoff
    if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      const delay = 500 * 2 ** reconnectAttempts;
      reconnectAttempts += 1;
      reconnectTimer = setTimeout(() => connect(port), delay);
    } else if (onMaxRetriesExhausted) {
      onMaxRetriesExhausted();
    }
  });

  ws.addEventListener("error", () => {
    // onclose will fire after this
  });
}

export function send(msg: ClientMessage): void {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

export function onMessage(handler: MessageHandler): () => void {
  messageHandlers.push(handler);
  return () => {
    messageHandlers = messageHandlers.filter((h) => h !== handler);
  };
}

export function disconnect(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
  }
  if (ws) {
    ws.close();
    ws = null;
  }
  messageHandlers = [];
}

/** Request file discovery from CLI. Returns a promise that resolves with filePath or null. */
export function requestFileDiscovery(
  componentName: string
): Promise<string | null> {
  // Bridges the WS message-handler callback API (onMessage) to a promise;
  // no promise-returning API exists to await.
  // oxlint-disable-next-line promise/avoid-new -- see comment above
  return new Promise((resolve) => {
    const unsub = onMessage((msg) => {
      if (
        msg.type === "discoverFileResult" &&
        msg.componentName === componentName
      ) {
        unsub();
        resolve(msg.filePath);
      }
    });
    send({ type: "discoverFile", componentName });
    // Timeout after 5 seconds
    setTimeout(() => {
      unsub();
      resolve(null);
    }, 5000);
  });
}

// These register a single stored void callback invoked later by connect()/onclose,
// not an async operation; there is no promise/await form of "remember this listener".
// oxlint-disable-next-line promise/prefer-await-to-callbacks -- see comment above
export function setOnMaxRetries(callback: () => void): void {
  onMaxRetriesExhausted = callback;
}

// oxlint-disable-next-line promise/prefer-await-to-callbacks -- see setOnMaxRetries
export function setOnTabTakenOver(callback: () => void): void {
  onTabTakenOver = callback;
}

// oxlint-disable-next-line promise/prefer-await-to-callbacks -- see setOnMaxRetries
export function setOnReconnected(callback: () => void): void {
  onReconnectedCallback = callback;
}

export function manualReconnect(): void {
  if (savedPort) {
    reconnectAttempts = 0;
    connect(savedPort);
  }
}

/** Request file stat from CLI for staleness detection. */
export function requestFileStat(
  filePath: string
): Promise<{ mtime: number; size: number }> {
  // Bridges the WS message-handler callback API (onMessage) to a promise;
  // no promise-returning API exists to await.
  // oxlint-disable-next-line promise/avoid-new -- see comment above
  return new Promise((resolve) => {
    const unsub = onMessage((msg) => {
      if (msg.type === "fileStatResult" && msg.filePath === filePath) {
        unsub();
        resolve({ mtime: msg.mtime, size: msg.size });
      }
    });
    send({ type: "fileStat", filePath });
    // Timeout after 2 seconds
    setTimeout(() => {
      unsub();
      resolve({ mtime: 0, size: 0 });
    }, 2000);
  });
}
