<?php

namespace App\Enums;

enum ComplaintStatus: string
{
    case OPEN = 'OPEN';
    case UNDER_REVIEW = 'UNDER_REVIEW';
    case RESOLVED = 'RESOLVED';
    case REJECTED = 'REJECTED';
}
