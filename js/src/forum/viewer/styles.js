// The viewer's styles ship in this lazy chunk, so pages without an open PDF
// don't carry them. Colours come from Flarum's own properties, so themes and
// dark mode apply; the PDF pages themselves stay white, like paper.
//
// The .textLayer rules follow pdf.js's pdf_viewer.css (Apache-2.0, Mozilla).
export default `
html.Lectern-open { overflow: hidden; }

.LecternDialog {
  position: fixed; inset: 0; width: 100%; height: 100%; max-width: none; max-height: none;
  margin: 0; padding: 0; border: 0; background: var(--body-bg); color: var(--text-color);
}
.LecternDialog::backdrop { background: rgba(0, 0, 0, 0.6); }
.LecternInline { margin: 10px 0 16px; }

.Lectern {
  display: flex; flex-direction: column; min-width: 0; color: var(--text-color);
  background: var(--control-bg); font-size: 14px; line-height: 1.4;
}
.Lectern:focus { outline: none; }
.Lectern--inline { height: min(80vh, 900px); border-radius: var(--border-radius, 4px); overflow: hidden; border: 1px solid var(--control-bg); }
.Lectern--modal { height: 100%; padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left); }
.Lectern:fullscreen { height: 100%; }

.Lectern-toolbar {
  display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 4px 12px;
  padding: 6px 8px; background: var(--body-bg); border-bottom: 1px solid var(--control-bg);
}
.Lectern-toolbar, .Lectern-search, .Lectern-tabs { flex-shrink: 0; }
.Lectern-group { display: flex; align-items: center; gap: 2px; min-width: 0; }
.Lectern-group:first-child { flex: 1 1 160px; }
.Lectern .Lectern-button.Button { color: var(--control-color); background: transparent; width: 36px; height: 36px; padding: 0; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; }
.Lectern .Lectern-button.Button:hover, .Lectern .Lectern-button.Button:focus-visible { background: var(--control-bg); color: var(--text-color); }
.Lectern .Lectern-button[aria-pressed="true"] { color: var(--primary-color); }
.Lectern .Lectern-button:disabled { opacity: 0.4; }
.Lectern-name { font-weight: 600; color: var(--text-color); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; padding: 0 4px; }
.Lectern .Lectern-pageInput.FormControl { width: 48px; height: 32px; padding: 0 4px; text-align: center; color: var(--text-color); background: var(--control-bg); }
.Lectern-of, .Lectern-zoom, .Lectern-searchCount { color: var(--muted-color); white-space: nowrap; padding: 0 4px; font-variant-numeric: tabular-nums; }
.Lectern-zoom { min-width: 46px; text-align: center; }

.Lectern-search { display: flex; align-items: center; gap: 4px; padding: 6px 8px; background: var(--body-bg); border-bottom: 1px solid var(--control-bg); }
.Lectern .Lectern-searchInput.FormControl { flex: 1 1 auto; min-width: 0; height: 34px; color: var(--text-color); background: var(--control-bg); }

.Lectern-body { position: relative; display: flex; flex: 1 1 auto; min-height: 0; }
.Lectern-scroll {
  flex: 1 1 auto; min-width: 0; overflow: auto; overscroll-behavior: contain; outline: none;
  touch-action: pan-x pan-y; -webkit-overflow-scrolling: touch;
}
.Lectern-scroll:focus-visible { box-shadow: inset 0 0 0 2px var(--primary-color); }
.Lectern-pages { display: flex; flex-direction: column; align-items: center; gap: ${12}px; padding: 12px; width: max-content; min-width: 100%; box-sizing: border-box; }
.Lectern-page {
  position: relative; flex-shrink: 0; background: #fff; box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25);
  --scale-round-x: 1px; --scale-round-y: 1px;
}
.Lectern-pageInner, .Lectern-pageInner canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }

.Lectern-state { display: flex; align-items: center; justify-content: center; min-height: 100%; padding: 24px; text-align: center; color: var(--text-color); }
.Lectern-state p { margin: 0; }
.Lectern-state .Button { margin-left: 8px; }

.Lectern-docBody { position: relative; flex: 1 1 auto; min-width: 0; min-height: 0; overflow: auto; overscroll-behavior: contain; touch-action: pan-x pan-y; outline: none; }
.Lectern-docBody--word { overflow: hidden; display: flex; }
.Lectern-frame { flex: 1 1 auto; width: 100%; height: 100%; border: 0; display: block; background: var(--control-bg); }
.Lectern-docBody .Lectern-state { position: absolute; inset: 0; }
.Lectern-docIcon { font-size: 18px; color: var(--muted-color); padding: 0 4px 0 6px; }
.Lectern-sheetHolder { display: inline-block; min-width: 100%; background: var(--body-bg); }
.Lectern-sheet { border-collapse: collapse; font-size: 13px; color: var(--text-color); background: var(--body-bg); }
.Lectern-sheet th, .Lectern-sheet td { border: 1px solid var(--control-bg); padding: 3px 8px; white-space: pre; max-width: 420px; overflow: hidden; text-overflow: ellipsis; vertical-align: top; text-align: left; }
.Lectern-sheet td.is-number { text-align: right; font-variant-numeric: tabular-nums; }
.Lectern-sheet thead th { position: sticky; top: 0; z-index: 1; background: var(--control-bg); color: var(--muted-color); font-weight: 600; text-align: center; }
.Lectern-sheet tbody th { position: sticky; left: 0; background: var(--control-bg); color: var(--muted-color); font-weight: 600; text-align: right; }
.Lectern-sheet .Lectern-corner { left: 0; z-index: 2; }
.Lectern-tabs { display: flex; gap: 2px; overflow-x: auto; padding: 4px 8px 0; background: var(--body-bg); border-bottom: 1px solid var(--control-bg); }
.Lectern-tab { flex-shrink: 0; border: 0; border-bottom: 2px solid transparent; background: none; padding: 6px 12px; font: inherit; color: var(--muted-color); cursor: pointer; white-space: nowrap; }
.Lectern-tab[aria-selected="true"] { color: var(--text-color); border-bottom-color: var(--primary-color); font-weight: 600; }
.Lectern-tab:focus-visible { outline: 2px solid var(--primary-color); outline-offset: -2px; }
.Lectern-more { position: sticky; left: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 10px 12px; color: var(--muted-color); }
@media print { .Lectern-print .Lectern-sheet { font-size: 10px; } .Lectern-print .Lectern-sheet th, .Lectern-print .Lectern-sheet td { max-width: none; position: static; } }
.Lectern-thumbs {
  flex: 0 0 140px; overflow-y: auto; overscroll-behavior: contain; padding: 10px; background: var(--body-bg);
  border-right: 1px solid var(--control-bg); display: flex; flex-direction: column; gap: 10px;
}
.Lectern-thumb {
  display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 4px; border: 2px solid transparent;
  border-radius: 4px; background: none; cursor: pointer; color: var(--muted-color); font: inherit;
}
.Lectern-thumb[aria-current="page"] { border-color: var(--primary-color); color: var(--text-color); }
.Lectern-thumb:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 1px; }
.Lectern-thumbImage { display: block; width: 100px; background: #fff; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25); }
.Lectern-thumbImage canvas { display: block; width: 100%; height: 100%; }
.Lectern-thumbNumber { font-size: 12px; }

.Lectern-printing {
  position: absolute; left: 50%; bottom: 16px; transform: translateX(-50%); padding: 8px 14px; border-radius: 4px;
  background: var(--text-color); color: var(--body-bg); z-index: 2;
}
.Lectern .Lectern-button.Lectern-close--narrow { display: none; }
.Lectern-live { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

@media (max-width: 719px) {
  .Lectern-thumbs { position: absolute; inset: 0 auto 0 0; z-index: 2; box-shadow: 2px 0 8px rgba(0, 0, 0, 0.3); }
  .Lectern-zoom, .Lectern .Lectern-button.Lectern-fit, .Lectern .Lectern-button.Lectern-fullscreen, .Lectern .Lectern-button.Lectern-close--wide { display: none; }
  .Lectern .Lectern-button.Lectern-close--narrow { display: inline-flex; margin-left: auto; }
  .Lectern-toolbar { gap: 2px 4px; padding: 4px; justify-content: flex-start; }
  .Lectern-group:first-child { flex-basis: 100%; }
  .Lectern-group:last-child { margin-left: auto; }
}

.textLayer {
  position: absolute; text-align: initial; inset: 0; overflow: clip; opacity: 1; line-height: 1; z-index: 0;
  -webkit-text-size-adjust: none; text-size-adjust: none; forced-color-adjust: none; transform-origin: 0 0; caret-color: CanvasText;
  --min-font-size: 1;
  --text-scale-factor: calc(var(--total-scale-factor) * var(--min-font-size));
  --min-font-size-inv: calc(1 / var(--min-font-size));
}
.textLayer :is(span, br) { color: transparent; position: absolute; white-space: pre; cursor: text; transform-origin: 0% 0%; user-select: text; -webkit-user-select: text; }
.textLayer > :not(.markedContent), .textLayer .markedContent span:not(.markedContent) {
  z-index: 1; --font-height: 0; font-size: calc(var(--text-scale-factor) * var(--font-height));
  --scale-x: 1; --rotate: 0deg;
  transform: rotate(var(--rotate)) scaleX(var(--scale-x)) scale(var(--min-font-size-inv));
}
.textLayer .markedContent { display: contents; }
.textLayer ::selection { background: rgba(0, 0, 255, 0.25); color: transparent; }
.textLayer .Lectern-hit { color: transparent; background: rgba(255, 200, 0, 0.45); border-radius: 2px; padding: 0; margin: 0; position: static; }
.textLayer .Lectern-hit.is-current { background: rgba(255, 120, 0, 0.6); }

@media print {
  html.Lectern-printing body > :not(.Lectern-print) { display: none !important; }
  html.Lectern-printing body { background: #fff; }
  .Lectern-print img { display: block; width: 100%; height: auto; max-height: 100vh; object-fit: contain; break-after: page; page-break-after: always; }
}
.Lectern-print { display: none; }
@media print { .Lectern-print { display: block; } }
`;
