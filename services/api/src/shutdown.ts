import type { LogSink } from "./observe";

/** The part of a Node HTTP server shutdown uses. */
export interface ClosableServer {
  close: (callback?: (error?: Error) => void) => unknown;
  closeIdleConnections?: () => void;
  closeAllConnections?: () => void;
}

export interface ShutdownOptions {
  server: ClosableServer;
  closeDb: () => Promise<void>;
  log: LogSink;
  exit: (code: number) => void;
  /** How long in-flight requests get before their connections are cut. */
  timeoutMs?: number;
}

export const SHUTDOWN_GRACE_MS = 10_000;

/**
 * Builds the handler for SIGTERM and SIGINT.
 *
 * It stops accepting connections, lets requests already in flight finish, and
 * only then closes the database pool, so a request mid-query is never handed a
 * closed pool. Idle keep-alive connections are closed at once because they
 * would otherwise hold `close` open until the client let go. Past the grace
 * period the remaining connections are cut and the process exits 1, so a stuck
 * client cannot keep a deploy from replacing this process.
 *
 * Calling the returned function again while a shutdown runs returns the same
 * promise and does nothing more.
 */
export function createShutdown(options: ShutdownOptions): (signal: string) => Promise<void> {
  const { server, closeDb, log, exit, timeoutMs = SHUTDOWN_GRACE_MS } = options;
  let running: Promise<void> | null = null;

  return (signal) => {
    running ??= run(signal);
    return running;
  };

  async function run(signal: string): Promise<void> {
    log({ ts: new Date().toISOString(), level: "info", event: "shutdown", signal });

    let forced = false;
    const closed = new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    server.closeIdleConnections?.();

    const timer = setTimeout(() => {
      forced = true;
      server.closeAllConnections?.();
    }, timeoutMs);

    await closed;
    clearTimeout(timer);

    try {
      await closeDb();
    } catch (error) {
      log({
        ts: new Date().toISOString(),
        level: "error",
        event: "shutdown-error",
        message: error instanceof Error ? error.message : String(error),
      });
      exit(1);
      return;
    }
    exit(forced ? 1 : 0);
  }
}
