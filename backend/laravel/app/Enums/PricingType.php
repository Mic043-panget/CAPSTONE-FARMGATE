<?php

namespace App\Enums;

enum PricingType: string
{
    case PER_KILO = 'PER_KILO';
    case PER_HEAD = 'PER_HEAD';
}