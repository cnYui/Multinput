import { chromium } from 'playwright';

export class BrowserRuntime {
  constructor({ baseUrl, onChange, onSurfaceCursors }) {
    this.baseUrl = baseUrl; this.onChange = onChange; this.onSurfaceCursors = onSurfaceCursors;
    this.targets = new Map(); this.contexts = []; this.recordContext = null; this.recordPage = null;
  }
  async start() {
    this.browser = await chromium.launch({ headless: process.env.MULTI_INPUT_HEADLESS !== '0' });
  }
  async open({ id, url }) {
    if (this.targets.has(id)) throw new Error(`Page ${id} already exists.`);
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Only http(s) pages are supported.');
    const context = await this.browser.newContext({ viewport: { width: 1100, height: 740 }, locale: 'zh-CN' });
    const page = await context.newPage(); this.contexts.push(context);
    this.targets.set(id, { id, url, page, context });
    try { await page.goto(url, { waitUntil: 'domcontentloaded' }); }
    catch (e) { this.targets.delete(id); await context.close(); throw e; }
    this.onChange(); return { id, url, isolation: 'independent_browser_context' };
  }
  get(id) { const p = this.targets.get(id); if (!p) throw new Error(`Unknown page ${id}. Call page_open first.`); return p; }
  async observe(id) {
    const { page } = this.get(id);
    const elements = await page.evaluate(() => {
      const fields = [...document.querySelectorAll('input,textarea,select,button,[contenteditable="true"],a[href]')];
      window.__miRefs ??= new Map();
      return fields.filter(el => !el.closest('[data-mi-overlay]') && el.getBoundingClientRect().width && el.type !== 'hidden').map((el, i) => {
        const ref = el.id || el.getAttribute('data-mi-ref') || `mi-${i}`;
        el.setAttribute('data-mi-ref', ref); window.__miRefs.set(ref, el);
        const r = el.getBoundingClientRect();
        return { ref, role: el.getAttribute('role') || el.type || el.tagName.toLowerCase(),
          label: el.getAttribute('aria-label') || [...(el.labels || [])].map(l => l.textContent.trim()).join(' ') || el.textContent.trim().slice(0, 100),
          value: el.value, checked: el.checked, disabled: el.disabled || false,
          ...(el.tagName === 'SELECT' ? { multiple: el.multiple, selected_values: [...el.selectedOptions].map(o=>o.value), options: [...el.options].map(o=>({ value:o.value, label:o.text, disabled:o.disabled })) } : {}),
          bounds: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) } };
      });
    });
    return { id, url: page.url(), title: await page.title(), elements };
  }
  async run(action, signal) {
    if (signal.aborted) throw new Error('Cancelled before browser action.');
    const { page } = this.get(action.page_id);
    if (action.op === 'form_patch') {
      const refs = action.changes.map(c => c.ref);
      this.onSurfaceCursors(action.page_id, action.changes.map((c, i) => ({ ref: c.ref, label: `输入 ${i + 1}`, op: c.op, status: 'writing' })));
      const preflight = await page.evaluate(changes => {
        const seen = new Set(), radioGroups = new Set();
        for (const c of changes) {
          if (seen.has(c.ref)) return `Duplicate target: ${c.ref}`; seen.add(c.ref);
          const el = window.__miRefs?.get(c.ref);
          if (!el?.isConnected || el.getAttribute('data-mi-ref') !== c.ref) return `Stale ref: ${c.ref}; observe again.`;
          if (el.disabled || el.readOnly || !el.getBoundingClientRect().width) return `Target not editable: ${c.ref}`;
          if (c.op === 'set_checked' && !['radio', 'checkbox'].includes(el.type)) return 'set_checked needs a radio or checkbox.';
          if (c.op === 'fill' && !['INPUT', 'TEXTAREA'].includes(el.tagName)) return 'fill needs an input or textarea.';
          if (c.op === 'fill' && ['radio', 'checkbox', 'file', 'button', 'submit'].includes(el.type)) return 'Unsupported input type for fill.';
          if (c.op === 'select_option') {
            if (el.tagName !== 'SELECT') return 'select_option needs a select element.';
            const values = Array.isArray(c.value) ? c.value : [c.value];
            if (!el.multiple && values.length > 1) return 'This select is not multiple.';
            if (values.some(v => ![...el.options].some(o => o.value === v && !o.disabled))) return `Unknown or disabled option for ${c.ref}`;
          }
          if (el.type === 'radio') {
            if (!c.value) return 'A radio choice must be true.';
            const key = `${el.form?.id || ''}:${el.name}`;
            if (el.name && radioGroups.has(key)) return 'Two changes target the same radio group.';
            radioGroups.add(key);
          }
        }
        return null;
      }, action.changes);
      if (preflight) throw new Error(preflight);
      // One tool call and evaluation. Independent targets may have overlapping, staggered input tasks.
      const result = await page.evaluate(async changes => {
        const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
        const matches = (el, c) => c.op === 'fill' ? el.value === String(c.value) : c.op === 'set_checked' ? el.checked === c.value : JSON.stringify([...el.selectedOptions].map(o => o.value).sort()) === JSON.stringify((Array.isArray(c.value) ? c.value : [c.value]).slice().sort());
        return Promise.all(changes.map(async c => {
          if (c.start_ms) await delay(c.start_ms);
          const el = window.__miRefs.get(c.ref);
          if (!el?.isConnected) return { ref: c.ref, verified: false, error: 'Target changed during patch.' };
          const phase = value => el.dispatchEvent(new CustomEvent('mi:phase', { bubbles: true, detail: { ref: c.ref, op: c.op, phase: value, at: Date.now() } }));
          phase('active');
          if (c.preview_ms) await delay(c.preview_ms);
          if (c.op === 'set_checked') { if (el.checked !== c.value) el.click(); }
          else if (c.op === 'select_option') {
            const chosen = Array.isArray(c.value) ? c.value : [c.value];
            for (const option of el.options) option.selected = chosen.includes(option.value);
            el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
          }
          else {
            const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
            const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
            const chunks = c.typing_ms ? [...new Intl.Segmenter('zh', { granularity: 'grapheme' }).segment(String(c.value))].map(s => s.segment) : [String(c.value)];
            let value = '';
            for (const chunk of chunks) {
              value += chunk; setter.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true }));
              if (c.typing_ms) await delay(c.typing_ms);
            }
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }
          phase('done');return { ref: c.ref, verified: matches(el,c) };
        }));
      }, action.changes);
      // Re-read after app event handlers and network-triggered re-renders have had a chance to run.
      await page.waitForTimeout(100);
      const final = await page.evaluate(changes => changes.map(c => {
        const el = window.__miRefs?.get(c.ref);
        const actual = c.op === 'fill' ? el?.value : c.op === 'set_checked' ? el?.checked : [...(el?.selectedOptions || [])].map(o=>o.value);
        return { ref: c.ref, actual, verified: !!el?.isConnected && (c.op === 'fill' ? actual === String(c.value) : c.op === 'set_checked' ? actual === c.value : JSON.stringify(actual.slice().sort()) === JSON.stringify((Array.isArray(c.value)?c.value:[c.value]).slice().sort())) };
      }), action.changes);
      const verified = result.length === action.changes.length && result.every(r => r.verified) && final.every(r => r.verified);
      this.onSurfaceCursors(action.page_id, action.changes.map(c => ({ ref: c.ref, status: verified ? 'done' : 'failed', op: c.op })));
      if (!verified) throw new Error(`Partial patch; inspect actual state before retrying: ${JSON.stringify(final)}`);
      return { verified, adapter: 'semantic_dom_patch', targets: final, refs };
    }
    const escaped = action.ref.replace(/["\\]/g, '\\$&');
    const el = page.locator(`[data-mi-ref="${escaped}"]`);
    if (await el.count() !== 1) throw new Error('Stale or ambiguous ref; observe again.');
    this.onSurfaceCursors(action.page_id, [{ ref: action.ref, status: 'writing', op: action.op }]);
    if (action.op === 'fill') await el.fill(String(action.value), { timeout: 5000 });
    else if (action.op === 'type_text') await el.pressSequentially(String(action.value), { delay: action.pace_ms ?? 0, timeout: 20000 });
    else if (action.op === 'set_checked') await el.setChecked(Boolean(action.value), { timeout: 5000 });
    else if (action.op === 'select_option') await el.selectOption(action.value, { timeout: 5000 });
    else if (action.op === 'click') await el.click({ timeout: 5000 });
    else throw new Error(`Unsupported browser operation: ${action.op}`);
    const verified = action.op === 'select_option' ? await el.evaluate((el, wanted) => JSON.stringify([...el.selectedOptions].map(o=>o.value).sort()) === JSON.stringify((Array.isArray(wanted)?wanted:[wanted]).slice().sort()), action.value) : action.op === 'set_checked' ? await el.isChecked() === action.value
      : ['fill', 'type_text'].includes(action.op) ? await el.inputValue() === String(action.value) : null;
    this.onSurfaceCursors(action.page_id, [{ ref: action.ref, status: verified === false ? 'failed' : 'done', op: action.op }]);
    if (verified === false) throw new Error('Final field value did not match.');
    return { verified, adapter: 'playwright', actual: action.op === 'click' ? 'click_dispatched; observe to verify its effect' : await el.inputValue().catch(() => el.isChecked()) };
  }
  async recordStart(dir) {
    if (this.recordContext) throw new Error('Already recording.');
    this.recordContext = await this.browser.newContext({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1,
      recordVideo: { dir, size: { width: 1440, height: 960 } }, locale: 'zh-CN' });
    this.recordPage = await this.recordContext.newPage();
    await this.recordPage.goto(`${this.baseUrl}/`); await this.recordPage.waitForFunction(() => window.__ready);
    this.video = this.recordPage.video(); return { recording: true };
  }
  async recordStop() {
    if (!this.recordContext) throw new Error('Not recording.');
    const video = this.video; await this.recordContext.close(); this.recordContext = null; this.recordPage = null;
    return { path: await video.path() };
  }
  async screenshot(path) { if (!this.recordPage) throw new Error('Start recording first.'); await this.recordPage.screenshot({ path, fullPage: false }); return { path }; }
  async close() { await this.browser?.close(); }
}
