<?php

namespace App\Enums;

enum Role: string
{
    case ADMIN = 'ADMIN';
    case SELLER = 'SELLER';
    case BUYER = 'BUYER';
    case RIDER = 'RIDER';

    public function canSelfRegister(): bool
    {
        return match ($this) {
            self::BUYER, self::SELLER => true,
            self::ADMIN, self::RIDER => false,
        };
    }
}