<?php

namespace App\Enums;

enum InterestStatus: string
{
    case INTERESTED = 'INTERESTED';
    case CONTACTED = 'CONTACTED';
    case NEGOTIATING = 'NEGOTIATING';
    case PURCHASED = 'PURCHASED';
    case CLOSED = 'CLOSED';
}