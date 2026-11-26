<?php

namespace App\Support;

use Illuminate\Http\UploadedFile;

final class FarmgateImage
{
    public const MAX_INPUT_BYTES = 10 * 1024 * 1024;

    public const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;

    public const MIME_EXTENSIONS = [
        'image/jpeg' => 'jpg',
        'image/png' => 'png',
        'image/webp' => 'webp',
    ];

    public const MAX_PIXELS = 40_000_000;

    public const MAX_SIDE = 16_384;

    /**
     * @return array{mime_type: string, width: int, height: int, extension: string}|null
     */
    public static function inspect(UploadedFile $file): ?array
    {
        $path = $file->getRealPath();
        if (! $file->isValid() || ! is_string($path) || ! is_file($path)) {
            return null;
        }

        $mime = (new \finfo(FILEINFO_MIME_TYPE))->file($path);
        $image = @getimagesize($path);
        if (! is_string($mime)
            || ! isset(self::MIME_EXTENSIONS[$mime])
            || ! is_array($image)
            || ($image['mime'] ?? null) !== $mime
            || ! isset($image[0], $image[1])
            || $image[0] < 1
            || $image[1] < 1
            || $image[0] > self::MAX_SIDE
            || $image[1] > self::MAX_SIDE
            || $image[0] * $image[1] > self::MAX_PIXELS) {
            return null;
        }

        return [
            'mime_type' => $mime,
            'width' => $image[0],
            'height' => $image[1],
            'extension' => self::MIME_EXTENSIONS[$mime],
        ];
    }

    public static function isImage(UploadedFile $file): bool
    {
        $path = $file->getRealPath();

        return is_string($path)
            && is_file($path)
            && str_starts_with((new \finfo(FILEINFO_MIME_TYPE))->file($path) ?: '', 'image/');
    }
}
