import * as Y from 'yjs';

const colors = ['#66e0c2', '#f7bb72', '#a9a0ff', '#ff8fa8', '#83c8ff', '#d9dc79', '#e3a4f4', '#8de3a8', '#ffae8c', '#b7c5ff'];
const segmenter = new Intl.Segmenter('zh', { granularity: 'grapheme' });
export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export class DocumentStore {
  constructor(onChange = () => {}) { this.docs = new Map(); this.onChange = onChange; }
  get(id) { const d = this.docs.get(id); if (!d) throw new Error(`Unknown document: ${id}`); return d; }
  create({ id = 'document', title = 'Untitled', text }) {
    if (this.docs.has(id)) throw new Error('Document already exists; use a new id.');
    const ydoc = new Y.Doc(); const ytext = ydoc.getText('body'); ytext.insert(0, text);
    const doc = { id, title, ydoc, ytext, cursors: new Map(), revision: 1, busy: new Set() };
    this.docs.set(id, doc);
    ydoc.on('update', () => { doc.revision++; this.onChange(); });
    this.onChange(); return this.snapshot(id);
  }
  position(doc, anchor) {
    const result = Y.createAbsolutePositionFromRelativePosition(anchor, doc.ydoc);
    if (!result || result.type !== doc.ytext) throw new Error('Anchor is no longer resolvable.');
    return result.index;
  }
  anchor(doc, offset, assoc = -1) { return Y.createRelativePositionFromTypeIndex(doc.ytext, offset, assoc); }
  lines(id) {
    const text = this.get(id).ytext.toString(); let offset = 0;
    return text.split('\n').map((content, i) => { const line = { line: i + 1, start: offset, end: offset + content.length, text: content }; offset += content.length + 1; return line; });
  }
  snapshot(id) {
    const d = this.get(id);
    return { id, title: d.title, text: d.ytext.toString(), revision: d.revision, lines: this.lines(id),
      cursors: [...d.cursors.values()].map(c => ({ id: c.id, color: c.color, status: c.status,
        head: this.position(d, c.head), from: this.position(d, c.from), to: this.position(d, c.to),
        inserted: c.inserted, lock: c.lock })) };
  }
  lock(id, requests) {
    const d = this.get(id); const lines = this.lines(id); const proposed = [];
    for (const [i, r] of requests.entries()) {
      if (d.cursors.has(r.id) || proposed.some(x => x.id === r.id)) throw new Error(`Cursor already exists: ${r.id}`);
      const line = lines[r.line - 1]; if (!line) throw new Error(`Line ${r.line} does not exist.`);
      const column = r.column ?? line.text.length;
      if (!Number.isInteger(column) || column < 0 || column > line.text.length) throw new Error('Column is a zero-based UTF-16 offset within the line.');
      // Whole-line leases: offsets in other lines remain stable as earlier lines grow.
      const range = { from: line.start, to: line.end };
      const conflicts = [...d.cursors.values()].filter(c => c.lock).map(c => ({ id: c.id, from: this.position(d, c.from), to: this.position(d, c.to) })).concat(proposed.map(c => ({ id: c.id, from: c.rawFrom, to: c.rawTo })));
      if (conflicts.some(c => range.from <= c.to && range.to >= c.from)) throw new Error(`Line ${r.line} overlaps an existing lease.`);
      proposed.push({ id: r.id, color: colors[(d.cursors.size + i) % colors.length],
        from: this.anchor(d, line.start), to: this.anchor(d, line.end, 0), head: this.anchor(d, line.start + column),
        rawFrom: line.start, rawTo: line.end, status: 'locked', inserted: '', lock: true });
    }
    for (const c of proposed) d.cursors.set(c.id, c);
    this.onChange(); return this.snapshot(id);
  }
  unlock(id, cursorIds) {
    const d = this.get(id);
    for (const cid of cursorIds) {
      if (d.busy.has(cid)) throw new Error(`Cursor ${cid} is writing; cancel or wait before unlocking.`);
      const c = d.cursors.get(cid); if (c) { c.lock = false; c.status = 'released'; }
    }
    this.onChange(); return this.snapshot(id);
  }
  async insert(id, cursorId, text, { paceMs = 0, signal, onProgress = () => {} } = {}) {
    const d = this.get(id); const c = d.cursors.get(cursorId);
    if (!c?.lock) throw new Error(`Cursor ${cursorId} needs a live lease.`);
    if (d.busy.has(cursorId)) throw new Error(`Cursor ${cursorId} already has an active writer.`);
    d.busy.add(cursorId); c.status = 'writing'; this.onChange();
    // Each input lane edits its own Y.Doc replica. Updates merge through the shared master.
    const replica = new Y.Doc(); Y.applyUpdate(replica, Y.encodeStateAsUpdate(d.ydoc));
    const localText = replica.getText('body'); const origin = { cursorId };
    const fromMaster = (update, updateOrigin) => { if (updateOrigin !== origin) Y.applyUpdate(replica, update, 'master'); };
    const fromReplica = (update, updateOrigin) => { if (updateOrigin !== 'master') Y.applyUpdate(d.ydoc, update, origin); };
    d.ydoc.on('update', fromMaster); replica.on('update', fromReplica);
    let head = c.head; let written = '';
    try {
      const chunks = paceMs ? [...segmenter.segment(text)].map(s => s.segment) : [text];
      for (const chunk of chunks) {
        if (signal?.aborted) throw new Error('Cancelled; already inserted text is retained.');
        const point = Y.createAbsolutePositionFromRelativePosition(head, replica);
        if (!point) throw new Error('Cursor anchor became stale.');
        replica.transact(() => localText.insert(point.index, chunk), cursorId);
        head = Y.createRelativePositionFromTypeIndex(localText, point.index + chunk.length, -1);
        c.head = head; c.inserted += chunk; written += chunk; this.onChange(); onProgress(written.length);
        if (paceMs) await sleep(paceMs);
      }
      c.status = 'done';
      return { verified: true, cursor_id: cursorId, inserted_text: written, head: this.position(d, c.head), revision: d.revision };
    } catch (e) { c.status = signal?.aborted ? 'cancelled' : 'failed'; throw e; }
    finally { d.ydoc.off('update', fromMaster); replica.off('update', fromReplica); replica.destroy(); d.busy.delete(cursorId); this.onChange(); }
  }
  replace(id, text, revision) {
    const d = this.get(id);
    if ([...d.cursors.values()].some(c => c.lock)) throw new Error('Release cursor leases before manual replacement.');
    if (revision !== d.revision) throw new Error('Document changed; refresh before replacing.');
    d.ydoc.transact(() => { d.ytext.delete(0, d.ytext.length); d.ytext.insert(0, text); });
    return this.snapshot(id);
  }
}
