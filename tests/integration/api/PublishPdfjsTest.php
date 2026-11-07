<?php

namespace Ernestdefoe\Lectern\Tests\integration\api;

use Flarum\Foundation\Event\ClearingCache;
use Flarum\Testing\integration\TestCase;
use Illuminate\Contracts\Events\Dispatcher;
use Illuminate\Contracts\Filesystem\Factory;
use PHPUnit\Framework\Attributes\Test;

/** pdf.js stays published after an update that only clears the cache. */
class PublishPdfjsTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        $this->extension('ernestdefoe-lectern');
    }

    #[Test]
    public function clearing_the_cache_publishes_the_bundled_pdfjs_and_drops_old_copies()
    {
        $container = $this->app()->getContainer();
        $assets = $container->make(Factory::class)->disk('flarum-assets');
        $folder = basename(glob(__DIR__.'/../../../assets/pdfjs-*', GLOB_ONLYDIR)[0]);

        $assets->deleteDirectory('extensions/ernestdefoe-lectern');
        $assets->put('extensions/ernestdefoe-lectern/pdfjs-1.0.0/pdf.min.js', 'old');

        $container->make(Dispatcher::class)->dispatch(new ClearingCache());

        $this->assertTrue($assets->exists("extensions/ernestdefoe-lectern/$folder/pdf.min.js"));
        $this->assertTrue($assets->exists("extensions/ernestdefoe-lectern/$folder/pdf.worker.min.js"));
        $this->assertTrue($assets->exists("extensions/ernestdefoe-lectern/$folder/cmaps/UniJIS-UCS2-H.bcmap"));
        $this->assertFalse($assets->exists("extensions/ernestdefoe-lectern/$folder/wasm/quickjs-eval.wasm"), 'No PDF scripting engine is shipped');
        $this->assertFalse($assets->exists('extensions/ernestdefoe-lectern/pdfjs-1.0.0/pdf.min.js'));
    }
}
