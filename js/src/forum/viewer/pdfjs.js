import app from 'flarum/forum/app';

/* global __PDFJS_VERSION__ */

let loading = null;

/** The forum's own copy of pdf.js, published from the extension's assets/ folder. */
export function base() {
  return `${app.forum.attribute('assetsBaseUrl')}/extensions/ernestdefoe-lectern/pdfjs-${__PDFJS_VERSION__}/`;
}

/** Loads pdf.js once per page view. A failed load can be retried. */
export function loadPdfjs() {
  if (!loading) {
    loading = import(/* webpackIgnore: true */ base() + 'pdf.min.js').then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = base() + 'pdf.worker.min.js';
      return lib;
    });
    loading.catch(() => (loading = null));
  }
  return loading;
}

/** Downloads the file with the reader's own session, reporting progress as it goes. */
export async function fetchFile(url, signal, onProgress) {
  const response = await fetch(url, { credentials: 'same-origin', signal });

  if (!response.ok) {
    const error = new Error('HTTP ' + response.status);
    error.status = response.status;
    throw error;
  }

  // A gzipped response reports its compressed length, so no percentage then.
  const total = response.headers.get('Content-Encoding') ? 0 : Number(response.headers.get('Content-Length')) || 0;
  if (!response.body || !total) return new Uint8Array(await response.arrayBuffer());

  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onProgress(Math.min(99, Math.round((received / total) * 100)));
  }

  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

/**
 * Opens a document with everything that could run code turned off: no XFA
 * forms, no eval, and no annotation layer, so a PDF's scripts and actions are
 * never wired up. Fonts, CMaps and image decoders come from the forum itself.
 */
export function openDocument(lib, data) {
  const dir = base();
  return lib.getDocument({
    data,
    isEvalSupported: false,
    enableXfa: false,
    cMapUrl: dir + 'cmaps/',
    cMapPacked: true,
    standardFontDataUrl: dir + 'standard_fonts/',
    wasmUrl: dir + 'wasm/',
    iccUrl: dir + 'iccs/',
  });
}
