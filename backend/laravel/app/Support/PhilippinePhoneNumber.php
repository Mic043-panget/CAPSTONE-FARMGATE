<?php

namespace App\Support;

final class PhilippinePhoneNumber
{
    public static function normalize(string $phoneNumber): ?string
    {
        $compact = preg_replace('/[\s().-]/', '', trim($phoneNumber));

        if (! is_string($compact)) {
            return null;
        }

        if (preg_match('/^09\d{9}$/', $compact)) {
            return '+63'.substr($compact, 1);
        }

        return preg_match('/^\+639\d{9}$/', $compact) ? $compact : null;
    }
}
