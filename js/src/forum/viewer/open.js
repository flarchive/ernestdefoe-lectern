import Viewer from './Viewer';
import DocViewer from './DocViewer';
import styles from './styles';

function addStyles() {
  if (document.getElementById('lectern-styles')) return;
  const style = document.createElement('style');
  style.id = 'lectern-styles';
  style.textContent = styles;
  document.head.append(style);
}

/**
 * Opens a document, in the post under `after` or, without it, full screen in a
 * native <dialog>. The dialog sits in the browser's top layer, above the
 * header, the Mobile Tab bar, the composer and cookie banners, and it keeps
 * focus inside until it closes.
 *
 * Returns { close, isConnected }.
 */
export default function open({ url, name, kind, trigger, after, keyboard, onClose }) {
  addStyles();

  const modal = !after;
  let host;
  let closed = false;

  const close = () => {
    if (closed) return;
    closed = true;
    m.mount(host, null);
    if (modal) {
      if (host.open) host.close();
      document.documentElement.classList.remove('Lectern-open');
    }
    host.remove();
    if (trigger.isConnected) trigger.focus({ preventScroll: !modal });
    onClose();
  };

  if (modal) {
    host = document.createElement('dialog');
    host.className = 'LecternDialog';
    host.setAttribute('aria-label', name);
    // Escape, or the phone's back gesture: close through our own path.
    host.addEventListener('cancel', (e) => {
      e.preventDefault();
      close();
    });
    document.body.append(host);
  } else {
    host = document.createElement('div');
    host.className = 'LecternInline';
    after.after(host);
  }

  m.mount(host, { view: () => m(kind === 'pdf' ? Viewer : DocViewer, { url, name, kind, modal, keyboard, onclose: close }) });

  if (modal) {
    document.documentElement.classList.add('Lectern-open');
    host.showModal();
    // Keyboard users land on the pages; a tap focuses the viewer without a focus ring.
    host.querySelector(keyboard ? '.Lectern-scroll, .Lectern-frame' : '.Lectern')?.focus({ preventScroll: true });
  } else {
    host.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  return { close, isConnected: () => host.isConnected };
}
