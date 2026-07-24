const DEFAULT_BUDGET_MS = 1.5;
const DEFAULT_AUTO_MAX_ITEMS = 24;

const radialOffsetCache = new Map();

/**
 * Return the integer offsets inside a circular radius, nearest first.
 * The immutable result is cached because every chunk-boundary crossing uses
 * the same pattern translated around a new player chunk.
 */
export function getRadialOffsets(radius) {
  const r = Math.max(0, Math.floor(Number(radius) || 0));
  let cached = radialOffsetCache.get(r);
  if (cached) return cached;

  const r2 = r * r;
  const offsets = [];
  for (let dz = -r; dz <= r; dz++) {
    for (let dx = -r; dx <= r; dx++) {
      const dist2 = dx * dx + dz * dz;
      if (dist2 <= r2) offsets.push(Object.freeze({ dx, dz, dist2 }));
    }
  }
  offsets.sort((a, b) => a.dist2 - b.dist2 || a.dz - b.dz || a.dx - b.dx);
  cached = Object.freeze(offsets);
  radialOffsetCache.set(r, cached);
  return cached;
}

/**
 * Small time-budgeted FIFO used by InfiniteWorld. reset() intentionally
 * replaces pending work: after a fast player move, old chunk requests are no
 * longer useful and must not delay the new nearest chunks.
 */
export class ChunkStreamScheduler {
  constructor({ budgetMs = DEFAULT_BUDGET_MS, autoMaxItems = DEFAULT_AUTO_MAX_ITEMS, now } = {}) {
    this.budgetMs = budgetMs;
    this.autoMaxItems = autoMaxItems;
    this._now = now || (() => performance.now());
    this._items = [];
    this._head = 0;
  }

  get pendingCount() {
    return Math.max(0, this._items.length - this._head);
  }

  reset(items = []) {
    this._items = Array.isArray(items) ? items : [...items];
    this._head = 0;
  }

  clear() {
    this._items = [];
    this._head = 0;
  }

  /**
   * Process nearest-first work until either the time or item budget is spent.
   * maxItems=0 means automatic scheduling, not unlimited work.
   */
  process(create, { budgetMs = this.budgetMs, maxItems = 0 } = {}) {
    if (typeof create !== 'function' || this.pendingCount === 0) {
      return { processed: 0, created: 0, elapsedMs: 0, pendingCount: this.pendingCount };
    }

    const itemLimit = maxItems > 0
      ? Math.max(1, Math.floor(maxItems))
      : this.autoMaxItems;
    const timeLimit = Number.isFinite(budgetMs) && budgetMs > 0
      ? budgetMs
      : DEFAULT_BUDGET_MS;
    const startedAt = this._now();
    let processed = 0;
    let created = 0;

    while (this._head < this._items.length && processed < itemLimit) {
      // Always allow the first item, then enforce the elapsed-time budget.
      if (processed > 0 && this._now() - startedAt >= timeLimit) break;
      const item = this._items[this._head++];
      processed++;
      if (create(item) !== false) created++;
    }

    if (this._head >= this._items.length) this.clear();
    return {
      processed,
      created,
      elapsedMs: this._now() - startedAt,
      pendingCount: this.pendingCount,
    };
  }
}

export const CHUNK_STREAM_DEFAULTS = Object.freeze({
  budgetMs: DEFAULT_BUDGET_MS,
  autoMaxItems: DEFAULT_AUTO_MAX_ITEMS,
});
