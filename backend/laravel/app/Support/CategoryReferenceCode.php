<?php

namespace App\Support;

class CategoryReferenceCode
{
    private const MAP = [
        'swine' => 'SW',
        'pig' => 'SW',
        'pigs' => 'SW',
        'carabao' => 'CA',
        'cattle' => 'CT',
        'goat' => 'GO',
        'sheep' => 'SH',
        'chicken' => 'CH',
        'poultry' => 'CH',
        'duck' => 'DU',
        'fish' => 'FI',
        'other' => 'OT',
        'other livestock' => 'OT',
        'other-livestock' => 'OT',
    ];

    public static function forSlugAndName(?string $slug, ?string $name): string
    {
        foreach ([$slug, $name] as $candidate) {
            if ($candidate === null) {
                continue;
            }

            $normalized = strtolower(trim($candidate));

            if (isset(self::MAP[$normalized])) {
                return self::MAP[$normalized];
            }
        }

        return 'OT';
    }
}
