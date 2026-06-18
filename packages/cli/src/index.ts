// packages/cli/src/index.ts
import { program } from "commander";
import chalk from "chalk";
import open from "open";
import { detect, healthCheck } from "./detect.js";
import { createProxyServer } from "./inject.js";
import { createSketchServer } from "./server.js";
import { createMcpHttpServer } from "./mcp/server.js";
import { getAvailablePort } from "./utils.js";
import { logger, setLogLevel } from "./logger.js";

// Brand accent (matches the overlay's COLORS.accent).
const BRAND = "#ec003f";

// The "TL" (ThemeLab) mark, printed at startup.
const LOGO_LINES = [
  "████████╗██╗     ",
  "╚══██╔══╝██║     ",
  "   ██║   ██║     ",
  "   ██║   ██║     ",
  "   ██║   ███████╗",
  "   ╚═╝   ╚══════╝",
];

function printBanner(): void {
  const mark = chalk.hex(BRAND);
  const side = [
    "",
    chalk.bold.white("ThemeLab"),
    chalk.dim("Visual overlay for React dev servers"),
    "",
    chalk.hex(BRAND)("themelab.dev"),
    "",
  ];
  let out = "\n";
  for (let i = 0; i < LOGO_LINES.length; i++) {
    out += "  " + mark(LOGO_LINES[i]) + "   " + (side[i] ?? "") + "\n";
  }
  logger.info(out);
}

program
  .name("themelab")
  .description("Visual overlay for React dev servers")
  .argument("[port]", "Dev server port override")
  .option("--no-open", "Don't open browser automatically")
  .option("--host <host>", "Dev server host", "localhost")
  .option("--studio-url <url>", "ThemeLab studio base URL (for 'Open in editor')")
  .option("--no-mcp", "Disable the MCP server for coding agents")
  .option("--mcp-port <port>", "Preferred port for the MCP server")
  .option("--verbose", "Enable debug logging")
  .action(async (portArg?: string) => {
    try {
      const opts = program.opts();
      if (opts.verbose || process.env.LOG_LEVEL === "debug") {
        setLogLevel("debug");
      }
      const host = opts.host || "localhost";
      const studioUrl =
        opts.studioUrl || process.env.THEMELAB_STUDIO_URL || "https://themelab.dev";

      printBanner();

      // Detect framework
      const detection = await detect();
      const targetPort = portArg ? parseInt(portArg, 10) : detection.port;

      logger.info(
        chalk.dim("  Framework: ") + chalk.white(detection.framework)
      );
      logger.info(
        chalk.dim("  Dev server: ") +
          chalk.white(`http://${host}:${targetPort}`)
      );

      // Health check
      logger.info(chalk.dim("  Checking dev server..."));
      await healthCheck(targetPort, host);

      // Start WebSocket server
      const wsPort = await getAvailablePort(3457);
      const sketchServer = createSketchServer({ port: wsPort });

      // Start MCP server (lets coding agents read the live selection/theme).
      let mcpServer: ReturnType<typeof createMcpHttpServer> | null = null;
      let mcpPort = 0;
      if (opts.mcp !== false) {
        const preferred = opts.mcpPort ? parseInt(opts.mcpPort, 10) : 3458;
        mcpPort = await getAvailablePort(preferred);
        mcpServer = createMcpHttpServer(
          {
            getSelection: sketchServer.getSelection,
            getTheme: sketchServer.getTheme,
            getTailwindTokens: sketchServer.getTailwindTokens,
            discoverComponentFile: sketchServer.discoverComponentFile,
            isOverlayConnected: sketchServer.isOverlayConnected,
          },
          mcpPort,
        );
      }

      // Start proxy server
      const proxyPort = await getAvailablePort(3456);
      const proxyServer = createProxyServer({
        targetPort,
        targetHost: host,
        proxyPort,
        wsPort,
        studioUrl,
        getActiveClient: sketchServer.getActiveClient,
      });

      proxyServer.listen(proxyPort, "127.0.0.1", () => {
        logger.info(
          chalk.dim("  Proxy: ") +
            chalk.green(`http://localhost:${proxyPort}`)
        );
        logger.info(
          chalk.dim("  WebSocket: ") + chalk.green(`ws://localhost:${wsPort}`)
        );
        if (mcpServer) {
          logger.info(
            chalk.dim("  MCP: ") + chalk.green(`http://localhost:${mcpPort}/mcp`)
          );
        }
        logger.info(
          chalk.dim("\n  Press ") +
            chalk.white("Ctrl+C") +
            chalk.dim(" to stop\n")
        );

        if (program.opts().open !== false) {
          open(`http://localhost:${proxyPort}`);
        }
      });

      // Graceful shutdown
      const shutdown = () => {
        logger.info(chalk.dim("\n  Shutting down...\n"));
        proxyServer.close();
        sketchServer.close();
        mcpServer?.close();
        process.exit(0);
      };

      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);
    } catch (err) {
      logger.error(
        chalk.red("\n  Error: ") +
          (err instanceof Error ? err.message : String(err)) +
          "\n"
      );
      process.exit(1);
    }
  });

program.parse();
