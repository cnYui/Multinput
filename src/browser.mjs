import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const mime = f => ({ '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' })[path.extname(f).toLowerCase()] || 'application/octet-stream';

export class BrowserRuntime {
  constructor({ baseUrl, onChange, onSurfaceCursors }) {
    this.baseUrl = baseUrl; this.onChange = onChange; this.onSurfaceCursors = onSurfaceCursors;
    this.targets = new Map(); this.contexts = []; this.recordContext = null; this.recordPage = null;
  }
  async start() {
    const headless = process.env.MULTI_INPUT_HEADLESS !== '0';
    // Without a UTF-8 locale Chromium drops non-ASCII upload paths such as 上传版.mp4.
    const env = { ...process.env, LANG: process.env.LANG || 'C.UTF-8' };
    const launch = { headless, env, ...(process.env.MULTI_INPUT_CHANNEL ? { channel: process.env.MULTI_INPUT_CHANNEL } : {}),
      ...(process.env.MULTI_INPUT_EXECUTABLE_PATH ? { executablePath: process.env.MULTI_INPUT_EXECUTABLE_PATH } : {}) };
    if (process.env.MULTI_INPUT_CDP_URL) {
      // Attach to a browser the user already runs and is signed in to. Pages share its login state.
      this.mode = 'cdp';
      this.browser = await chromium.connectOverCDP(process.env.MULTI_INPUT_CDP_URL);
      this.shared = this.browser.contexts()[0] ?? await this.browser.newContext();
    } else if (process.env.MULTI_INPUT_USER_DATA_DIR) {
      // A dedicated persistent profile: log in once (npm run login), cookies stay for later runs.
      this.mode = 'persistent';
      this.shared = await chromium.launchPersistentContext(process.env.MULTI_INPUT_USER_DATA_DIR, { ...launch, viewport: null, locale: 'zh-CN' });
    } else {
      this.mode = 'isolated';
      this.browser = await chromium.launch(launch);
    }
  }
  async open({ id, url }) {
    if (this.targets.has(id)) throw new Error(`Page ${id} already exists.`);
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Only http(s) pages are supported.');
    const context = this.shared ?? await this.browser.newContext({ viewport: { width: 1100, height: 740 }, locale: 'zh-CN' });
    const page = await context.newPage(); if (!this.shared) this.contexts.push(context);
    this.targets.set(id, { id, url, page, context, ownsContext: !this.shared, ownsPage: true });
    try { await page.goto(url, { waitUntil: 'domcontentloaded' }); }
    catch (e) { this.targets.delete(id); await (this.shared ? page.close() : context.close()); throw e; }
    this.onChange(); return { id, url, isolation: this.shared ? `shared_${this.mode}_login_context` : 'independent_browser_context' };
  }
  async attach({ id, url_contains }) {
    if (!this.shared) throw new Error('page_attach needs MULTI_INPUT_CDP_URL or MULTI_INPUT_USER_DATA_DIR.');
    if (this.targets.has(id)) throw new Error(`Page ${id} already exists.`);
    const taken = new Set([...this.targets.values()].map(t => t.page));
    const page = this.shared.pages().find(p => !taken.has(p) && p.url().includes(url_contains));
    if (!page) throw new Error(`No open tab matches ${url_contains}. Open tabs: ${this.shared.pages().map(p => p.url()).join(', ')}`);
    this.targets.set(id, { id, url: page.url(), page, context: this.shared, ownsContext: false, ownsPage: false });
    this.onChange(); return { id, url: page.url(), isolation: `shared_${this.mode}_login_context`, attached: true };
  }
  async release(target) {
    if (target.ownsContext) await target.context.close();
    else if (target.ownsPage) await target.page.close();
  }
  get(id) { const p = this.targets.get(id); if (!p) throw new Error(`Unknown page ${id}. Call page_open first.`); return p; }
  async observe(id, { selector, include_links = true } = {}) {
    const { page } = this.get(id);
    const elements = await page.evaluate(({ selector, include_links }) => {
      const scope = selector ? document.querySelector(selector) : document;
      if (!scope) throw new Error(`Selector not found: ${selector}`);
      const query = 'input,textarea,select,button,[contenteditable="true"],[contenteditable=""],[role=switch],[role=checkbox],[role=radio],[role=combobox],[role=button],[role=tab]' + (include_links ? ',a[href]' : '');
      const fields = [...scope.querySelectorAll(query)];
      window.__miRefs ??= new Map();
      // File inputs are usually hidden behind a styled drop zone, so keep them even with zero size.
      return fields.filter(el => !el.closest('[data-mi-overlay]') && (el.getBoundingClientRect().width || el.type === 'file') && el.type !== 'hidden').map((el, i) => {
        const ref = el.id || el.getAttribute('data-mi-ref') || `mi-${i}`;
        el.setAttribute('data-mi-ref', ref); window.__miRefs.set(ref, el);
        const r = el.getBoundingClientRect();
        return { ref, role: el.getAttribute('role') || el.type || el.tagName.toLowerCase(),
          label: el.getAttribute('aria-label') || [...(el.labels || [])].map(l => l.textContent.trim()).join(' ') || el.getAttribute('placeholder') || el.getAttribute('data-placeholder') || el.textContent.trim().slice(0, 100),
          ...(el.isContentEditable ? { role: el.getAttribute('role') || 'contenteditable', text: el.innerText.slice(0, 2000) } : { value: el.value }),
          ...(el.type === 'file' ? { accept: el.accept, multiple: el.multiple } : {}),
          checked: el.checked ?? (el.hasAttribute('aria-checked') ? el.getAttribute('aria-checked') === 'true' : undefined), disabled: el.disabled || false,
          ...(el.tagName === 'SELECT' ? { multiple: el.multiple, selected_values: [...el.selectedOptions].map(o=>o.value), options: [...el.options].map(o=>({ value:o.value, label:o.text, disabled:o.disabled })) } : {}),
          bounds: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) } };
      });
    }, { selector, include_links });
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
          if (c.op === 'fill' && el.isContentEditable) continue;
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
        const norm = t => String(t).replace(/\s+/g, ' ').trim();
        const matches = (el, c) => c.op === 'fill' ? (el.isContentEditable ? norm(el.innerText) === norm(c.value) : el.value === String(c.value)) : c.op === 'set_checked' ? el.checked === c.value : JSON.stringify([...el.selectedOptions].map(o => o.value).sort()) === JSON.stringify((Array.isArray(c.value) ? c.value : [c.value]).slice().sort());
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
          else if (el.isContentEditable) {
            // Rich editors (Quill, ProseMirror, Vue editors) listen to beforeinput/input from execCommand.
            el.focus();
            const range = document.createRange(); range.selectNodeContents(el);
            const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);
            const chunks = c.typing_ms ? [...new Intl.Segmenter('zh', { granularity: 'grapheme' }).segment(String(c.value))].map(s => s.segment) : String(c.value).split(/(\n)/).filter(Boolean);
            document.execCommand('delete');
            for (const chunk of chunks) {
              if (chunk === '\n') document.execCommand('insertParagraph'); else document.execCommand('insertText', false, chunk);
              if (c.typing_ms) await delay(c.typing_ms);
            }
            el.blur();
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
        const norm = t => String(t).replace(/\s+/g, ' ').trim();
        if (c.op === 'fill' && el?.isContentEditable) return { ref: c.ref, actual: el.innerText, verified: el.isConnected && norm(el.innerText) === norm(c.value) };
        const actual = c.op === 'fill' ? el?.value : c.op === 'set_checked' ? el?.checked : [...(el?.selectedOptions || [])].map(o=>o.value);
        return { ref: c.ref, actual, verified: !!el?.isConnected && (c.op === 'fill' ? actual === String(c.value) : c.op === 'set_checked' ? actual === c.value : JSON.stringify(actual.slice().sort()) === JSON.stringify((Array.isArray(c.value)?c.value:[c.value]).slice().sort())) };
      }), action.changes);
      const verified = result.length === action.changes.length && result.every(r => r.verified) && final.every(r => r.verified);
      this.onSurfaceCursors(action.page_id, action.changes.map(c => ({ ref: c.ref, status: verified ? 'done' : 'failed', op: c.op })));
      if (!verified) throw new Error(`Partial patch; inspect actual state before retrying: ${JSON.stringify(final)}`);
      return { verified, adapter: 'semantic_dom_patch', targets: final, refs };
    }
    if (action.op === 'click_text' || action.op === 'wait_text') {
      // Custom dropdowns, tag pickers and popups are not native controls: locate by visible text with trusted input.
      const scope = action.selector ? page.locator(action.selector).first() : action.ref ? page.locator(`[data-mi-ref="${action.ref.replace(/["\\]/g, '\\$&')}"]`) : page;
      const target = scope.getByText(String(action.value), { exact: action.exact ?? false }).locator('visible=true').first();
      const timeout = action.timeout_ms ?? (action.op === 'wait_text' ? 30000 : 5000);
      this.onSurfaceCursors(action.page_id, [{ ref: action.ref ?? 'text', status: 'writing', op: action.op }]);
      if (action.op === 'click_text') await target.click({ timeout }); else await target.waitFor({ state: 'visible', timeout });
      this.onSurfaceCursors(action.page_id, [{ ref: action.ref ?? 'text', status: 'done', op: action.op }]);
      return { verified: action.op === 'wait_text' ? true : null, adapter: 'playwright_text', actual: action.op === 'click_text' ? 'click_dispatched; observe to verify its effect' : 'visible' };
    }
    if (action.op === 'press' && !action.ref) { await page.keyboard.press(String(action.value)); return { verified: null, adapter: 'playwright', actual: 'key_dispatched' }; }
    const escaped = action.ref.replace(/["\\]/g, '\\$&');
    const el = page.locator(`[data-mi-ref="${escaped}"]`);
    if (await el.count() !== 1) throw new Error('Stale or ambiguous ref; observe again.');
    this.onSurfaceCursors(action.page_id, [{ ref: action.ref, status: 'writing', op: action.op }]);
    if (action.op === 'upload') {
      const files = (Array.isArray(action.value) ? action.value : [action.value]).map(String);
      const root = process.env.MULTI_INPUT_UPLOAD_ROOT && path.resolve(process.env.MULTI_INPUT_UPLOAD_ROOT);
      for (const f of files) {
        if (!path.isAbsolute(f)) throw new Error(`Upload path must be absolute: ${f}`);
        if (root && !path.resolve(f).startsWith(root + path.sep)) throw new Error(`Upload path is outside MULTI_INPUT_UPLOAD_ROOT: ${f}`);
        if (!fs.statSync(f, { throwIfNoEntry: false })?.isFile()) throw new Error(`Upload file not found: ${f}`);
      }
      const isFileInput = await el.evaluate(n => n.tagName === 'INPUT' && n.type === 'file');
      if (isFileInput) {
        await el.setInputFiles(files, { timeout: 10000 });
        // A browser started elsewhere (CDP) may still drop non-ASCII paths; resend small files as payloads.
        if (!await el.evaluate((n, count) => n.files.length === count, files.length) && files.every(f => fs.statSync(f).size < 50 * 1024 * 1024))
          await el.setInputFiles(files.map(f => ({ name: path.basename(f), mimeType: mime(f), buffer: fs.readFileSync(f) })), { timeout: 10000 });
      } else {
        // A styled upload button: click it and answer the native file chooser.
        const [chooser] = await Promise.all([page.waitForEvent('filechooser', { timeout: 10000 }), el.click({ timeout: 5000 })]);
        await chooser.setFiles(files);
      }
      this.onSurfaceCursors(action.page_id, [{ ref: action.ref, status: 'done', op: action.op }]);
      return { verified: isFileInput ? await el.evaluate((n, count) => n.files.length === count, files.length) : null, adapter: 'playwright_upload', actual: files.map(f => path.basename(f)) };
    }
    const rich = await el.evaluate(n => n.isContentEditable);
    const read = () => rich ? el.innerText() : el.inputValue();
    const norm = t => String(t).replace(/\s+/g, ' ').trim();
    if (action.op === 'fill') await el.fill(String(action.value), { timeout: 5000 });
    else if (action.op === 'type_text') await el.pressSequentially(String(action.value), { delay: action.pace_ms ?? 0, timeout: 20000 });
    else if (action.op === 'press') await el.press(String(action.value), { timeout: 5000 });
    else if (action.op === 'set_checked') await el.setChecked(Boolean(action.value), { timeout: 5000 });
    else if (action.op === 'select_option') await el.selectOption(action.value, { timeout: 5000 });
    else if (action.op === 'click') await el.click({ timeout: 5000 });
    else throw new Error(`Unsupported browser operation: ${action.op}`);
    const verified = action.op === 'select_option' ? await el.evaluate((el, wanted) => JSON.stringify([...el.selectedOptions].map(o=>o.value).sort()) === JSON.stringify((Array.isArray(wanted)?wanted:[wanted]).slice().sort()), action.value) : action.op === 'set_checked' ? await el.isChecked() === action.value
      : action.op === 'fill' ? (rich ? norm(await read()) === norm(action.value) : await read() === String(action.value))
      : action.op === 'type_text' ? (rich ? norm(await read()).includes(norm(action.value)) : await read() === String(action.value)) : null;
    this.onSurfaceCursors(action.page_id, [{ ref: action.ref, status: verified === false ? 'failed' : 'done', op: action.op }]);
    if (verified === false) throw new Error('Final field value did not match.');
    return { verified, adapter: 'playwright', actual: ['click', 'press'].includes(action.op) ? `${action.op}_dispatched; observe to verify its effect` : await read().catch(() => el.isChecked()) };
  }
  async recordStart(dir) {
    if (this.recordContext) throw new Error('Already recording.');
    if (!this.browser || this.mode === 'cdp') throw new Error('Recording is only available in isolated mode.');
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
  async close() {
    // In CDP mode this only disconnects; the user's own browser keeps running.
    if (this.mode === 'persistent') await this.shared.close(); else await this.browser?.close();
  }
}
