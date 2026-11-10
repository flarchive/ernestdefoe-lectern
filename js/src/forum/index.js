import app from 'flarum/forum/app';
import { extend } from 'flarum/common/extend';
import CommentPost from 'flarum/forum/components/CommentPost';

/*
 * This file is all a page without an open document pays for: it finds the
 * PDFs, Word files and spreadsheets in a post (or a wiki article) and gives
 * each a View button.
 * The viewers and their libraries load on the first click.
 */

const KINDS = { pdf: 'pdf', docx: 'word', xlsx: 'sheet', xlsm: 'sheet', xls: 'sheet', ods: 'sheet', csv: 'sheet' };
const ICONS = { pdf: 'fa-file-pdf', word: 'fa-file-word', sheet: 'fa-file-excel' };

/** 'pdf', 'word' or 'sheet' for a file name this forum lets readers open, else undefined. */
function kindOf(name) {
  const kind = KINDS[(/\.([a-z0-9]+)$/i.exec(name.trim()) || [])[1]?.toLowerCase()];
  return kind && (app.forum.attribute('lecternTypes') || []).includes(kind) ? kind : undefined;
}

const t = (key, params) => app.translator.trans('ernestdefoe-lectern.forum.' + key, params, true);

function button(className, name, text) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'Button hasIcon ' + className;
  el.innerHTML = '<i class="icon fas" aria-hidden="true"></i>';
  if (text) {
    const span = document.createElement('span');
    span.className = 'Button-label';
    el.appendChild(span);
  }
  setOpen(el, name, false);
  return el;
}

/** Shows whether this button's own viewer is open: View or Close, to the eye and to screen readers. */
function setOpen(el, name, open, inline) {
  el.firstChild.className = 'icon fas ' + (open ? 'fa-xmark' : 'fa-eye');
  el.setAttribute('aria-label', t(open ? 'close_file' : 'view_file', { name }));
  const label = el.querySelector('.Button-label');
  if (label) label.textContent = t(open ? 'close' : 'view');
  if (inline) el.setAttribute('aria-expanded', String(open));
}

/** A link to a document on this forum, or null. */
function sameOrigin(href) {
  try {
    const url = new URL(href, location.href);
    return url.origin === location.origin && kindOf(url.pathname) ? url : null;
  } catch {
    return null;
  }
}

/** The link text when it names the file, else the file name without FoF Upload's timestamp prefix. */
function fileName(a, url) {
  const text = a.textContent.trim();
  if (kindOf(text) && !text.includes('/')) return text;
  let name = url.pathname.split('/').pop();
  try {
    name = decodeURIComponent(name);
  } catch {}
  return name.replace(/^\d{9,}-\d+-(?=.)/, '');
}

/** Finds the documents in a post and adds the View buttons. Safe to run on every redraw. */
function enhancePost(post) {
  const body = post.element?.querySelector('.Post-body');
  if (!body) return;

  const model = post.attrs.post;
  const canDownload = app.forum.attribute('fof-upload.canDownload') && model.discussion()?.attribute('canDownloadFiles') !== false;
  enhance(post, body, canDownload, model.id());
}

/**
 * Adds the View buttons to one block of formatted content. `host` is the
 * component that owns it and keeps its open viewers. Without a post, FoF
 * Upload's files go through its UUID-only route, which checks the same
 * download permission (per tag too) against every discussion the file is in.
 */
function enhance(host, body, canDownload, postId) {
  if (!app.forum.attribute('lecternMode')) return;

  const fofUrl = (uuid) =>
    `${app.forum.attribute('apiUrl')}/fof/download/${encodeURIComponent(uuid)}` +
    (postId ? `/${encodeURIComponent(postId)}/${encodeURIComponent(app.session.csrfToken)}` : '');

  const add = (el, source, place) => {
    el.dataset.lectern = '1';
    source.kind = kindOf(source.name);
    if (!source.kind) return;
    const name = source.name;
    const b = button(place.className, name, place.text);
    b.addEventListener('click', (e) => {
      // Inside FoF Upload's button group, its download handler must not fire too.
      e.stopPropagation();
      // detail 0: activated from the keyboard, so focus goes straight to the pages.
      open(host, b, source, place.after, e.detail === 0);
    });
    place.insert(b);
  };

  // Lectern's own FoF Upload template.
  body.querySelectorAll('.LecternCard[data-lectern-uuid]:not([data-lectern])').forEach((card) => {
    // Marked first: the count below must be added once, View or not.
    card.dataset.lectern = '1';
    const download = card.querySelector('.LecternCard-download');
    if (download) {
      download.setAttribute('role', 'button');
      download.setAttribute('tabindex', '0');
      download.setAttribute('aria-label', t('download'));
      download.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          download.click();
        }
      });
    }
    const name = card.querySelector('.LecternCard-name')?.textContent.trim() || '';
    const kind = KINDS[(/\.([a-z0-9]+)$/i.exec(name) || [])[1]?.toLowerCase()];
    card.querySelector('.LecternCard-icon i')?.classList.replace('fa-file', ICONS[kind] || 'fa-file');
    if (kind) card.classList.add('LecternCard--' + kind);
    const meta = card.querySelector('.LecternCard-meta');
    const { lecternPages: pages, lecternSheets: sheets } = card.dataset;
    if (meta && (pages || sheets))
      meta.textContent += ' · ' + (pages ? t('pages', { count: Number(pages) }) : t('sheets', { count: Number(sheets) }));
    if (!canDownload) return;
    add(
      card,
      { url: fofUrl(card.dataset.lecternUuid), name },
      {
        className: 'Button--primary LecternCard-view',
        text: true,
        after: card,
        insert: (b) => card.querySelector('.LecternCard-actions')?.prepend(b),
      }
    );
  });

  // FoF Upload's plain "file" template, for files posted before this template.
  if (canDownload) {
    body.querySelectorAll('.ButtonGroup[data-fof-upload-download-uuid]:not([data-lectern])').forEach((group) => {
      const name = group.querySelector('.fof-upload-download-label')?.textContent.trim() || '';
      add(
        group,
        { url: fofUrl(group.dataset.fofUploadDownloadUuid), name },
        {
          className: 'LecternView',
          text: true,
          after: group,
          insert: (b) => group.append(b),
        }
      );
    });
  }

  // Plain links to a document on this forum, from any editor.
  body.querySelectorAll('a[href]:not([data-lectern])').forEach((a) => {
    const url = sameOrigin(a.getAttribute('href'));
    if (!url || a.closest('.LecternCard, .Lectern, [data-fof-upload-download-uuid]')) return;
    // FoF Upload's own files follow its download permission, even as links.
    if (!canDownload && app.forum.attribute('fof-upload.canDownload') !== undefined && url.pathname.includes('/assets/files/')) return;
    add(
      a,
      { url: url.href, name: fileName(a, url) },
      {
        className: 'Button--icon Button--link LecternLink-view',
        text: false,
        after: a.closest('p, li, blockquote, td, h1, h2, h3, h4, h5, h6') || a,
        insert: (b) => a.after(b),
      }
    );
  });
}

function open(host, trigger, source, after, keyboard) {
  const viewers = host.lecternOpen || (host.lecternOpen = new Map());
  const current = viewers.get(trigger);
  if (current) return current.close();

  const inline = app.forum.attribute('lecternMode') === 'inline' && !window.matchMedia('(max-width: 767px)').matches;

  trigger.setAttribute('aria-busy', 'true');
  import('./viewer/open')
    .then(({ default: openViewer }) => {
      const handle = openViewer({
        ...source,
        keyboard,
        trigger,
        after: inline ? after : null,
        onClose: () => {
          viewers.delete(trigger);
          setOpen(trigger, source.name, false, inline);
        },
      });
      viewers.set(trigger, handle);
      setOpen(trigger, source.name, true, inline);
    })
    .catch(() => window.open(source.url))
    .finally(() => trigger.removeAttribute('aria-busy'));
}

/** Closes the inline viewers whose content was replaced or removed. */
function prune(host, all) {
  host.lecternOpen?.forEach((handle) => (all || !handle.isConnected()) && handle.close());
}

app.initializers.add('ernestdefoe-lectern', () => {
  extend(CommentPost.prototype, 'oncreate', function () {
    enhancePost(this);
  });
  extend(CommentPost.prototype, 'onupdate', function () {
    prune(this, false);
    enhancePost(this);
  });
  extend(CommentPost.prototype, 'onremove', function () {
    prune(this, true);
  });

  // Link Robins Wiki: the article, its FAQ answers and its comments. Extended
  // by module name, so nothing happens on forums without the wiki.
  const wikiPage = 'ext:linkrobins/wiki/forum/components/WikiShowPage';
  const enhanceWiki = (page) =>
    page.element?.querySelectorAll('.Post-body').forEach((body) => enhance(page, body, app.forum.attribute('fof-upload.canDownload')));
  extend(wikiPage, 'oncreate', function () {
    enhanceWiki(this);
  });
  extend(wikiPage, 'onupdate', function () {
    prune(this, false);
    enhanceWiki(this);
  });
  extend(wikiPage, 'onremove', function () {
    prune(this, true);
  });
});
