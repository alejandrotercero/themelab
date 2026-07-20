import * as net from "node:net";

import { describe, expect, it, afterEach } from "vitest";
import { WebSocket } from "ws";

import { attachUndoIdsToBatchResults, createSketchServer } from "../server.js";

describe("attachUndoIdsToBatchResults", () => {
  it("maps successful results to the undo id for their file", () => {
    const results = [
      {
        op: "updateClass" as const,
        file: "/tmp/a.tsx",
        line: 10,
        success: true,
      },
      {
        op: "updateText" as const,
        file: "/tmp/b.tsx",
        line: 20,
        success: true,
      },
      {
        op: "reorder" as const,
        file: "/tmp/c.tsx",
        line: 30,
        success: false,
        error: "boom",
      },
    ];
    const undoEntries = [
      { filePath: "/tmp/a.tsx", content: "before-a", afterContent: "after-a" },
      { filePath: "/tmp/b.tsx", content: "before-b", afterContent: "after-b" },
    ];

    expect(
      attachUndoIdsToBatchResults(
        results,
        undoEntries,
        ["undo-a", "undo-b"],
        "/tmp"
      )
    ).toEqual([
      {
        op: "updateClass",
        file: "/tmp/a.tsx",
        line: 10,
        success: true,
        undoId: "undo-a",
      },
      {
        op: "updateText",
        file: "/tmp/b.tsx",
        line: 20,
        success: true,
        undoId: "undo-b",
      },
      {
        op: "reorder",
        file: "/tmp/c.tsx",
        line: 30,
        success: false,
        error: "boom",
        undoId: undefined,
      },
    ]);
  });

  it("resolves relative result paths before attaching undo ids", () => {
    const results = [
      {
        op: "updateClass" as const,
        file: "src/a.tsx",
        line: 10,
        success: true,
      },
    ];
    const undoEntries = [
      {
        filePath: "/tmp/project/src/a.tsx",
        content: "before-a",
        afterContent: "after-a",
      },
    ];

    expect(
      attachUndoIdsToBatchResults(
        results,
        undoEntries,
        ["undo-a"],
        "/tmp/project"
      )
    ).toEqual([
      {
        op: "updateClass",
        file: "src/a.tsx",
        line: 10,
        success: true,
        undoId: "undo-a",
      },
    ]);
  });
});

/** Pick an ephemeral port by binding a temporary server and then releasing it. */
function getEphemeralPort(): Promise<number> {
  // oxlint-disable-next-line promise/avoid-new -- wraps net.Server's listen/close callback API; there is no promise-returning equivalent to await here
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address() as net.AddressInfo;
      // oxlint-disable-next-line promise/prefer-await-to-callbacks -- net.Server#close is callback-only; no promise-returning equivalent
      srv.close((err) => {
        if (err) {
          reject(err);
        } else {
          resolve(addr.port);
        }
      });
    });
  });
}

describe("WebSocket Origin checks", () => {
  let server: ReturnType<typeof createSketchServer> | null = null;

  afterEach(() => {
    server?.close();
    server = null;
  });

  it("rejects a connection from a non-loopback Origin", async () => {
    const port = await getEphemeralPort();
    server = createSketchServer({ port, enableAi: false });

    // oxlint-disable-next-line promise/avoid-new -- wraps ws event-emitter callbacks (open/close/error); no promise-returning equivalent to await
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Timed out waiting for rejection")),
        2000
      );
      const ws = new WebSocket(`ws://127.0.0.1:${port}`, {
        origin: "http://evil.example.com",
      });
      ws.on("error", () => {
        clearTimeout(timer);
        resolve();
      });
      ws.on("close", (code) => {
        clearTimeout(timer);
        // WS close code 1006 (abnormal) or any non-zero code means the handshake was refused
        if (code === 1000) {
          reject(
            new Error(
              `Expected rejection but connection closed cleanly (code ${code})`
            )
          );
        } else {
          resolve();
        }
      });
      ws.on("open", () => {
        clearTimeout(timer);
        ws.close();
        reject(new Error("Expected connection to be rejected but it opened"));
      });
    });
  });

  it("accepts a connection with a loopback Origin", async () => {
    const port = await getEphemeralPort();
    server = createSketchServer({ port, enableAi: false });

    // oxlint-disable-next-line promise/avoid-new -- wraps ws event-emitter callbacks (open/close/error); no promise-returning equivalent to await
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Timed out waiting for connection")),
        2000
      );
      const ws = new WebSocket(`ws://127.0.0.1:${port}`, {
        origin: "http://localhost:12345",
      });
      ws.on("open", () => {
        clearTimeout(timer);
        ws.close();
        resolve();
      });
      ws.on("error", (err) => {
        clearTimeout(timer);
        reject(new Error(`Expected open but got error: ${err.message}`));
      });
    });
  });

  it("accepts a connection with no Origin header", async () => {
    const port = await getEphemeralPort();
    server = createSketchServer({ port, enableAi: false });

    // oxlint-disable-next-line promise/avoid-new -- wraps ws event-emitter callbacks (open/close/error); no promise-returning equivalent to await
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Timed out waiting for connection")),
        2000
      );
      // Passing no 'origin' option means the ws client sends no Origin header
      const ws = new WebSocket(`ws://127.0.0.1:${port}`);
      ws.on("open", () => {
        clearTimeout(timer);
        ws.close();
        resolve();
      });
      ws.on("error", (err) => {
        clearTimeout(timer);
        reject(new Error(`Expected open but got error: ${err.message}`));
      });
    });
  });
});
