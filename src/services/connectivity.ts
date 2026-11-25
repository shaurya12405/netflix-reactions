/**
 * Connectivity probe: can this JS context reach Supabase REST and Realtime?
 * Used in M1 to check whether the Netflix page's CSP blocks requests made from
 * the content script (relevant mainly in Firefox), compared to the background.
 *
 * A REST probe succeeds on ANY HTTP response (even 401): that proves the
 * request left the browser. CSP or network blocking shows up as a thrown
 * TypeError instead.
 */
import type { SupabaseConfig } from '../config';

export interface ProbeResult {
  readonly ok: boolean;
  readonly detail: string;
  readonly ms: number;
}

export interface ConnectivityReport {
  readonly rest: ProbeResult;
  readonly realtime: ProbeResult;
}

const errorText = (e: unknown): string => (e instanceof Error ? `${e.name}: ${e.message}` : String(e));

export async function probeRest(cfg: SupabaseConfig, timeoutMs = 8000): Promise<ProbeResult> {
  const started = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${cfg.url}/rest/v1/`, {
      headers: { apikey: cfg.anonKey },
      signal: controller.signal,
      cache: 'no-store',
    });
    return { ok: true, detail: `HTTP ${res.status}`, ms: Math.round(performance.now() - started) };
  } catch (e) {
    return { ok: false, detail: errorText(e), ms: Math.round(performance.now() - started) };
  } finally {
    clearTimeout(timer);
  }
}

export function probeRealtime(cfg: SupabaseConfig, timeoutMs = 8000): Promise<ProbeResult> {
  const started = performance.now();
  const elapsed = (): number => Math.round(performance.now() - started);
  return new Promise((resolve) => {
    let settled = false;
    let ws: WebSocket | null = null;
    const finish = (ok: boolean, detail: string): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
      resolve({ ok, detail, ms: elapsed() });
    };
    const timer = setTimeout(() => finish(false, `timed out after ${timeoutMs} ms`), timeoutMs);
    try {
      const wsUrl =
        cfg.url.replace(/^http/, 'ws') +
        `/realtime/v1/websocket?apikey=${encodeURIComponent(cfg.anonKey)}&vsn=1.0.0`;
      ws = new WebSocket(wsUrl);
      ws.onopen = () => finish(true, 'socket opened');
      ws.onerror = () => finish(false, 'socket error (blocked or refused)');
      ws.onclose = (ev) => finish(false, `socket closed before open (code ${ev.code})`);
    } catch (e) {
      finish(false, errorText(e));
    }
  });
}

export async function probeConnectivity(cfg: SupabaseConfig): Promise<ConnectivityReport> {
  const [rest, realtime] = await Promise.all([probeRest(cfg), probeRealtime(cfg)]);
  return { rest, realtime };
}
