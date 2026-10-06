// Serialized into both photo-control scripts. Read only currently visible,
// eligible paths and share their existing pending/success caches with hover.
export function createPhotoInfoPreloader(paths: () => string[], read: (path: string) => Promise<unknown>) {
  const attempted = new Set<string>();
  let scheduled = false, running = 0;
  // Object methods keep serialization independent of bundler name helpers.
  const scheduler = {
    schedule() {
      if (scheduled) return;
      scheduled = true;
      if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(scheduler.pump, {timeout:350});
      else setTimeout(scheduler.pump, 80);
    },
    pump() {
      scheduled = false;
      for (const path of paths()) {
        if (running >= 2) break;
        if (attempted.has(path)) continue;
        attempted.add(path); running++;
        let pending: Promise<unknown>;
        try { pending = read(path); } catch { pending = Promise.reject(); }
        // A failed speculative read is quiet and may still be retried by hover.
        Promise.resolve(pending).catch(() => {}).finally(() => { running--; scheduler.schedule(); });
      }
    },
    reset() { attempted.clear(); scheduler.schedule(); },
  };
  return {schedule:scheduler.schedule, reset:scheduler.reset};
}
