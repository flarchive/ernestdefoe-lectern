<?php

namespace Ernestdefoe\Lectern\Tests\integration\api;

use Carbon\Carbon;
use Flarum\Discussion\Discussion;
use Flarum\Post\Post;
use Flarum\Testing\integration\RetrievesAuthorizedUsers;
use Flarum\Testing\integration\TestCase;
use Flarum\User\User;
use FoF\Upload\Helpers\Util;
use PHPUnit\Framework\Attributes\Test;

/** The PDF viewer template FoF Upload offers, and the card it renders. */
class UploadTemplateTest extends TestCase
{
    use RetrievesAuthorizedUsers;

    protected function setUp(): void
    {
        parent::setUp();

        $this->extension('fof-upload', 'ernestdefoe-lectern');

        $this->prepareDatabase([
            User::class => [$this->normalUser()],
            Discussion::class => [
                ['id' => 1, 'title' => 'Manuals', 'created_at' => Carbon::now()->subDay(), 'user_id' => 1, 'first_post_id' => 1, 'comment_count' => 1],
            ],
            Post::class => [
                ['id' => 1, 'discussion_id' => 1, 'number' => 1, 'created_at' => Carbon::now()->subDay(), 'user_id' => 1, 'type' => 'comment', 'content' => '<t><p>x</p></t>'],
            ],
        ]);
    }

    #[Test]
    public function fof_upload_lists_the_template()
    {
        $templates = $this->app()->getContainer()->make(Util::class)->getRenderTemplates();

        $this->assertArrayHasKey('lectern', $templates);
        $this->assertArrayHasKey('file', $templates, 'FoF Upload\'s own templates are still there');
        $this->assertSame('lectern', $templates['lectern']->tag());
    }

    #[Test]
    public function a_pdf_posts_as_a_card_with_fof_uploads_download_button()
    {
        $response = $this->send($this->request('POST', '/api/posts', [
            'authenticatedAs' => 2,
            'json' => ['data' => [
                'type' => 'posts',
                'attributes' => ['content' => '[upl-lectern uuid=0b9e5c1a-1111-4c4c-9999-123456789abc size=1.2MB pages=12]<b>Owner\'s</b> manual.pdf[/upl-lectern]'],
                'relationships' => ['discussion' => ['data' => ['type' => 'discussions', 'id' => '1']]],
            ]],
        ]));

        $this->assertSame(201, $response->getStatusCode(), (string) $response->getBody());
        $html = json_decode((string) $response->getBody(), true)['data']['attributes']['contentHtml'];

        $this->assertStringContainsString('class="LecternCard" data-lectern-uuid="0b9e5c1a-1111-4c4c-9999-123456789abc"', $html);
        $this->assertStringContainsString('data-fof-upload-download-uuid="0b9e5c1a-1111-4c4c-9999-123456789abc"', $html);
        $this->assertStringContainsString('1.2MB', $html);
        $this->assertStringContainsString('data-lectern-pages="12"', $html);
        $this->assertStringNotContainsString('data-lectern-sheets', $html, 'A count that is not given is left out');
        $this->assertStringContainsString('&lt;b&gt;Owner\'s&lt;/b&gt; manual.pdf', $html, 'The file name is text, never markup');
        $this->assertStringNotContainsString('<b>', $html);
    }
}
