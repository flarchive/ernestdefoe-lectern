import app from 'flarum/forum/app';
import Component from 'flarum/common/Component';
import Icon from 'flarum/common/components/Icon';
import { loadPdfjs, fetchFile, openDocument } from './pdfjs';

const t = (key, params) => app.translator.trans('ernestdefoe-lectern.forum.' + key, params, true);

const CSS_UNITS = 96 / 72;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 5;
const GAP = 12;
// iOS refuses canvases above ~16.7 megapixels; stay well under it per page.
const MAX_CANVAS_PIXELS = 8 * 1024 * 1024;
// Pages kept drawn at once; the rest are dropped to bound memory on long files.
const KEEP_RENDERED = 10;

const clamp = (z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
const fullscreenElement = () => document.fullscreenElement || document.webkitFullscreenElement;
const canFullscreen = () => !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);

/**
 * The PDF viewer: toolbar, page thumbnails and the pages themselves.
 *
 * Mithril draws the chrome and one empty box per page; the canvases and text
 * layers inside those boxes are drawn by hand as pages scroll into view, and
 * dropped again when they are far away.
 */
export default class Viewer extends Component {
  oninit(vnode) {
    super.oninit(vnode);

    this.status = 'loading';
    this.progress = null;
    this.error = null;
    this.doc = null;
    this.numPages = 0;
    this.sizes = [];
    this.zoom = 1;
    // 'auto' fits the width up to 125%, 'width' fits it exactly, false is a chosen zoom.
    this.fit = 'auto';
    this.page = 1;
    this.pageInput = '1';
    this.thumbs = false;
    this.searchOpen = false;
    this.query = '';
    this.matches = [];
    this.matchIndex = -1;
    this.searchToken = 0;
    this.texts = new Map();
    this.printing = null;
    this.fullscreen = false;
    this.message = '';

    this.rendered = new Map();
    this.visible = new Set();
    this.queue = Promise.resolve();
    this.abort = new AbortController();
    this.cleanups = [];

    this.load();
  }

  oncreate(vnode) {
    super.oncreate(vnode);
    this.scroller = this.element.querySelector('.Lectern-scroll');

    const listen = (target, type, fn, options) => {
      target.addEventListener(type, fn, options);
      this.cleanups.push(() => target.removeEventListener(type, fn, options));
    };

    listen(this.scroller, 'scroll', () => this.onScroll(), { passive: true });
    listen(this.scroller, 'wheel', (e) => this.onWheel(e), { passive: false });
    listen(this.scroller, 'touchstart', (e) => this.onTouchStart(e), { passive: true });
    listen(this.scroller, 'touchmove', (e) => this.onTouchMove(e), { passive: false });
    listen(this.scroller, 'touchend', (e) => this.onTouchEnd(e));
    listen(this.scroller, 'touchcancel', () => this.endPinch(false));
    // Safari's own pinch would zoom the whole page instead of the PDF.
    listen(this.scroller, 'gesturestart', (e) => e.preventDefault());
    listen(document, 'fullscreenchange', () => this.onFullscreenChange());
    listen(document, 'webkitfullscreenchange', () => this.onFullscreenChange());

    this.resizeObserver = new ResizeObserver(() => this.fit && this.status === 'ready' && this.fitWidth(this.fit));
    this.resizeObserver.observe(this.scroller);

    this.observer = new IntersectionObserver((entries) => this.onIntersect(entries), { root: this.scroller, rootMargin: '300px 0px' });
    this.thumbObserver = new IntersectionObserver((entries) => this.onThumbIntersect(entries), { rootMargin: '200px 0px' });

    // A dialog can't take focus until it is open; open.js focuses that one.
    if (!this.attrs.modal) (this.attrs.keyboard ? this.scroller : this.element).focus({ preventScroll: true });
  }

  onupdate(vnode) {
    super.onupdate(vnode);
    this.observePages();
  }

  onremove(vnode) {
    super.onremove(vnode);
    this.abort.abort();
    this.searchToken++;
    this.cleanups.forEach((fn) => fn());
    this.observer?.disconnect();
    this.thumbObserver?.disconnect();
    this.resizeObserver?.disconnect();
    this.rendered.forEach((r) => r.task?.cancel());
    this.loadingTask?.destroy();
    if (this.blobUrl) URL.revokeObjectURL(this.blobUrl);
    if (fullscreenElement() === this.element) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
  }

  // ---------------------------------------------------------------- loading

  async load() {
    try {
      const [lib, bytes] = await Promise.all([
        loadPdfjs(),
        fetchFile(this.attrs.url, this.abort.signal, (p) => {
          this.progress = p;
          m.redraw();
        }),
      ]);
      this.lib = lib;

      // pdf.js takes ownership of the bytes it is given; keep a copy to download.
      this.blobUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));

      this.loadingTask = openDocument(lib, bytes);
      this.loadingTask.onPassword = () => {
        const error = new Error('password');
        error.name = 'PasswordException';
        this.loadingTask.destroy();
        this.fail(error);
      };
      this.doc = await this.loadingTask.promise;
      this.numPages = this.doc.numPages;

      const first = (await this.doc.getPage(1)).getViewport({ scale: 1 });
      this.sizes = Array.from({ length: this.numPages }, () => [first.width, first.height]);
      this.status = 'ready';
      this.thumbs = this.element.clientWidth >= 720;
      m.redraw.sync();
      this.fitWidth('auto');
      this.scroller.scrollTop = 0;
      this.say(t('page_of', { number: 1, total: this.numPages }));
      this.loadSizes();
    } catch (error) {
      this.fail(error);
    }
  }

  fail(error) {
    if (this.abort.signal.aborted || this.status === 'error') return;
    this.status = 'error';
    if (error?.status === 401 || error?.status === 403) this.error = 'error_denied';
    else if (error?.status === 404) this.error = 'error_missing';
    else if (error?.name === 'PasswordException') this.error = 'error_password';
    else if (!this.lib && !error?.status) this.error = 'error_browser';
    else this.error = 'error_open';
    this.say(t(this.error));
    m.redraw();
  }

  /** Real page sizes, for files whose pages differ. Fetched in the background. */
  async loadSizes() {
    if (this.numPages > 500) return;
    for (let n = 2; n <= this.numPages; n++) {
      if (this.abort.signal.aborted) return;
      const vp = (await this.doc.getPage(n)).getViewport({ scale: 1 });
      const [w, h] = this.sizes[n - 1];
      if (vp.width !== w || vp.height !== h) {
        this.sizes[n - 1] = [vp.width, vp.height];
        this.sizesChanged = true;
      }
    }
    if (this.sizesChanged) m.redraw();
  }

  // --------------------------------------------------------------- drawing

  pageEl(n) {
    return this.scroller?.querySelector(`.Lectern-page[data-page="${n}"]`);
  }

  observePages() {
    if (this.status !== 'ready' || !this.observer) return;
    this.scroller.querySelectorAll('.Lectern-page:not([data-observed])').forEach((el) => {
      el.dataset.observed = '1';
      this.observer.observe(el);
    });
    this.element.querySelectorAll('.Lectern-thumb:not([data-observed])').forEach((el) => {
      el.dataset.observed = '1';
      this.thumbObserver.observe(el);
    });
  }

  onIntersect(entries) {
    entries.forEach((e) => {
      const n = Number(e.target.dataset.page);
      if (e.isIntersecting) this.visible.add(n);
      else this.visible.delete(n);
    });
    this.drawVisible();
  }

  drawVisible() {
    const wanted = [...this.visible].sort((a, b) => Math.abs(a - this.page) - Math.abs(b - this.page));
    wanted.forEach((n) => {
      const r = this.rendered.get(n);
      if (!r || r.zoom !== this.zoom) this.enqueue(n);
    });

    // Drop the drawn pages farthest from where the reader is.
    if (this.rendered.size > KEEP_RENDERED) {
      [...this.rendered.keys()]
        .filter((n) => !this.visible.has(n))
        .sort((a, b) => Math.abs(b - this.page) - Math.abs(a - this.page))
        .slice(0, this.rendered.size - KEEP_RENDERED)
        .forEach((n) => this.drop(n));
    }
  }

  drop(n) {
    const r = this.rendered.get(n);
    r?.task?.cancel();
    const inner = this.pageEl(n)?.querySelector('.Lectern-pageInner');
    if (inner) inner.textContent = '';
    this.rendered.delete(n);
  }

  /** Pages draw one after another, so a fast scroll can't start fifty at once. */
  enqueue(n) {
    if (this.pending?.has(n)) return;
    (this.pending ||= new Set()).add(n);
    this.queue = this.queue.then(() => {
      this.pending.delete(n);
      if (!this.visible.has(n)) return;
      const r = this.rendered.get(n);
      if (r && r.zoom === this.zoom) return;
      return this.draw(n).catch(() => {});
    });
  }

  async draw(n) {
    const zoom = this.zoom;
    const el = this.pageEl(n);
    if (!el) return;

    const page = await this.doc.getPage(n);
    const viewport = page.getViewport({ scale: zoom * CSS_UNITS });
    const ratio = Math.min(window.devicePixelRatio || 1, Math.sqrt(MAX_CANVAS_PIXELS / (viewport.width * viewport.height)));

    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width * ratio);
    canvas.height = Math.floor(viewport.height * ratio);
    canvas.setAttribute('aria-hidden', 'true');

    const previous = this.rendered.get(n);
    previous?.task?.cancel();
    const entry = { zoom, task: null, textLayer: null };
    this.rendered.set(n, entry);

    entry.task = page.render({
      canvasContext: canvas.getContext('2d'),
      viewport,
      transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : null,
    });
    await entry.task.promise;
    if (this.rendered.get(n) !== entry) return;

    const text = document.createElement('div');
    text.className = 'textLayer';
    const inner = el.querySelector('.Lectern-pageInner');
    el.style.setProperty('--total-scale-factor', String(viewport.scale));
    inner.replaceChildren(canvas, text);

    entry.textLayer = new this.lib.TextLayer({ textContentSource: page.streamTextContent(), container: text, viewport });
    await entry.textLayer.render();
    if (this.rendered.get(n) === entry) this.highlight(n);
  }

  // ------------------------------------------------------------ navigating

  /** The page at the top third of the view. */
  onScroll() {
    if (this.scrollFrame) return;
    this.scrollFrame = requestAnimationFrame(() => {
      this.scrollFrame = null;
      const line = this.scroller.scrollTop + this.scroller.clientHeight / 3;
      const pages = this.scroller.querySelectorAll('.Lectern-page');
      let lo = 0;
      let hi = pages.length - 1;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (pages[mid].offsetTop <= line) lo = mid;
        else hi = mid - 1;
      }
      const page = lo + 1;
      if (page !== this.page) {
        this.page = page;
        this.pageInput = String(page);
        this.scrollThumb();
        m.redraw();
      }
    });
  }

  goTo(n, announce = true) {
    if (!this.numPages) return;
    n = Math.min(this.numPages, Math.max(1, Math.round(n) || 1));
    const el = this.pageEl(n);
    if (el) this.scroller.scrollTop = el.offsetTop - GAP;
    this.page = n;
    this.pageInput = String(n);
    this.scrollThumb();
    if (announce) this.say(t('page_of', { number: n, total: this.numPages }));
  }

  scrollThumb() {
    if (!this.thumbs) return;
    requestAnimationFrame(() => this.element?.querySelector(`.Lectern-thumb[data-page="${this.page}"]`)?.scrollIntoView({ block: 'nearest' }));
  }

  // ---------------------------------------------------------------- zoom

  fitWidth(mode = 'width') {
    const width = this.scroller.clientWidth - GAP * 2;
    const widest = Math.max(...this.sizes.slice(0, 50).map((s) => s[0]));
    const zoom = width / (widest * CSS_UNITS);
    this.setZoom(mode === 'auto' ? Math.min(zoom, 1.25) : zoom, mode);
  }

  /**
   * Changes the zoom, keeping the point at (x, y) in the view where it was.
   * x and y default to the middle of the view.
   */
  setZoom(zoom, fit = false, x = null, y = null) {
    zoom = clamp(zoom);
    this.fit = fit;
    if (Math.abs(zoom - this.zoom) < 0.001) return m.redraw();

    const s = this.scroller;
    x ??= s.clientWidth / 2;
    y ??= s.clientHeight / 2;
    const factor = zoom / this.zoom;
    const docX = s.scrollLeft + x;
    const docY = s.scrollTop + y;

    this.zoom = zoom;
    m.redraw.sync();
    s.scrollLeft = docX * factor - x;
    s.scrollTop = docY * factor - y;
    this.drawVisible();
  }

  zoomBy(factor, x, y) {
    this.setZoom(this.zoom * factor, false, x, y);
  }

  onWheel(e) {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const rect = this.scroller.getBoundingClientRect();
    this.zoomBy(Math.exp(-e.deltaY / 300), e.clientX - rect.left, e.clientY - rect.top);
  }

  // --------------------------------------------------------------- touch

  onTouchStart(e) {
    if (e.touches.length === 2) {
      const [a, b] = e.touches;
      const rect = this.scroller.getBoundingClientRect();
      this.swipe = null;
      this.pinch = {
        distance: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
        x: (a.clientX + b.clientX) / 2 - rect.left,
        y: (a.clientY + b.clientY) / 2 - rect.top,
        ratio: 1,
      };
    } else if (e.touches.length === 1) {
      this.swipe = { x: e.touches[0].clientX, y: e.touches[0].clientY, time: Date.now() };
    }
  }

  onTouchMove(e) {
    if (!this.pinch || e.touches.length !== 2) return;
    e.preventDefault();
    const [a, b] = e.touches;
    const p = this.pinch;
    p.ratio = clamp((this.zoom * Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)) / p.distance) / this.zoom;
    const pages = this.scroller.querySelector('.Lectern-pages');
    pages.style.transformOrigin = `${this.scroller.scrollLeft + p.x}px ${this.scroller.scrollTop + p.y}px`;
    pages.style.transform = `scale(${p.ratio})`;
  }

  onTouchEnd(e) {
    if (this.pinch) {
      if (e.touches.length < 2) this.endPinch(true);
      return;
    }
    const s = this.swipe;
    this.swipe = null;
    if (!s || e.changedTouches.length !== 1) return;

    // A quick sideways swipe turns the page while the page fits the width.
    const dx = e.changedTouches[0].clientX - s.x;
    const dy = e.changedTouches[0].clientY - s.y;
    const fits = this.scroller.scrollWidth <= this.scroller.clientWidth + 1;
    if (fits && Date.now() - s.time < 600 && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 2) {
      this.goTo(this.page + (dx < 0 ? 1 : -1));
    }
  }

  endPinch(apply) {
    const p = this.pinch;
    if (!p) return;
    this.pinch = null;
    const pages = this.scroller.querySelector('.Lectern-pages');
    pages.style.transform = '';
    pages.style.transformOrigin = '';
    if (apply && Math.abs(p.ratio - 1) > 0.01) this.zoomBy(p.ratio, p.x, p.y);
  }

  // -------------------------------------------------------------- search

  openSearch() {
    this.searchOpen = true;
    m.redraw.sync();
    const input = this.element.querySelector('.Lectern-searchInput');
    input?.focus();
    input?.select();
  }

  closeSearch() {
    this.searchOpen = false;
    this.setQuery('');
    this.scroller.focus({ preventScroll: true });
  }

  setQuery(query) {
    this.query = query;
    this.searching = true;
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.search(), 250);
  }

  async text(n) {
    if (!this.texts.has(n)) {
      this.texts.set(
        n,
        this.doc
          .getPage(n)
          .then((page) => page.getTextContent())
          .then((content) => content.items.filter((item) => item.str !== undefined).map((item) => item.str))
      );
    }
    return this.texts.get(n);
  }

  /** Finds every match, page by page, jumping to the first as soon as it turns up. */
  async search() {
    const token = ++this.searchToken;
    this.searching = true;
    const needle = this.query.trim().toLocaleLowerCase();
    const previous = new Set(this.matches.map((match) => match.page));
    this.matches = [];
    this.matchIndex = -1;
    previous.forEach((n) => this.highlight(n));
    if (!needle || !this.doc) {
      this.searching = false;
      return m.redraw();
    }

    for (let n = 1; n <= this.numPages; n++) {
      const strings = await this.text(n).catch(() => []);
      if (token !== this.searchToken) return;
      let found = 0;
      strings.forEach((str, item) => {
        const hay = str.toLocaleLowerCase();
        for (let at = hay.indexOf(needle); at !== -1; at = hay.indexOf(needle, at + needle.length)) {
          this.matches.push({ page: n, item, at, length: needle.length });
          found++;
        }
      });
      if (found && this.matchIndex === -1) this.showMatch(0);
      else if (found) this.highlight(n);
      if (found || n % 20 === 0) m.redraw();
    }
    this.searching = false;
    this.say(this.matches.length ? t('search_count', { current: this.matchIndex + 1, total: this.matches.length }) : t('search_none'));
    m.redraw();
  }

  showMatch(index) {
    if (!this.matches.length) return;
    const old = this.matches[this.matchIndex];
    this.matchIndex = (index + this.matches.length) % this.matches.length;
    const match = this.matches[this.matchIndex];
    if (old && old.page !== match.page) this.highlight(old.page);
    this.goTo(match.page, false);
    this.highlight(match.page);
    this.say(t('search_count', { current: this.matchIndex + 1, total: this.matches.length }));
    m.redraw();
  }

  /** Marks the matches on a drawn page, building nodes so PDF text is never parsed as HTML. */
  highlight(n) {
    const layer = this.rendered.get(n)?.textLayer;
    if (!layer) return;
    const divs = layer.textDivs;
    const strings = layer.textContentItemsStr;
    const marked = (this.markedDivs ||= new Map()).get(n) || [];
    marked.forEach((i) => (divs[i].textContent = strings[i]));

    const current = this.matches[this.matchIndex];
    const byItem = new Map();
    this.matches.forEach((match) => {
      if (match.page !== n || !divs[match.item]) return;
      if (!byItem.has(match.item)) byItem.set(match.item, []);
      byItem.get(match.item).push(match);
    });

    let currentMark = null;
    byItem.forEach((matches, i) => {
      const str = strings[i];
      const div = divs[i];
      div.textContent = '';
      let pos = 0;
      matches.forEach((match) => {
        div.append(str.slice(pos, match.at));
        const mark = document.createElement('mark');
        mark.className = 'Lectern-hit' + (match === current ? ' is-current' : '');
        mark.textContent = str.slice(match.at, match.at + match.length);
        div.append(mark);
        if (match === current) currentMark = mark;
        pos = match.at + match.length;
      });
      div.append(str.slice(pos));
    });
    this.markedDivs.set(n, [...byItem.keys()]);

    if (currentMark) currentMark.scrollIntoView({ block: 'center', inline: 'nearest' });
  }

  // ------------------------------------------------------- print, download

  async print() {
    if (this.printing || !this.doc) return;
    this.printing = { done: 0, total: this.numPages };
    m.redraw();

    const holder = document.createElement('div');
    holder.className = 'Lectern-print';
    const urls = [];
    try {
      for (let n = 1; n <= this.numPages; n++) {
        const page = await this.doc.getPage(n);
        const viewport = page.getViewport({ scale: 150 / 72 });
        const canvas = document.createElement('canvas');
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        await page.render({ canvasContext: canvas.getContext('2d'), viewport, intent: 'print' }).promise;
        const blob = await new Promise((resolve) => canvas.toBlob(resolve));
        const img = document.createElement('img');
        img.src = URL.createObjectURL(blob);
        img.alt = '';
        urls.push(img.src);
        holder.append(img);
        this.printing.done = n;
        m.redraw();
      }
      document.body.append(holder);
      document.documentElement.classList.add('Lectern-printing');
      await Promise.all([...holder.querySelectorAll('img')].map((img) => img.decode().catch(() => {})));

      const cleanup = () => {
        window.removeEventListener('afterprint', cleanup);
        document.documentElement.classList.remove('Lectern-printing');
        holder.remove();
        urls.forEach((url) => URL.revokeObjectURL(url));
      };
      window.addEventListener('afterprint', cleanup);
      window.print();
    } catch (e) {
      holder.remove();
      urls.forEach((url) => URL.revokeObjectURL(url));
    } finally {
      this.printing = null;
      m.redraw();
    }
  }

  toggleFullscreen() {
    if (fullscreenElement()) {
      (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    } else {
      (this.element.requestFullscreen || this.element.webkitRequestFullscreen).call(this.element);
    }
  }

  onFullscreenChange() {
    this.fullscreen = fullscreenElement() === this.element;
    if (this.fit && this.status === 'ready') this.fitWidth(this.fit);
    m.redraw();
  }

  // ------------------------------------------------------------ keyboard

  onkeydown(e) {
    const typing = e.target.matches('input, textarea, select');
    const mod = e.ctrlKey || e.metaKey;

    if (mod && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      this.openSearch();
      return;
    }
    if (e.key === 'Escape' && !this.attrs.modal && !typing && !fullscreenElement()) {
      e.preventDefault();
      this.attrs.onclose();
      return;
    }
    if (typing || e.altKey || this.status !== 'ready') return;

    if (mod) {
      if (e.key === '=' || e.key === '+') this.zoomBy(1.25);
      else if (e.key === '-') this.zoomBy(0.8);
      else if (e.key === '0') this.fitWidth();
      else return;
      e.preventDefault();
      return;
    }

    let handled = true;
    if (e.key === 'PageDown' || e.key === 'ArrowRight') this.goTo(this.page + 1);
    else if (e.key === 'PageUp' || e.key === 'ArrowLeft') this.goTo(this.page - 1);
    else if (e.key === 'Home') this.goTo(1);
    else if (e.key === 'End') this.goTo(this.numPages);
    else if (e.key === '+' || e.key === '=') this.zoomBy(1.25);
    else if (e.key === '-') this.zoomBy(0.8);
    else if (e.key === '0') this.fitWidth();
    else handled = false;
    if (handled) e.preventDefault();
  }

  say(message) {
    // Clearing first makes a repeated message announce again.
    this.message = '';
    m.redraw.sync();
    this.message = message;
    m.redraw();
  }

  // -------------------------------------------------------------- thumbs

  onThumbIntersect(entries) {
    entries.forEach(async (e) => {
      const box = e.target.querySelector('.Lectern-thumbImage');
      if (!e.isIntersecting) {
        box.textContent = '';
        return;
      }
      if (box.firstChild) return;
      const n = Number(e.target.dataset.page);
      const page = await this.doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: (96 * (window.devicePixelRatio || 1)) / base.width });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise.catch(() => {});
      if (!box.firstChild && box.isConnected) box.append(canvas);
    });
  }

  // ---------------------------------------------------------------- view

  button(label, iconName, onclick, { className = '', ...attrs } = {}) {
    return (
      <button
        type="button"
        className={'Button Button--icon Button--link Lectern-button ' + className}
        aria-label={label}
        title={label}
        onclick={onclick}
        {...attrs}
      >
        <Icon name={iconName} />
      </button>
    );
  }

  view() {
    const { name, modal } = this.attrs;
    const ready = this.status === 'ready';
    const off = { disabled: !ready };

    return (
      <div
        className={'Lectern' + (modal ? ' Lectern--modal' : ' Lectern--inline') + (this.thumbs && ready ? ' Lectern--thumbs' : '')}
        role="region"
        tabindex="-1"
        aria-label={t('title', { name })}
        onkeydown={(e) => this.onkeydown(e)}
      >
        <div className="Lectern-toolbar" role="toolbar" aria-label={t('toolbar')}>
          <div className="Lectern-group">
            {this.button(this.thumbs ? t('hide_thumbnails') : t('thumbnails'), 'fas fa-table-cells-large', () => (this.thumbs = !this.thumbs), {
              ...off,
              'aria-pressed': String(this.thumbs),
            })}
            <span className="Lectern-name" title={name}>
              {name}
            </span>
            {this.button(t('close'), 'fas fa-xmark', () => this.attrs.onclose(), { className: 'Lectern-close--narrow' })}
          </div>

          <div className="Lectern-group">
            {this.button(t('previous_page'), 'fas fa-chevron-up', () => this.goTo(this.page - 1), { disabled: !ready || this.page <= 1 })}
            <input
              className="FormControl Lectern-pageInput"
              type="text"
              inputmode="numeric"
              aria-label={t('page_input')}
              value={this.pageInput}
              disabled={!ready}
              oninput={(e) => (this.pageInput = e.target.value)}
              onchange={(e) => this.goTo(Number(e.target.value))}
              onkeydown={(e) => {
                if (e.key === 'Enter') this.goTo(Number(e.target.value));
              }}
            />
            <span className="Lectern-of">{t('of_total', { total: this.numPages || '–' })}</span>
            {this.button(t('next_page'), 'fas fa-chevron-down', () => this.goTo(this.page + 1), { disabled: !ready || this.page >= this.numPages })}
          </div>

          <div className="Lectern-group">
            {this.button(t('zoom_out'), 'fas fa-magnifying-glass-minus', () => this.zoomBy(0.8), off)}
            <span className="Lectern-zoom" aria-hidden="true">
              {Math.round(this.zoom * 100)}%
            </span>
            {this.button(t('zoom_in'), 'fas fa-magnifying-glass-plus', () => this.zoomBy(1.25), off)}
            {this.button(t('fit_width'), 'fas fa-arrows-left-right-to-line', () => this.fitWidth(), {
              ...off,
              className: 'Lectern-fit',
              'aria-pressed': String(this.fit === 'width'),
            })}
          </div>

          <div className="Lectern-group">
            {this.button(t('search'), 'fas fa-magnifying-glass', () => (this.searchOpen ? this.closeSearch() : this.openSearch()), {
              ...off,
              'aria-expanded': String(this.searchOpen),
            })}
            {this.button(t('print'), 'fas fa-print', () => this.print(), { disabled: !ready || !!this.printing })}
            <a
              className="Button Button--icon Button--link Lectern-button"
              href={this.blobUrl || this.attrs.url}
              download={name}
              aria-label={t('download')}
              title={t('download')}
            >
              <Icon name="fas fa-download" />
            </a>
            {canFullscreen()
              ? this.button(
                  this.fullscreen ? t('exit_full_screen') : t('full_screen'),
                  this.fullscreen ? 'fas fa-compress' : 'fas fa-expand',
                  () => this.toggleFullscreen(),
                  { className: 'Lectern-fullscreen' }
                )
              : null}
            {this.button(t('close'), 'fas fa-xmark', () => this.attrs.onclose(), { className: 'Lectern-close--wide' })}
          </div>
        </div>

        {this.searchOpen ? (
          <div className="Lectern-search" role="search">
            <input
              className="FormControl Lectern-searchInput"
              type="search"
              aria-label={t('search_placeholder')}
              placeholder={t('search_placeholder')}
              value={this.query}
              oninput={(e) => this.setQuery(e.target.value)}
              onkeydown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  this.showMatch(this.matchIndex + (e.shiftKey ? -1 : 1));
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  this.closeSearch();
                }
              }}
            />
            <span className="Lectern-searchCount">
              {this.query.trim() && this.matches.length
                ? t('search_count', { current: this.matchIndex + 1, total: this.matches.length })
                : this.query.trim() && !this.searching
                  ? t('search_none')
                  : ''}
            </span>
            {this.button(t('search_previous'), 'fas fa-chevron-up', () => this.showMatch(this.matchIndex - 1), { disabled: !this.matches.length })}
            {this.button(t('search_next'), 'fas fa-chevron-down', () => this.showMatch(this.matchIndex + 1), { disabled: !this.matches.length })}
          </div>
        ) : null}

        <div className="Lectern-body">
          {this.thumbs && ready ? (
            <nav className="Lectern-thumbs" aria-label={t('pages_label')}>
              {this.sizes.map(([w, h], i) => (
                <button
                  key={i + 1}
                  type="button"
                  className="Lectern-thumb"
                  data-page={i + 1}
                  aria-label={t('page_label', { number: i + 1 })}
                  aria-current={this.page === i + 1 ? 'page' : undefined}
                  onclick={() => {
                    this.goTo(i + 1);
                    if (this.element.clientWidth < 720) this.thumbs = false;
                  }}
                >
                  <span className="Lectern-thumbImage" style={{ aspectRatio: `${w} / ${h}` }} />
                  <span className="Lectern-thumbNumber">{i + 1}</span>
                </button>
              ))}
            </nav>
          ) : null}

          <div className="Lectern-scroll" tabindex="0" role="document" aria-label={t('document', { name })}>
            {ready ? (
              <div className="Lectern-pages">
                {this.sizes.map(([w, h], i) => (
                  <div
                    key={i + 1}
                    className="Lectern-page"
                    data-page={i + 1}
                    role="region"
                    aria-label={t('page_label', { number: i + 1 })}
                    style={{ width: `${Math.floor(w * this.zoom * CSS_UNITS)}px`, height: `${Math.floor(h * this.zoom * CSS_UNITS)}px` }}
                  >
                    <div className="Lectern-pageInner" />
                  </div>
                ))}
              </div>
            ) : (
              <div className="Lectern-state">
                {this.status === 'loading' ? (
                  <p>
                    <Icon name="fas fa-spinner fa-spin" /> {this.progress ? t('loading_percent', { percent: this.progress }) : t('loading')}
                  </p>
                ) : (
                  <p>
                    {t(this.error)}{' '}
                    {this.error !== 'error_denied' && this.error !== 'error_missing' ? (
                      <a className="Button Button--primary" href={this.attrs.url} download={name}>
                        {t('download')}
                      </a>
                    ) : null}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        {this.printing ? (
          <div className="Lectern-printing" role="status">
            {t('preparing_print', { done: this.printing.done, total: this.printing.total })}
          </div>
        ) : null}

        <div className="Lectern-live" aria-live="polite">
          {this.message}
        </div>
      </div>
    );
  }
}
