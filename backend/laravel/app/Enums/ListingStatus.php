<?php

namespace App\Enums;

enum ListingStatus: string
{
    case DRAFT = 'DRAFT';
    case PENDING_REVIEW = 'PENDING_REVIEW';
    case ACTIVE = 'ACTIVE';
    case SOLD = 'SOLD';
    case REJECTED = 'REJECTED';
    case DISABLED = 'DISABLED';
    case ARCHIVED = 'ARCHIVED';
}