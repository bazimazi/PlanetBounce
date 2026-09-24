/**
 * Optional, local-only gameplay analytics. Used to find friction (where players fail, which
 * upgrades nobody picks) — never to manipulate. A network sink can be plugged in later.
 */
export interface TelemetryEvent {
  t: number;
  name: string;
  data?: Record<string, unknown>;
}

const KEY = 'planetbounce.telemetry.v1';
const MAX = 500;

export class Telemetry {
  enabled = true;
  private buffer: TelemetryEvent[] = [];
  sink: ((e: TelemetryEvent) => void) | null = null;

  constructor() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) this.buffer = JSON.parse(raw) as TelemetryEvent[];
    } catch {
      this.buffer = [];
    }
  }

  track(name: string, data?: Record<string, unknown>): void {
    if (!this.enabled) return;
    const e = { t: Date.now(), name, data };
    this.buffer.push(e);
    if (this.buffer.length > MAX) this.buffer.splice(0, this.buffer.length - MAX);
    this.sink?.(e);
  }

  flush(): void {
    if (!this.enabled) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(this.buffer));
    } catch {
      /* ignore */
    }
  }

  events(): readonly TelemetryEvent[] {
    return this.buffer;
  }
}
