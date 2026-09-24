/** Subtle haptics via the Vibration API (no-op where unsupported, e.g. iOS Safari). */
export class Haptics {
  enabled = true;

  pulse(pattern: number | number[]): void {
    if (!this.enabled) return;
    try {
      navigator.vibrate?.(pattern);
    } catch {
      /* unsupported */
    }
  }
}
