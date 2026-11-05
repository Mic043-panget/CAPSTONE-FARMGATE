<?php

namespace App\Enums;

enum OrderStatus: string
{
    case PENDING_CONFIRMATION = 'PENDING_CONFIRMATION';
    case CONFIRMED = 'CONFIRMED';
    case PREPARING = 'PREPARING';
    case READY_FOR_PICKUP = 'READY_FOR_PICKUP';
    case FULFILLING = 'FULFILLING';
    case COMPLETED = 'COMPLETED';
    case CANCELLED = 'CANCELLED';
    case REJECTED = 'REJECTED';
}
