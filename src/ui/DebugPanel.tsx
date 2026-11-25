/**
 * M1 status panel: proves the content script, Shadow DOM mount, playback
 * tracking, fullscreen and episode changes work. Replaced by the comment
 * panel in M3.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { formatTimestamp } from '../core/time-format';
import { totalWatched } from '../core/watched-ranges';
import { getSupabaseConfig } from '../config';
import { probeConnectivity, type ConnectivityReport, type ProbeResult } from '../services/connectivity';
import { sendMessage } from '../services/messaging';
import { onShieldedKey } from './event-shield';
import { currentTime, isFullscreen, paused, videoId, watchedRanges } from './state';

type Probe = ConnectivityReport | { error: string } | 'running' | null;

function ProbeLine({ label, result }: { label: string; result: ProbeResult }) {
  return (
    <li class={result.ok ? 'st-ok' : 'st-fail'}>
      {result.ok ? '✓' : '✗'} {label}: {result.detail} ({result.ms} ms)
    </li>
  );
}

function ProbeView({ title, probe }: { title: string; probe: Probe }) {
  if (probe === null) return null;
  if (probe === 'running') return <p class="st-muted">{title}: checking…</p>;
  if ('error' in probe) return <p class="st-fail">{title}: {probe.error}</p>;
  return (
    <div>
      <p class="st-label">{title}</p>
      <ul class="st-list">
        <ProbeLine label="REST" result={probe.rest} />
        <ProbeLine label="Realtime" result={probe.realtime} />
      </ul>
    </div>
  );
}

export function DebugPanel() {
  const ranges = watchedRanges.value;
  const config = getSupabaseConfig();
  const [contentProbe, setContentProbe] = useState<Probe>(null);
  const [backgroundProbe, setBackgroundProbe] = useState<Probe>(null);
  const [typed, setTyped] = useState('');
  const [lastKey, setLastKey] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Key events in our UI are shielded from Netflix; we receive them here.
  useEffect(
    () =>
      onShieldedKey((event, target) => {
        if (target !== inputRef.current || event.type !== 'keydown') return;
        setLastKey(event.key === ' ' ? 'Space' : event.key);
        if (event.key === 'Enter') setTyped('');
      }),
    [],
  );

  const runProbes = async (): Promise<void> => {
    if (!config) return;
    setContentProbe('running');
    setBackgroundProbe('running');
    const [content, background] = await Promise.all([
      probeConnectivity(config),
      sendMessage('probe-connectivity', undefined).catch((e: unknown) => ({
        error: e instanceof Error ? e.message : String(e),
      })),
    ]);
    setContentProbe(content);
    setBackgroundProbe(background);
    console.info('[Scene Talk] connectivity', { content, background });
  };

  return (
    <aside class="st-panel" aria-label="Scene Talk">
      <header class="st-header">
        <strong>Scene Talk loaded</strong>
        <span class="st-badge">M1</span>
      </header>
      <dl class="st-grid">
        <dt>video_id</dt>
        <dd data-testid="video-id">{videoId.value ?? '—'}</dd>
        <dt>time</dt>
        <dd data-testid="current-time">
          {formatTimestamp(currentTime.value)}{' '}
          <span class="st-muted">({currentTime.value.toFixed(1)}s, {paused.value ? 'paused' : 'playing'})</span>
        </dd>
        <dt>watched</dt>
        <dd data-testid="watched">
          {formatTimestamp(totalWatched(ranges))} in {ranges.length} range{ranges.length === 1 ? '' : 's'}
        </dd>
        <dt>fullscreen</dt>
        <dd data-testid="fullscreen">{isFullscreen.value ? 'yes' : 'no'}</dd>
      </dl>
      <ol class="st-ranges" data-testid="ranges">
        {ranges.slice(-5).map(([s, e]) => (
          <li key={`${s}-${e}`}>
            {formatTimestamp(s)} – {formatTimestamp(e)}
          </li>
        ))}
      </ol>

      <label class="st-label" for="st-keytest">
        Keyboard test (type a space: playback must not pause)
      </label>
      <input
        id="st-keytest"
        ref={inputRef}
        class="st-input"
        data-testid="key-test"
        value={typed}
        onInput={(e) => setTyped((e.currentTarget as HTMLInputElement).value)}
        placeholder="Type here…"
        autocomplete="off"
      />
      <p class="st-muted">Last key seen by Scene Talk: {lastKey ?? '—'}</p>

      {config ? (
        <>
          <button type="button" class="st-button" onClick={runProbes} data-testid="probe">
            Check Supabase connectivity
          </button>
          <ProbeView title="From content script" probe={contentProbe} />
          <ProbeView title="From background" probe={backgroundProbe} />
        </>
      ) : (
        <p class="st-muted">Supabase not configured (.env) — connectivity check disabled.</p>
      )}
    </aside>
  );
}
