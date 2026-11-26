<?php

namespace App\Services;

use App\Support\FarmgateImage;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Intervention\Image\ImageManager;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Throwable;

class ImageUploadService
{
    public function storeOptimized(
        UploadedFile $file,
        string $directory,
        string $disk,
        int $maxDimension = 2560,
        int $quality = 90,
    ): string {
        abort_if(FarmgateImage::inspect($file) === null, 422, 'Upload a valid, uncorrupted JPEG, PNG, or WebP image.');
        abort_if(($file->getSize() ?? PHP_INT_MAX) > FarmgateImage::MAX_INPUT_BYTES, 422, 'Each image must be 10 MB or smaller.');

        $bytes = $this->encode($file, $maxDimension, $quality);
        $prefix = trim($directory, '/');
        $path = ($prefix !== '' ? $prefix.'/' : '').Str::random(40).'.webp';

        $storage = null;
        try {
            $storage = Storage::disk($disk);
            abort_unless($storage->put($path, $bytes), 503, 'The image could not be saved. Please retry the upload.');
        } catch (Throwable $exception) {
            $this->cleanupAfterFailure($storage, $disk, [$path]);
            Log::error('An optimized image could not be stored.', ['disk' => $disk, 'exception' => $exception::class]);
            abort(503, 'The image could not be saved. Please retry the upload.');
        }

        return $path;
    }

    /**
     * Save a metadata-free, size-limited evidence image on its existing disk.
     *
     * @return array{path: string, mime_type: string, sha256: string, size: int}
     */
    public function storeEvidence(
        UploadedFile $file,
        string $directory,
        string $disk,
        int $maxDimension = 2560,
        int $quality = 92,
    ): array {
        abort_if(FarmgateImage::inspect($file) === null, 422, 'Upload a valid, uncorrupted JPEG, PNG, or WebP image.');
        abort_if(($file->getSize() ?? PHP_INT_MAX) > FarmgateImage::MAX_INPUT_BYTES, 422, 'Each image must be 10 MB or smaller.');

        $contents = $this->encode($file, $maxDimension, $quality);
        $prefix = trim($directory, '/');
        $path = ($prefix !== '' ? $prefix.'/' : '').Str::random(40).'.webp';
        $storage = null;
        try {
            $storage = Storage::disk($disk);
            abort_unless($storage->put($path, $contents), 503, 'The image evidence could not be saved. Please retry the upload.');
        } catch (Throwable $exception) {
            $this->cleanupAfterFailure($storage, $disk, [$path]);
            Log::error('Image evidence could not be stored.', ['disk' => $disk, 'exception' => $exception::class]);
            abort(503, 'The image evidence could not be saved. Please retry the upload.');
        }

        return [
            'path' => $path,
            'mime_type' => 'image/webp',
            'sha256' => hash('sha256', $contents),
            'size' => strlen($contents),
        ];
    }

    public function previewPath(string $path): string
    {
        return $path.'.preview.webp';
    }

    public function deleteEvidence(string $path, string $disk): void
    {
        Storage::disk($disk)->delete([$path, $this->previewPath($path)]);
    }

    /**
     * @param  array<int, string>  $paths
     */
    private function cleanupAfterFailure(mixed $storage, string $disk, array $paths): void
    {
        try {
            ($storage ?? Storage::disk($disk))->delete($paths);
        } catch (Throwable $exception) {
            Log::error('Failed to clean up an incomplete image upload.', [
                'disk' => $disk,
                'exception' => $exception::class,
            ]);
        }
    }

    public function encode(UploadedFile $file, int $maxDimension, int $quality = 90): string
    {
        abort_if(FarmgateImage::inspect($file) === null, 422, 'Upload a valid, uncorrupted JPEG, PNG, or WebP image.');
        abort_if(($file->getSize() ?? PHP_INT_MAX) > FarmgateImage::MAX_INPUT_BYTES, 422, 'Each image must be 10 MB or smaller.');

        try {
            $image = ImageManager::gd()->read($file->getRealPath());
            $image->orient()->scaleDown(width: $maxDimension, height: $maxDimension);
            $quality = max(20, min(100, $quality));

            while (true) {
                for ($candidateQuality = $quality; $candidateQuality >= 20; $candidateQuality -= 10) {
                    $encoded = $image->toWebp(quality: $candidateQuality)->toString();
                    if (strlen($encoded) <= FarmgateImage::MAX_OUTPUT_BYTES) {
                        return $encoded;
                    }
                }

                if ($image->width() <= 1 && $image->height() <= 1) {
                    abort(422, 'This image could not be compressed to 2 MB. Choose another image and retry.');
                }

                $image->scaleDown(
                    width: max(1, (int) floor($image->width() * 0.8)),
                    height: max(1, (int) floor($image->height() * 0.8)),
                );
            }
        } catch (Throwable $exception) {
            if ($exception instanceof HttpException) {
                throw $exception;
            }
            Log::warning('An uploaded image could not be decoded.', ['exception' => $exception::class]);
            abort(422, 'The image is corrupt or unsupported. Please choose a valid JPEG, PNG, or WebP image.');
        }
    }
}
