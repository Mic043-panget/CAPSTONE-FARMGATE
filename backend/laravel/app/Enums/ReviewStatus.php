<?php

namespace App\Enums;

enum ReviewStatus: string
{
    case PUBLISHED = 'PUBLISHED';
    case HIDDEN = 'HIDDEN';
}
