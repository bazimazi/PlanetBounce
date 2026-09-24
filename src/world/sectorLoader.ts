import { generateSector, rebuildFromRef, type GenerateOptions, type GeneratedRef } from './generator';
import type { World } from './world';

/**
 * Generates + validates sectors off the main thread. Validation runs thousands of physics
 * simulations; the worker returns only the winning attempt index and the main thread rebuilds
 * the identical deterministic layout.
 */
export class SectorLoader {
  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<number, (ref: GeneratedRef) => void>();
  private cache = new Map<string, Promise<GeneratedRef>>();

  constructor() {
    try {
      this.worker = new Worker(new URL('./genWorker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e: MessageEvent<{ id: number; ref: GeneratedRef }>) => {
        this.pending.get(e.data.id)?.(e.data.ref);
        this.pending.delete(e.data.id);
      };
      this.worker.onerror = () => {
        this.worker = null;
      };
    } catch {
      this.worker = null;
    }
  }

  private key(o: GenerateOptions): string {
    return `${o.runSeed}:${o.regionId}:${o.sectorIndex}`;
  }

  /** Start generating early (e.g. while the player is still flying the previous sector). */
  prefetch(o: GenerateOptions): void {
    const k = this.key(o);
    if (this.cache.has(k)) return;
    this.cache.set(k, this.request(o));
  }

  async load(o: GenerateOptions): Promise<World> {
    this.prefetch(o);
    const ref = await this.cache.get(this.key(o))!;
    return rebuildFromRef(o, ref);
  }

  private request(o: GenerateOptions): Promise<GeneratedRef> {
    if (!this.worker) {
      const w = generateSector(o);
      return Promise.resolve({ attempt: w.attempt, edges: w.validatedEdges });
    }
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.worker!.postMessage({ id, options: o });
    });
  }
}
