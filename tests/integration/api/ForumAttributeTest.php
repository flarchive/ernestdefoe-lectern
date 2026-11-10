<?php

namespace Ernestdefoe\Lectern\Tests\integration\api;

use Flarum\Group\Group;
use Flarum\Testing\integration\RetrievesAuthorizedUsers;
use Flarum\Testing\integration\TestCase;
use Flarum\User\User;
use PHPUnit\Framework\Attributes\Test;

/** What the forum tells each reader about the viewer. */
class ForumAttributeTest extends TestCase
{
    use RetrievesAuthorizedUsers;

    protected function setUp(): void
    {
        parent::setUp();

        $this->extension('ernestdefoe-lectern');

        $this->prepareDatabase([
            User::class => [$this->normalUser()],
        ]);
    }

    private function mode(?int $actor = null): mixed
    {
        $response = $this->send($this->request('GET', '/api', $actor ? ['authenticatedAs' => $actor] : []));
        $this->assertSame(200, $response->getStatusCode());

        return json_decode((string) $response->getBody(), true)['data']['attributes']['lecternMode'];
    }

    #[Test]
    public function everyone_gets_the_full_screen_viewer_out_of_the_box()
    {
        $this->assertSame('modal', $this->mode());
        $this->assertSame('modal', $this->mode(2));

        $types = json_decode((string) $this->send($this->request('GET', '/api'))->getBody(), true)['data']['attributes']['lecternTypes'];
        $this->assertSame(['pdf', 'word', 'sheet'], $types, 'Every file type is on out of the box');
    }

    #[Test]
    public function the_admin_can_choose_the_inline_viewer()
    {
        $this->setting('ernestdefoe-lectern.mode', 'inline');

        $this->assertSame('inline', $this->mode());
    }

    #[Test]
    public function an_unknown_mode_falls_back_to_full_screen()
    {
        $this->setting('ernestdefoe-lectern.mode', '<script>');

        $this->assertSame('modal', $this->mode());
    }

    #[Test]
    public function switching_it_off_leaves_every_pdf_a_link()
    {
        $this->setting('ernestdefoe-lectern.enabled', '0');

        $this->assertNull($this->mode());
        $this->assertNull($this->mode(1));
    }

    #[Test]
    public function a_file_type_the_admin_turns_off_is_left_out()
    {
        $types = fn () => json_decode((string) $this->send($this->request('GET', '/api'))->getBody(), true)['data']['attributes']['lecternTypes'];

        $this->setting('ernestdefoe-lectern.word', '0');
        $this->assertSame(['pdf', 'sheet'], $types());
    }

    #[Test]
    public function only_the_groups_given_the_permission_get_the_viewer()
    {
        $this->app();
        $this->database()->table('group_permission')->where('permission', 'ernestdefoe-lectern.view')->delete();
        $this->database()->table('group_permission')->insert(['group_id' => Group::MEMBER_ID, 'permission' => 'ernestdefoe-lectern.view']);

        $this->assertNull($this->mode(), 'A guest keeps the normal link');
        $this->assertSame('modal', $this->mode(2));
    }

    #[Test]
    public function the_attribute_costs_no_queries()
    {
        $count = function (bool $withLectern) {
            $db = $this->database();
            $db->flushQueryLog();
            $db->enableQueryLog();
            $this->send($this->request('GET', '/api', ['authenticatedAs' => 2]));
            $queries = count($db->getQueryLog());
            $db->disableQueryLog();

            return $queries;
        };

        $this->app();
        $count(true);
        $with = $count(true);

        $this->setting('ernestdefoe-lectern.enabled', '0');
        $without = $count(false);

        $this->assertSame($without, $with);
    }
}
