<?php

namespace Ernestdefoe\Lectern\Tests\integration\api;

use Ernestdefoe\Lectern\FileFacts;
use Flarum\Testing\integration\TestCase;
use Laminas\Diactoros\Stream;
use Laminas\Diactoros\UploadedFile;
use PHPUnit\Framework\Attributes\Test;

/** Page and sheet counts, worked out once while FoF Upload takes the file. */
class UploadCountsTest extends TestCase
{
    private const FIXTURES = __DIR__.'/../../fixtures/';

    #[Test]
    public function it_counts_pdf_pages_word_pages_and_sheets()
    {
        $this->assertSame(['pages' => 2], FileFacts::count(self::FIXTURES.'quick-start.pdf', 'pdf'));
        $this->assertSame(['pages' => 4], FileFacts::count(self::FIXTURES.'service-guide.docx', 'docx'), 'From docProps/app.xml, as Word saves it');
        $this->assertSame(['sheets' => 2], FileFacts::count(self::FIXTURES.'two-sheets.xlsx', 'xlsx'));
    }

    #[Test]
    public function anything_else_or_anything_broken_counts_nothing()
    {
        $junk = tempnam(sys_get_temp_dir(), 'lectern');
        file_put_contents($junk, 'not a pdf /Type /Pages /Count 999');
        $this->assertSame([], FileFacts::count($junk, 'pdf'), 'No %PDF header, no count');
        $this->assertSame([], FileFacts::count($junk, 'docx'), 'Not a zip');
        $this->assertSame([], FileFacts::count(self::FIXTURES.'quick-start.pdf', 'csv'));
        $this->assertSame([], FileFacts::count('/no/such/file.pdf', 'pdf'));
        unlink($junk);
    }

    #[Test]
    public function an_upload_with_the_card_template_hands_back_the_count()
    {
        $this->extension('fof-upload', 'ernestdefoe-lectern');
        $this->setting('fof-upload.mimeTypes', json_encode([
            '^application\/pdf$' => ['adapter' => 'local', 'template' => 'lectern'],
        ]));

        $copy = tempnam(sys_get_temp_dir(), 'lectern');
        copy(self::FIXTURES.'quick-start.pdf', $copy);
        $file = new UploadedFile(new Stream(fopen($copy, 'r')), filesize($copy), UPLOAD_ERR_OK, 'quick-start.pdf', 'application/pdf');

        $response = $this->send($this->request('POST', '/api/fof/upload', ['authenticatedAs' => 1])->withUploadedFiles(['files' => [$file]]));

        $this->assertSame(200, $response->getStatusCode(), (string) $response->getBody());
        $bbcode = json_decode((string) $response->getBody(), true)['data'][0]['attributes']['bbcode'];
        $this->assertMatchesRegularExpression('/^\[upl-lectern uuid=[0-9a-f-]{36} size=\S+ pages=2\]quick-start\.pdf\[\/upl-lectern\]$/', $bbcode);
    }
}
