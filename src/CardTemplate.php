<?php

namespace Ernestdefoe\Lectern;

use FoF\Upload\File;
use FoF\Upload\Templates\AbstractTextFormatterTemplate;
use Illuminate\Contracts\View\View;

/**
 * A FoF Upload template that shows a PDF, Word file or spreadsheet as a card
 * the reader can open, with its size and, for new uploads, its page or sheet count.
 *
 * The card keeps FoF Upload's own download button (data-fof-upload-download-uuid),
 * so download permissions, per-tag scoping and the locked state all come from
 * FoF Upload itself. Lectern only adds the View button in the browser.
 */
class CardTemplate extends AbstractTextFormatterTemplate
{
    /**
     * @var string
     */
    protected $tag = 'lectern';

    public function name(): string
    {
        return $this->trans('ernestdefoe-lectern.admin.template.name');
    }

    public function description(): string
    {
        return $this->trans('ernestdefoe-lectern.admin.template.description');
    }

    public function template(): View
    {
        return $this->getView('ernestdefoe-lectern::card');
    }

    public function bbcode(): string
    {
        return '[upl-lectern uuid={IDENTIFIER} size={SIMPLETEXT2} pages={UINT?} sheets={UINT?}]{TEXT1}[/upl-lectern]';
    }

    public function preview(File $file, ?string $displayName = null): string
    {
        // The optional counts are not FoF Upload placeholders: drop them, then
        // add the ones FileFacts found while this file was being uploaded.
        $bbcode = (string) preg_replace('/ (pages|sheets)=\{[^}]*\}/', '', parent::preview($file, $displayName));
        $facts = '';
        foreach (FileFacts::for($file) as $key => $count) {
            $facts .= " $key=".(int) $count;
        }

        return (string) preg_replace('/^\[upl-lectern\b([^\]]*)\]/', '[upl-lectern$1'.$facts.']', $bbcode, 1);
    }
}
