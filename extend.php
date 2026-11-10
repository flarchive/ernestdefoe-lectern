<?php

/*
 * Lectern — read PDF attachments inside the post.
 *
 * The server only decides who gets the viewer, in which form and for which
 * file types, adds a FoF Upload template that counts pages as files arrive, and
 * keeps the bundled pdf.js files published. The viewers live in the browser
 * and load when someone opens a document.
 */

use Ernestdefoe\Lectern\FileFacts;
use Ernestdefoe\Lectern\PublishPdfjs;
use Ernestdefoe\Lectern\UploadTemplateProvider;
use Flarum\Api\Context;
use Flarum\Api\Resource\ForumResource;
use Flarum\Api\Schema;
use Flarum\Extend;
use Flarum\Foundation\Event\ClearingCache;
use Flarum\Settings\SettingsRepositoryInterface;
use FoF\Upload\Events\File\WillBeUploaded;

return [
    (new Extend\Frontend('forum'))
        ->js(__DIR__.'/js/dist/forum.js')
        ->jsDirectory(__DIR__.'/js/dist/forum')
        ->css(__DIR__.'/less/forum.less'),

    (new Extend\Frontend('admin'))
        ->js(__DIR__.'/js/dist/admin.js'),

    new Extend\Locales(__DIR__.'/locale'),

    (new Extend\View())
        ->namespace('ernestdefoe-lectern', __DIR__.'/views'),

    (new Extend\Settings())
        ->default('ernestdefoe-lectern.enabled', true)
        ->default('ernestdefoe-lectern.mode', 'modal')
        ->default('ernestdefoe-lectern.pdf', true)
        ->default('ernestdefoe-lectern.word', true)
        ->default('ernestdefoe-lectern.sheets', true),

    // null means "leave PDF links alone": the viewer is off, or this reader's
    // groups may not use it and keep the normal download link.
    (new Extend\ApiResource(ForumResource::class))
        ->fields(fn () => [
            Schema\Str::make('lecternMode')
                ->nullable()
                ->get(function (object $forum, Context $context) {
                    $settings = resolve(SettingsRepositoryInterface::class);

                    if (! $settings->get('ernestdefoe-lectern.enabled') || ! $context->getActor()->can('ernestdefoe-lectern.view')) {
                        return null;
                    }

                    return $settings->get('ernestdefoe-lectern.mode') === 'inline' ? 'inline' : 'modal';
                }),
            Schema\Arr::make('lecternTypes')
                ->get(function () {
                    $settings = resolve(SettingsRepositoryInterface::class);

                    return array_keys(array_filter([
                        'pdf' => $settings->get('ernestdefoe-lectern.pdf'),
                        'word' => $settings->get('ernestdefoe-lectern.word'),
                        'sheet' => $settings->get('ernestdefoe-lectern.sheets'),
                    ]));
                }),
        ]),

    (new Extend\Event())
        ->listen(ClearingCache::class, PublishPdfjs::class),

    (new Extend\Conditional())
        ->whenExtensionEnabled('fof-upload', fn () => [
            (new Extend\ServiceProvider())->register(UploadTemplateProvider::class),
            (new Extend\Event())->listen(WillBeUploaded::class, FileFacts::class),
        ]),
];
