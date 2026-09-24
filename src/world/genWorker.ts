import { generateRef, type GenerateOptions } from './generator';

self.onmessage = (e: MessageEvent<{ id: number; options: GenerateOptions }>) => {
  const ref = generateRef(e.data.options);
  (self as unknown as Worker).postMessage({ id: e.data.id, ref });
};
