<?php

use Flarum\Database\Migration;
use Flarum\Group\Group;

// Everyone, guests included, can open PDFs in the viewer until an admin narrows it.
return Migration::addPermissions([
    'ernestdefoe-lectern.view' => Group::GUEST_ID,
]);
