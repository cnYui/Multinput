import { randomUUID } from 'node:crypto';

export class Scheduler {
  constructor({ execute, onChange = () => {}, maxParallel = 10 }) {
    this.execute = execute; this.onChange = onChange; this.maxParallel = maxParallel;
    this.jobs = new Map(); this.resourceOwners = new Map(); this.activeTotal = 0;
  }
  submit(actions, requested = 'auto') {
    if (!actions.length || actions.length > 100) throw new Error('A batch needs 1–100 actions.');
    const ids = new Set(actions.map(a => a.id)); if (ids.size !== actions.length) throw new Error('Action ids must be unique.');
    const resources = new Set(actions.map(a => a.op === 'document_insert' ? `doc:${a.document_id}:${a.cursor_id}` : `page:${a.page_id}`));
    const concurrency = Math.min(this.maxParallel, resources.size, requested === 'auto' ? resources.size : requested);
    if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error('Concurrency must be a positive integer or auto.');
    for (const a of actions) for (const dep of a.after ?? []) if (!ids.has(dep) || dep === a.id) throw new Error(`Invalid dependency ${dep}.`);
    // Reject cycles before applying any mutation.
    const pending = new Set(ids), resolved = new Set();
    while (pending.size) {
      const ready = actions.filter(a => pending.has(a.id) && (a.after ?? []).every(d => resolved.has(d)));
      if (!ready.length) throw new Error('Dependency cycle.');
      for (const a of ready) { pending.delete(a.id); resolved.add(a.id); }
    }
    const job = { id: randomUUID().slice(0, 8), requested_parallelism: requested, effective_parallelism: concurrency,
      status: 'running', created_at: Date.now(), started_at: null, finished_at: null, peak_active: 0, active: 0,
      actions: actions.map(a => ({ ...a, status: 'queued', started_at: null, finished_at: null })), controller: new AbortController() };
    this.jobs.set(job.id, job); this.onChange(); this.pump(); return this.snapshot(job.id);
  }
  resource(a) { return a.op === 'document_insert' ? `doc:${a.document_id}:${a.cursor_id}` : `page:${a.page_id}`; }
  snapshot(id) {
    const j = this.jobs.get(id); if (!j) throw new Error('Unknown job.');
    const { controller, ...rest } = j; return structuredClone(rest);
  }
  cancel(id) {
    const j = this.jobs.get(id); if (!j) throw new Error('Unknown job.');
    if (j.status === 'running') { j.controller.abort(); for (const a of j.actions) if (a.status === 'queued') a.status = 'cancelled'; }
    this.pump(); return this.snapshot(id);
  }
  pump() {
    for (const j of this.jobs.values()) {
      if (j.status !== 'running') continue;
      for (const a of j.actions) {
        if (a.status !== 'queued') continue;
        const deps = (a.after ?? []).map(id => j.actions.find(x => x.id === id));
        if (deps.some(d => ['failed', 'cancelled', 'skipped'].includes(d.status))) { a.status = 'skipped'; a.error = 'Dependency did not succeed.'; continue; }
        if (deps.some(d => d.status !== 'done')) continue;
        const key = this.resource(a);
        if (j.active >= j.effective_parallelism || this.activeTotal >= this.maxParallel || this.resourceOwners.has(key)) continue;
        this.resourceOwners.set(key, j.id); this.activeTotal++; j.active++; j.peak_active = Math.max(j.peak_active, j.active);
        j.started_at ??= Date.now(); a.started_at = Date.now(); a.status = 'running'; this.onChange();
        Promise.resolve().then(() => this.execute(a, j.controller.signal)).then(result => {
          a.result = result; a.status = 'done';
        }).catch(e => { a.error = e.message; a.status = j.controller.signal.aborted ? 'cancelled' : 'failed'; }).finally(() => {
          a.finished_at = Date.now(); j.active--; this.activeTotal--; this.resourceOwners.delete(key); this.pump(); this.onChange();
        });
      }
      if (j.actions.every(a => !['queued', 'running'].includes(a.status))) {
        j.finished_at = Date.now(); j.status = j.controller.signal.aborted ? 'cancelled' : j.actions.some(a => a.status === 'failed' || a.status === 'skipped') ? 'failed' : 'done';
      }
    }
    this.onChange();
  }
}
