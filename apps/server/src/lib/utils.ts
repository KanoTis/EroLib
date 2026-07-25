export function nowSql(): string {
  return new Date().toISOString().replace("T", " ").replace(/\.\d{3}Z$/, "");
}

/** Type guard: narrow unknown to a plain Record. */
export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Concurrency-limited async pool. */
export async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;

  async function runOne(): Promise<void> {
    while (next < items.length) {
      const i = next;
      next += 1;
      const item = items[i];
      if (item === undefined) continue;
      results[i] = await worker(item, i);
    }
  }

  const n = Math.max(1, Math.min(concurrency, items.length || 1));
  const runners: Promise<void>[] = [];
  for (let i = 0; i < n; i += 1) runners.push(runOne());
  await Promise.all(runners);
  return results;
}
