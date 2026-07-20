import * as net from "node:net";

function isPortAvailable(port: number): Promise<boolean> {
  // oxlint-disable-next-line promise/avoid-new -- wrapping the event-based net.Server API in a Promise requires the constructor
  return new Promise<boolean>((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close();
      resolve(true);
    });
    server.listen(port);
  });
}

export async function getAvailablePort(preferred: number): Promise<number> {
  let port = preferred;
  while (port < preferred + 100) {
    // oxlint-disable-next-line no-await-in-loop -- ports must be probed one at a time until the first free one is found
    const available = await isPortAvailable(port);
    if (available) {
      return port;
    }
    port += 1;
  }
  throw new Error(
    `No available port found in range ${preferred}-${preferred + 99}`
  );
}

export function detectQuoteStyle(source: string): "single" | "double" {
  // Only count quotes in import/require statements to avoid JSX attribute bias
  const importLines = source
    .split("\n")
    .filter((line) => line.includes("import ") || line.includes("require("));
  const importText = importLines.join("\n");
  const singleCount = (importText.match(/'/g) || []).length;
  const doubleCount = (importText.match(/"/g) || []).length;
  // Fall back to double if no imports found (safe default for most projects)
  return singleCount > doubleCount ? "single" : "double";
}
