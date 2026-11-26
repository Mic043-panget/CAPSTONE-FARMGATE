<?php

namespace App\Rules;

use App\Support\FarmgateImage;
use Closure;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Http\UploadedFile;

class ValidFarmgateImage implements ValidationRule
{
    /**
     * @param  array<int, string>  $additionalMimeTypes
     */
    public function __construct(
        private readonly array $additionalMimeTypes = [],
        private readonly int $additionalMaxBytes = PHP_INT_MAX,
    ) {}

    public function validate(string $attribute, mixed $value, Closure $fail): void
    {
        if (! $value instanceof UploadedFile || ! $value->isValid()) {
            $fail('The uploaded file could not be read. Please choose it again.');

            return;
        }

        if (FarmgateImage::isImage($value)) {
            if (($value->getSize() ?? PHP_INT_MAX) > FarmgateImage::MAX_INPUT_BYTES) {
                $fail('Each image must be 10 MB or smaller. Images are optimized to 2 MB or smaller after upload.');

                return;
            }

            if (FarmgateImage::inspect($value) === null) {
                $fail('Upload a valid, uncorrupted JPEG, PNG, or WebP image.');
            }

            return;
        }

        $mime = (new \finfo(FILEINFO_MIME_TYPE))->file($value->getRealPath()) ?: '';
        if (! in_array($mime, $this->additionalMimeTypes, true)) {
            $fail('Upload a valid, uncorrupted JPEG, PNG, or WebP image.');

            return;
        }

        if (($value->getSize() ?? PHP_INT_MAX) > $this->additionalMaxBytes) {
            $fail('The uploaded document exceeds its maximum allowed size.');
        }
    }
}
