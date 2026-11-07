import app from 'flarum/forum/app';
import Component from 'flarum/common/Component';
import Icon from 'flarum/common/components/Icon';
import { fetchFile } from './pdfjs';

const t = (key, params) => app.translator.trans('ernestdefoe-lectern.forum.' + key, params, true);

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;
// Spreadsheet rows drawn at first, and added per "Show more rows".
const ROW_STEP = 1000;
const MAX_COLUMNS = 100;

const clamp = (z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
const fullscreenElement = () => document.fullscreenElement || document.webkitFullscreenElement;
const canFullscreen = () => !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);

/*
 * A Word document renders inside a sandboxed iframe: no scripts, and a content
 * security policy that lets it load nothing but its own embedded images and
 * fonts. Its styles can't reach the forum and it can't call any other site.
 */
const FRAME_CSP = "default-src 'none'; img-src data: blob:; font-src data: blob:; style-src 'unsafe-inline'";

/** Only web, mail and in-document links survive from a Word file. */
function safeHref(href) {
  if (!href) return null;
  if (href.startsWith('#')) return href;
  try {
    const url = new URL(href);
    return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * The viewer for Word documents (.docx) and spreadsheets (.xlsx, .xlsm, .xls,
 * .ods, .csv). It shares the PDF viewer's look: a toolbar with zoom, print,
 * download and full screen; spreadsheets add a tab per sheet.
 */
export default class DocViewer extends Component {
  oninit(vnode) {
    super.oninit(vnode);
    this.status = 'loading';
    this.progress = null;
    this.error = null;
    this.zoom = 1;
    this.fit = 'auto';
    this.fullscreen = false;
    this.sheets = [];
    this.sheet = 0;
    this.rows = ROW_STEP;
    this.message = '';
    this.abort = new AbortController();
    this.cleanups = [];
    this.load();
  }

  oncreate(vnode) {
    super.oncreate(vnode);
    this.body = this.element.querySelector('.Lectern-docBody');
    const onFs = () => {
      this.fullscreen = fullscreenElement() === this.element;
      if (this.fit) this.fitWidth(this.fit);
      m.redraw();
    };
    document.addEventListener('fullscreenchange', onFs);
    document.addEventListener('webkitfullscreenchange', onFs);
    this.cleanups.push(() => {
      document.removeEventListener('fullscreenchange', onFs);
      document.removeEventListener('webkitfullscreenchange', onFs);
    });
    this.resizeObserver = new ResizeObserver(() => this.status === 'ready' && this.fit && this.fitWidth(this.fit));
    this.resizeObserver.observe(this.body);
    if (this.attrs.kind !== 'word') this.listenPinch(this.body);
    if (!this.attrs.modal) (this.attrs.keyboard ? this.body : this.element).focus({ preventScroll: true });
  }

  onremove(vnode) {
    super.onremove(vnode);
    this.abort.abort();
    this.cleanups.forEach((fn) => fn());
    this.resizeObserver?.disconnect();
    if (this.blobUrl) URL.revokeObjectURL(this.blobUrl);
    if (fullscreenElement() === this.element) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
  }

  // ---------------------------------------------------------------- loading

  async load() {
    const word = this.attrs.kind === 'word';
    try {
      const [lib, bytes] = await Promise.all([
        word ? import('./office/word') : import('./office/sheet'),
        fetchFile(this.attrs.url, this.abort.signal, (p) => {
          this.progress = p;
          m.redraw();
        }),
      ]);
      this.blobUrl = URL.createObjectURL(new Blob([bytes]));
      if (this.abort.signal.aborted) return;

      if (word) {
        this.status = 'ready';
        m.redraw.sync();
        await this.renderWord(lib, bytes);
      } else {
        const book = lib.read(bytes, { type: 'array', dense: true, cellStyles: false, cellHTML: false, bookVBA: false, cellFormula: false });
        this.lib = lib;
        this.sheets = book.SheetNames.map((name) => ({ name, sheet: book.Sheets[name] })).filter((s) => s.sheet);
        if (!this.sheets.length) throw new Error('empty');
        this.status = 'ready';
        m.redraw.sync();
        this.renderSheet();
      }
      // A Word page fits the width; a spreadsheet keeps its own size and scrolls.
      if (word) this.fitWidth('auto');
      else this.fit = false;
      this.say(this.attrs.name);
    } catch (error) {
      if (this.abort.signal.aborted) return;
      this.status = 'error';
      this.error = error?.status === 401 || error?.status === 403 ? 'error_denied' : error?.status === 404 ? 'error_missing' : 'error_open_file';
      this.say(t(this.error));
      m.redraw();
    }
  }

  async renderWord(lib, bytes) {
    const frame = this.element.querySelector('.Lectern-frame');
    const bg = getComputedStyle(this.element).getPropertyValue('--control-bg').trim() || '#e7edf3';
    await new Promise((resolve) => {
      frame.addEventListener('load', resolve, { once: true });
      frame.srcdoc =
        `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${FRAME_CSP}">` +
        `<meta name="viewport" content="width=device-width"><style>html{-webkit-text-size-adjust:100%;text-size-adjust:100%;touch-action:pan-x pan-y;background:${bg.replace(/[<>"';{}]/g, '')}}body{margin:0}` +
        `.docx-wrapper{background:transparent!important;padding:12px!important;align-items:center}` +
        `.docx-wrapper>section.docx{box-shadow:0 1px 4px rgba(0,0,0,.25);margin-bottom:12px!important}` +
        `@media print{html{background:#fff}.docx-wrapper{padding:0!important}.docx-wrapper>section.docx{box-shadow:none;margin:0!important}}</style>` +
        // docx-preview empties the style container it is given, so it gets its own.
        `</head><body><div id="docx-styles" hidden></div><div id="doc"></div></body></html>`;
    });

    const doc = frame.contentDocument;
    this.frameDoc = doc;
    await lib.renderAsync(bytes, doc.getElementById('doc'), doc.getElementById('docx-styles'), {
      className: 'docx',
      inWrapper: true,
      hideWrapperOnPrint: true,
      ignoreLastRenderedPageBreak: true,
      breakPages: true,
      useBase64URL: true,
      renderAltChunks: false,
      renderComments: false,
      renderChanges: false,
      experimental: false,
    });

    // Word bullets come from the Symbol and Wingdings fonts, which browsers
    // don't have: swap their private-use characters for real ones.
    const BULLETS = {
      '\uf0b7': '\u2022',
      '\uf0a7': '\u25aa',
      '\uf0d8': '\u27a2',
      '\uf076': '\u2756',
      '\uf0fc': '\u2714',
      '\uf0a8': '\u25a1',
      '\uf06e': '\u25a0',
      '\uf071': '\u2751',
    };
    doc.querySelectorAll('#docx-styles style').forEach((style) => {
      style.textContent = style.textContent.replace(/[\uf000-\uf0ff]/g, (c) => BULLETS[c] || '\u2022');
    });

    // Belt and braces on top of the sandbox: nothing active survives.
    doc.querySelectorAll('script, iframe, object, embed, link, base, form, frame').forEach((el) => el.remove());
    doc.querySelectorAll('*').forEach((el) => {
      for (const attr of [...el.attributes]) if (/^on/i.test(attr.name)) el.removeAttribute(attr.name);
    });
    doc.querySelectorAll('a[href]').forEach((a) => {
      const href = safeHref(a.getAttribute('href'));
      if (href) a.setAttribute('href', href);
      else a.removeAttribute('href');
    });

    // Links open in a new tab; the frame itself never navigates.
    doc.addEventListener('click', (e) => {
      const a = e.target.closest?.('a[href]');
      if (!a) return;
      e.preventDefault();
      const href = a.getAttribute('href');
      if (href.startsWith('#')) {
        const target = doc.getElementById(href.slice(1)) || doc.getElementsByName(href.slice(1))[0];
        target?.scrollIntoView();
      } else {
        window.open(href, '_blank', 'noopener,noreferrer');
      }
    });
    doc.addEventListener('keydown', (e) => this.onkeydown(e, true));
    this.listenPinch(doc.documentElement, doc);
    this.pages = doc.querySelectorAll('section.docx').length;
  }

  renderSheet() {
    const { sheet } = this.sheets[this.sheet];
    const utils = this.lib.utils;
    const data = sheet['!data'] || [];
    const range = sheet['!ref'] ? utils.decode_range(sheet['!ref']) : { s: { r: 0, c: 0 }, e: { r: -1, c: -1 } };
    const lastRow = Math.min(range.e.r, range.s.r + this.rows - 1);
    const lastCol = Math.min(range.e.c, range.s.c + MAX_COLUMNS - 1);
    this.truncatedRows = range.e.r > lastRow;
    this.truncatedCols = range.e.c > lastCol;

    // Merged cells: the top-left one spans, the rest are skipped.
    const spans = new Map();
    const covered = new Set();
    (sheet['!merges'] || []).forEach(({ s, e }) => {
      spans.set(`${s.r},${s.c}`, [e.r - s.r + 1, e.c - s.c + 1]);
      for (let r = s.r; r <= e.r; r++) for (let c = s.c; c <= e.c; c++) if (r !== s.r || c !== s.c) covered.add(`${r},${c}`);
    });

    const table = document.createElement('table');
    table.className = 'Lectern-sheet';
    const head = table.createTHead().insertRow();
    head.appendChild(document.createElement('th')).className = 'Lectern-corner';
    for (let c = range.s.c; c <= lastCol; c++) {
      const th = document.createElement('th');
      th.scope = 'col';
      th.textContent = utils.encode_col(c);
      head.appendChild(th);
    }
    const tbody = table.createTBody();
    for (let r = range.s.r; r <= lastRow; r++) {
      const tr = tbody.insertRow();
      const th = document.createElement('th');
      th.scope = 'row';
      th.textContent = String(r + 1);
      tr.appendChild(th);
      for (let c = range.s.c; c <= lastCol; c++) {
        const key = `${r},${c}`;
        if (covered.has(key)) continue;
        const cell = data[r]?.[c];
        const td = tr.insertCell();
        if (cell) {
          td.textContent = utils.format_cell(cell);
          if (cell.t === 'n') td.className = 'is-number';
        }
        const span = spans.get(key);
        if (span) [td.rowSpan, td.colSpan] = span;
      }
    }

    const holder = this.element.querySelector('.Lectern-sheetHolder');
    holder.replaceChildren(table);
    holder.style.zoom = String(this.zoom);
    m.redraw();
  }

  showSheet(index) {
    this.sheet = index;
    this.rows = ROW_STEP;
    this.renderSheet();
    this.body.scrollTo(0, 0);
    this.say(this.sheets[index].name);
  }

  // ---------------------------------------------------------------- zoom

  zoomTarget() {
    return this.attrs.kind === 'word' ? this.frameDoc?.documentElement : this.element.querySelector('.Lectern-sheetHolder');
  }

  fitWidth(mode = 'width') {
    const target = this.zoomTarget();
    if (!target) return;
    // Measured at 100%, then the zoom goes back on.
    target.style.zoom = '1';
    let natural;
    if (this.attrs.kind === 'word') {
      const page = this.frameDoc.querySelector('section.docx');
      natural = page ? page.offsetWidth + 24 : 0;
    } else {
      natural = target.firstElementChild?.offsetWidth || 0;
    }
    if (!natural) {
      target.style.zoom = String(this.zoom);
      return;
    }
    const zoom = (this.body.clientWidth - 4) / natural;
    this.setZoom(mode === 'auto' ? Math.min(zoom, 1) : zoom, mode);
  }

  setZoom(zoom, fit = false) {
    this.zoom = clamp(zoom);
    this.fit = fit;
    const target = this.zoomTarget();
    if (target) target.style.zoom = String(this.zoom);
    m.redraw();
  }

  /** Pinch to zoom, on the document only, not the whole page. */
  listenPinch(el, doc = document) {
    let pinch = null;
    const distance = (e) => Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    el.addEventListener(
      'touchstart',
      (e) => {
        if (e.touches.length === 2) pinch = { distance: distance(e), zoom: this.zoom };
      },
      { passive: true }
    );
    el.addEventListener(
      'touchmove',
      (e) => {
        if (!pinch || e.touches.length !== 2) return;
        e.preventDefault();
        const target = this.zoomTarget();
        this.zoom = clamp((pinch.zoom * distance(e)) / pinch.distance);
        if (target) target.style.zoom = String(this.zoom);
      },
      { passive: false }
    );
    el.addEventListener('touchend', (e) => {
      if (pinch && e.touches.length < 2) {
        pinch = null;
        this.setZoom(this.zoom);
      }
    });
    doc.addEventListener('gesturestart', (e) => e.preventDefault());
  }

  // ------------------------------------------------------- print, screen

  print() {
    if (this.attrs.kind === 'word') {
      this.element.querySelector('.Lectern-frame')?.contentWindow.print();
      return;
    }
    const holder = document.createElement('div');
    holder.className = 'Lectern-print';
    holder.appendChild(this.element.querySelector('.Lectern-sheet').cloneNode(true));
    document.body.append(holder);
    document.documentElement.classList.add('Lectern-printing');
    const cleanup = () => {
      window.removeEventListener('afterprint', cleanup);
      document.documentElement.classList.remove('Lectern-printing');
      holder.remove();
    };
    window.addEventListener('afterprint', cleanup);
    window.print();
  }

  toggleFullscreen() {
    if (fullscreenElement()) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    else (this.element.requestFullscreen || this.element.webkitRequestFullscreen).call(this.element);
  }

  onkeydown(e, inFrame = false) {
    const typing = e.target.matches?.('input, textarea, select');
    if (e.key === 'Escape' && (inFrame || !this.attrs.modal) && !typing && !fullscreenElement()) {
      e.preventDefault();
      this.attrs.onclose();
      return;
    }
    if (typing || e.altKey || this.status !== 'ready') return;
    const mod = e.ctrlKey || e.metaKey;
    // Plain keys only work outside the document frame, so typing-like keys
    // inside a Word file are left alone; Ctrl/Cmd zoom works everywhere.
    if (!mod && inFrame) return;
    let handled = true;
    if (e.key === '+' || e.key === '=') this.setZoom(this.zoom * 1.25);
    else if (e.key === '-') this.setZoom(this.zoom * 0.8);
    else if (e.key === '0') this.fitWidth();
    else handled = false;
    if (handled) {
      e.preventDefault();
      if (inFrame) m.redraw();
    }
  }

  say(message) {
    this.message = '';
    m.redraw.sync();
    this.message = message;
    m.redraw();
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
    const { name, modal, kind } = this.attrs;
    const ready = this.status === 'ready';
    const off = { disabled: !ready };
    const word = kind === 'word';

    return (
      <div
        className={'Lectern Lectern--doc' + (modal ? ' Lectern--modal' : ' Lectern--inline')}
        role="region"
        tabindex="-1"
        aria-label={t(word ? 'title_word' : 'title_sheet', { name })}
        onkeydown={(e) => this.onkeydown(e)}
      >
        <div className="Lectern-toolbar" role="toolbar" aria-label={t('toolbar')}>
          <div className="Lectern-group">
            <span className="Lectern-docIcon" aria-hidden="true">
              <Icon name={word ? 'fas fa-file-word' : 'fas fa-file-excel'} />
            </span>
            <span className="Lectern-name" title={name}>
              {name}
            </span>
            {this.button(t('close'), 'fas fa-xmark', () => this.attrs.onclose(), { className: 'Lectern-close--narrow' })}
          </div>

          <div className="Lectern-group">
            {word && this.pages ? <span className="Lectern-of">{t('pages', { count: this.pages })}</span> : null}
            {this.button(t('zoom_out'), 'fas fa-magnifying-glass-minus', () => this.setZoom(this.zoom * 0.8), off)}
            <span className="Lectern-zoom" aria-hidden="true">
              {Math.round(this.zoom * 100)}%
            </span>
            {this.button(t('zoom_in'), 'fas fa-magnifying-glass-plus', () => this.setZoom(this.zoom * 1.25), off)}
            {this.button(t('fit_width'), 'fas fa-arrows-left-right-to-line', () => this.fitWidth(), {
              ...off,
              className: 'Lectern-fit',
              'aria-pressed': String(this.fit === 'width'),
            })}
          </div>

          <div className="Lectern-group">
            {this.button(t('print'), 'fas fa-print', () => this.print(), off)}
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

        {!word && ready && this.sheets.length > 1 ? (
          <div className="Lectern-tabs" role="tablist" aria-label={t('sheets_label')}>
            {this.sheets.map((s, i) => (
              <button
                type="button"
                role="tab"
                className="Lectern-tab"
                aria-selected={String(i === this.sheet)}
                tabindex={i === this.sheet ? '0' : '-1'}
                onclick={() => this.showSheet(i)}
                onkeydown={(e) => {
                  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                    e.preventDefault();
                    const next = (i + (e.key === 'ArrowRight' ? 1 : -1) + this.sheets.length) % this.sheets.length;
                    this.showSheet(next);
                    requestAnimationFrame(() => this.element.querySelectorAll('.Lectern-tab')[next]?.focus());
                  }
                }}
              >
                {s.name}
              </button>
            ))}
          </div>
        ) : null}

        <div className="Lectern-body">
          <div
            className={'Lectern-docBody' + (word ? ' Lectern-docBody--word' : ' Lectern-scroll')}
            tabindex={word ? undefined : '0'}
            role={word ? undefined : 'region'}
            aria-label={word ? undefined : t('sheet_label', { name: this.sheets[this.sheet]?.name || name })}
          >
            {word ? (
              <iframe className="Lectern-frame" title={t('title_word', { name })} sandbox="allow-same-origin allow-modals" hidden={!ready} />
            ) : (
              <div className="Lectern-sheetHolder" />
            )}
            {!ready ? (
              <div className="Lectern-state">
                {this.status === 'loading' ? (
                  <p>
                    <Icon name="fas fa-spinner fa-spin" /> {this.progress ? t('loading_file_percent', { percent: this.progress }) : t('loading_file')}
                  </p>
                ) : (
                  <p>
                    {t(this.error)}{' '}
                    {this.error === 'error_open_file' ? (
                      <a className="Button Button--primary" href={this.attrs.url} download={name}>
                        {t('download')}
                      </a>
                    ) : null}
                  </p>
                )}
              </div>
            ) : null}
            {!word && ready && (this.truncatedRows || this.truncatedCols) ? (
              <div className="Lectern-more">
                <span>{t(this.truncatedCols ? 'sheet_cut_columns' : 'sheet_cut_rows', { rows: this.rows, columns: MAX_COLUMNS })}</span>
                {this.truncatedRows ? (
                  <button
                    type="button"
                    className="Button"
                    onclick={() => {
                      this.rows += ROW_STEP;
                      this.renderSheet();
                    }}
                  >
                    {t('show_more_rows')}
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>

        <div className="Lectern-live" aria-live="polite">
          {this.message}
        </div>
      </div>
    );
  }
}
