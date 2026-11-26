<?php

namespace Tests\Unit;

use App\Rules\ValidFarmgateImage;
use App\Services\ImageUploadService;
use Illuminate\Filesystem\FilesystemAdapter;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Mockery;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Tests\TestCase;

class FarmgateImageUploadTest extends TestCase
{
    public function test_large_valid_image_is_scaled_without_changing_aspect_ratio_and_output_is_at_most_two_mib(): void
    {
        Storage::fake('image-test');
        $file = UploadedFile::fake()->image('large.png', 4000, 1000);
        $errors = [];
        (new ValidFarmgateImage)->validate('image', $file, function (string $message) use (&$errors): void {
            $errors[] = $message;
        });

        $this->assertSame([], $errors);
        $path = app(ImageUploadService::class)->storeOptimized($file, 'listings', 'image-test');
        $saved = Storage::disk('image-test')->get($path);
        $dimensions = getimagesizefromstring($saved);

        $this->assertNotFalse($dimensions);
        $this->assertSame([2560, 640], [$dimensions[0], $dimensions[1]]);
        $this->assertLessThanOrEqual(2 * 1024 * 1024, strlen($saved));
        $this->assertSame('webp', pathinfo($path, PATHINFO_EXTENSION));
        $this->assertSame('image/webp', (new \finfo(FILEINFO_MIME_TYPE))->buffer($saved));
    }

    public function test_valid_image_larger_than_two_mib_is_accepted_and_compressed_to_the_output_limit(): void
    {
        Storage::fake('image-test');
        $source = UploadedFile::fake()->image('photo.jpg', 600, 400);
        $jpeg = file_get_contents($source->getRealPath());
        $comment = "\xFF\xFE\xFF\xFF".str_repeat('m', 65_533);
        $file = UploadedFile::fake()->createWithContent(
            'photo-with-metadata.jpg',
            substr($jpeg, 0, 2).str_repeat($comment, 40).substr($jpeg, 2),
        );

        $this->assertGreaterThan(2 * 1024 * 1024, $file->getSize());
        $this->assertLessThanOrEqual(10 * 1024 * 1024, $file->getSize());

        $errors = [];
        (new ValidFarmgateImage)->validate('image', $file, function (string $message) use (&$errors): void {
            $errors[] = $message;
        });
        $this->assertSame([], $errors);

        $path = app(ImageUploadService::class)->storeOptimized($file, 'listings', 'image-test');
        $saved = Storage::disk('image-test')->get($path);

        $this->assertLessThanOrEqual(2 * 1024 * 1024, strlen($saved));
        $this->assertSame('image/webp', (new \finfo(FILEINFO_MIME_TYPE))->buffer($saved));
    }

    public function test_evidence_is_stored_as_a_compressed_webp_with_a_matching_hash(): void
    {
        Storage::fake('image-test');
        $file = UploadedFile::fake()->image('evidence.png', 3000, 1000);
        $stored = app(ImageUploadService::class)->storeEvidence($file, 'private', 'image-test');
        $saved = Storage::disk('image-test')->get($stored['path']);

        $this->assertSame(hash('sha256', $saved), $stored['sha256']);
        $this->assertSame(strlen($saved), $stored['size']);
        $this->assertLessThanOrEqual(2 * 1024 * 1024, strlen($saved));
        $this->assertSame('image/webp', $stored['mime_type']);
        $this->assertSame('image/webp', (new \finfo(FILEINFO_MIME_TYPE))->buffer($saved));
        Storage::disk('image-test')->assertMissing($stored['path'].'.preview.webp');
    }

    public function test_oversized_corrupt_disguised_and_unsupported_images_are_rejected(): void
    {
        $rule = new ValidFarmgateImage;
        $invalidFiles = [
            UploadedFile::fake()->image('large.png')->size(10241),
            UploadedFile::fake()->createWithContent('corrupt.jpg', 'not an image'),
            UploadedFile::fake()->createWithContent('script.jpg', '<?php echo "no";'),
            UploadedFile::fake()->createWithContent('vector.svg', '<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
        ];

        foreach ($invalidFiles as $file) {
            $errors = [];
            $rule->validate('image', $file, function (string $message) use (&$errors): void {
                $errors[] = $message;
            });
            $this->assertNotSame([], $errors);
        }
    }

    public function test_storage_failure_is_reported_as_retryable_and_partial_files_are_removed(): void
    {
        $disk = Mockery::mock(FilesystemAdapter::class);
        $disk->shouldReceive('put')->once()->andReturn(false);
        $disk->shouldReceive('delete')->once()->with(Mockery::type('array'))->andReturn(true);
        Storage::shouldReceive('disk')->with('image-failure')->once()->andReturn($disk);

        try {
            app(ImageUploadService::class)->storeEvidence(
                UploadedFile::fake()->image('proof.jpg', 800, 600),
                'proofs',
                'image-failure',
            );
            $this->fail('A failed storage write must return a retryable error.');
        } catch (HttpException $exception) {
            $this->assertSame(503, $exception->getStatusCode());
        }
    }
}
