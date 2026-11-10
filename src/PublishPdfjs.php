<?php

namespace Ernestdefoe\Lectern;

use Flarum\Extension\ExtensionManager;
use Illuminate\Contracts\Filesystem\Factory;

/**
 * Keeps the bundled pdf.js files published after an update.
 *
 * Flarum copies an extension's assets/ folder only when the extension is
 * enabled (or on assets:publish), but an update only clears the cache. pdf.js
 * lives in a folder named after its version, so a Lectern update that moves to
 * a new pdf.js finds its folder missing here and copies it, and drops the old
 * one. When the folder is already there this is one file check.
 */
class PublishPdfjs
{
    public function __construct(
        protected ExtensionManager $extensions,
        protected Factory $filesystem
    ) {
    }

    public function handle(): void
    {
        $extension = $this->extensions->getExtension('ernestdefoe-lectern');

        if (! $extension || ! $this->extensions->isEnabled('ernestdefoe-lectern')) {
            return;
        }

        $assets = $this->filesystem->disk('flarum-assets');
        $base = 'extensions/ernestdefoe-lectern';
        $bundled = array_map('basename', glob($extension->getPath().'/assets/pdfjs-*', GLOB_ONLYDIR) ?: []);

        foreach ($bundled as $folder) {
            if (! $assets->exists("$base/$folder/pdf.min.js")) {
                $extension->copyAssetsTo($assets);
                break;
            }
        }

        foreach ($assets->directories($base) as $published) {
            if (str_starts_with(basename($published), 'pdfjs-') && ! in_array(basename($published), $bundled, true)) {
                $assets->deleteDirectory($published);
            }
        }
    }
}
