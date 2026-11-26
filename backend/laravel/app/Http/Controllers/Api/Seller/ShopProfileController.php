<?php

namespace App\Http\Controllers\Api\Seller;

use App\Enums\Role;
use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\SellerIdentityDocument;
use App\Models\SellerProfile;
use App\Models\User;
use App\Notifications\SellerVerificationStatusNotification;
use App\Rules\ValidFarmgateImage;
use App\Services\ImageUploadService;
use App\Support\FarmgateImage;
use Illuminate\Contracts\Encryption\DecryptException;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\URL;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class ShopProfileController extends Controller
{
    public function show(Request $request): JsonResponse
    {
        $seller = $request->user();
        abort_unless($seller?->role === Role::SELLER, 403);

        $profile = $seller->sellerProfile()->firstOrCreate([]);

        return response()->json(['profile' => $this->sellerPayload($profile)]);
    }

    public function update(Request $request): JsonResponse
    {
        $seller = $request->user();
        abort_unless($seller?->role === Role::SELLER, 403);

        $data = $request->validate([
            'shop_name' => ['required', 'string', 'min:2', 'max:120'],
            'shop_image' => [
                'nullable',
                'image',
                'mimes:jpeg,jpg,png,webp',
                'max:10240',
                'dimensions:min_width=256,min_height=256',
                new ValidFarmgateImage,
            ],
        ]);
        $profile = $seller->sellerProfile()->firstOrCreate([]);
        $previousImage = $profile->shop_image_path;
        $newImage = null;

        if ($request->hasFile('shop_image')) {
            $newImage = app(ImageUploadService::class)->storeOptimized($request->file('shop_image'), 'seller-shops', 'public');
            if (! is_string($newImage) || $newImage === '') {
                throw new \RuntimeException('The shop image could not be stored.');
            }
        }

        try {
            $profile->forceFill([
                'shop_name' => trim($data['shop_name']),
                ...($newImage !== null ? ['shop_image_path' => $newImage] : []),
            ])->save();
        } catch (\Throwable $exception) {
            if ($newImage !== null && Storage::disk('public')->exists($newImage)) {
                Storage::disk('public')->delete($newImage);
            }
            throw $exception;
        }

        if ($newImage !== null && $previousImage && $previousImage !== $newImage
            && Storage::disk('public')->exists($previousImage)
            && ! Storage::disk('public')->delete($previousImage)) {
            report(new \RuntimeException('A replaced public seller shop image could not be removed.'));
        }

        return response()->json(['profile' => $this->sellerPayload($profile->fresh())]);
    }

    public function submitVerification(Request $request): JsonResponse
    {
        $seller = $request->user();
        abort_unless($seller?->role === Role::SELLER, 403);

        $data = $request->validate([
            'identity_document' => ['required', 'file', 'mimes:jpeg,jpg,png,webp,pdf', 'max:10240', new ValidFarmgateImage(['application/pdf'], 8 * 1024 * 1024)],
        ]);
        $file = $data['identity_document'];
        if (str_starts_with((string) $file->getMimeType(), 'image/')) {
            $dimensions = @getimagesize($file->getRealPath());
            if (! $dimensions || min($dimensions[0], $dimensions[1]) < 360) {
                throw ValidationException::withMessages([
                    'identity_document' => 'Use a clear identity document image between 360 and 16384 pixels on each side.',
                ]);
            }
        }

        $isImage = FarmgateImage::isImage($file);
        $contents = $isImage
            ? app(ImageUploadService::class)->encode($file, 2560, 94)
            : file_get_contents($file->getRealPath());
        if (! is_string($contents)) {
            throw new \RuntimeException('The identity document could not be read.');
        }
        $mimeType = $isImage ? 'image/webp' : ($file->getMimeType() ?: 'application/octet-stream');

        $path = 'seller/'.$seller->id.'/identity/'.Str::uuid().'.enc';
        $disk = Storage::disk('rider_private');
        if (! $disk->put($path, Crypt::encryptString($contents))) {
            if ($disk->exists($path) && ! $disk->delete($path)) {
                report(new \RuntimeException('A partially written seller identity document remains in private storage.'));
            }
            abort(503, 'The encrypted identity document could not be stored. Please retry.');
        }

        try {
            [$profile, $previousPath] = DB::transaction(function () use ($request, $seller, $path, $mimeType, $contents): array {
                $profile = $seller->sellerProfile()->firstOrCreate([]);
                $profile = SellerProfile::query()
                    ->whereKey($profile->getKey())
                    ->lockForUpdate()
                    ->firstOrFail();
                $document = SellerIdentityDocument::query()
                    ->where('seller_profile_id', $profile->id)
                    ->lockForUpdate()
                    ->first();
                $previousPath = $document?->encrypted_path;
                $now = now();

                if ($document) {
                    $document->forceFill([
                        'encrypted_path' => $path,
                        'mime_type' => $mimeType,
                        'size' => strlen($contents),
                        'uploaded_at' => $now,
                    ])->save();
                } else {
                    SellerIdentityDocument::query()->create([
                        'seller_profile_id' => $profile->id,
                        'encrypted_path' => $path,
                        'mime_type' => $mimeType,
                        'size' => strlen($contents),
                        'uploaded_at' => $now,
                    ]);
                }

                $fromStatus = $profile->verification_status;
                $profile->forceFill([
                    'verification_status' => 'PENDING',
                    'verification_rejection_reason' => null,
                    'verification_submitted_at' => $now,
                    'verification_reviewed_at' => null,
                    'verification_reviewer_id' => null,
                    'is_verified' => false,
                ])->save();

                AuditLog::query()->create([
                    'user_id' => $seller->id,
                    'action' => 'seller.identity.submitted',
                    'method' => $request->method(),
                    'route' => $request->path(),
                    'status_code' => 201,
                    'entity_type' => 'SELLER_PROFILE',
                    'entity_id' => (string) $profile->id,
                    'description' => 'Seller identity verification was submitted for review.',
                    'before_values' => ['verification_status' => $fromStatus],
                    'after_values' => ['verification_status' => 'PENDING'],
                    'changed_fields' => [['field' => 'verification_status', 'old' => $fromStatus, 'new' => 'PENDING']],
                ]);

                $seller->notify(new SellerVerificationStatusNotification('PENDING', $now->toISOString()));

                return [$profile->fresh(), $previousPath];
            });
        } catch (\Throwable $exception) {
            try {
                foreach ([$path, $path.'.preview'] as $partialPath) {
                    if ($disk->exists($partialPath) && ! $disk->delete($partialPath)) {
                        report(new \RuntimeException('A failed seller identity document upload remains in private storage.'));
                    }
                }
            } catch (\Throwable $cleanupException) {
                report($cleanupException);
            }

            throw $exception;
        }

        if ($previousPath && $previousPath !== $path) {
            foreach ([$previousPath, $previousPath.'.preview'] as $oldPath) {
                if ($disk->exists($oldPath) && ! $disk->delete($oldPath)) {
                    report(new \RuntimeException('A replaced seller identity document could not be removed from private storage.'));
                }
            }
        }

        return response()->json(['profile' => $this->sellerPayload($profile)], 201);
    }

    public function adminIndex(Request $request): JsonResponse
    {
        abort_unless($request->user()?->role === Role::ADMIN, 403);
        $filters = $request->validate([
            'status' => ['nullable', Rule::in(['ALL', 'NOT_SUBMITTED', 'PENDING', 'VERIFIED', 'REJECTED'])],
            'search' => ['nullable', 'string', 'max:120'],
            'page' => ['nullable', 'integer', 'min:1'],
        ]);
        $query = SellerProfile::query()
            ->with('user:id,name')
            ->whereHas('user', fn (Builder $users) => $users->where('role', Role::SELLER));
        if (($filters['status'] ?? 'PENDING') !== 'ALL') {
            $query->where('verification_status', $filters['status'] ?? 'PENDING');
        }
        if (filled($filters['search'] ?? null)) {
            $term = '%'.trim($filters['search']).'%';
            $query->where(function (Builder $profiles) use ($term): void {
                $profiles->where('shop_name', 'like', $term)
                    ->orWhere('business_name', 'like', $term)
                    ->orWhereHas('user', fn (Builder $users) => $users->where('name', 'like', $term));
            });
        }

        $sellers = $query->orderByDesc('verification_submitted_at')->orderByDesc('id')
            ->paginate(15)
            ->withQueryString();
        $sellers->getCollection()->transform(fn (SellerProfile $profile): array => [
            'id' => $profile->user_id,
            'name' => $profile->user?->name ?? 'Seller',
            'shop_name' => $profile->shop_name,
            'verification_status' => $profile->verification_status,
            'submitted_at' => $profile->verification_submitted_at?->toIso8601String(),
            'reviewed_at' => $profile->verification_reviewed_at?->toIso8601String(),
        ]);

        return response()->json(['sellers' => $sellers]);
    }

    public function adminShow(Request $request, User $seller): JsonResponse
    {
        abort_unless($request->user()?->role === Role::ADMIN, 403);
        abort_unless($seller->role === Role::SELLER, 404);
        $profile = $seller->sellerProfile()->with('identityDocument')->firstOrFail();

        return response()->json(['seller' => $this->adminPayload($seller, $profile, $request->user())]);
    }

    public function adminMarkDocumentReviewed(Request $request, User $seller): JsonResponse
    {
        abort_unless($request->user()?->role === Role::ADMIN, 403);
        abort_unless($seller->role === Role::SELLER, 404);
        $profile = DB::transaction(function () use ($request, $seller): SellerProfile {
            $profile = SellerProfile::query()->where('user_id', $seller->id)->lockForUpdate()->firstOrFail();
            $document = $profile->identityDocument()->firstOrFail();
            $viewed = AuditLog::query()
                ->where('user_id', $request->user()->id)
                ->where('entity_type', 'SELLER_PROFILE')
                ->where('entity_id', (string) $profile->id)
                ->where('action', 'seller.identity.document_viewed')
                ->where('metadata->document_id', $document->id)
                ->where('created_at', '>=', $document->uploaded_at)
                ->exists();
            abort_unless($viewed, 409, 'Open the private document before confirming that you reviewed it.');

            AuditLog::query()->create([
                'user_id' => $request->user()->id,
                'action' => 'seller.identity.document_reviewed',
                'method' => $request->method(),
                'route' => $request->path(),
                'status_code' => 200,
                'entity_type' => 'SELLER_PROFILE',
                'entity_id' => (string) $profile->id,
                'description' => 'Admin confirmed review of the protected seller identity document.',
                'metadata' => ['document_id' => $document->id],
            ]);

            return $profile->load('identityDocument');
        });

        return response()->json(['seller' => $this->adminPayload($seller, $profile, $request->user())]);
    }

    public function adminDecision(Request $request, User $seller): JsonResponse
    {
        abort_unless($request->user()?->role === Role::ADMIN, 403);
        abort_unless($seller->role === Role::SELLER, 404);
        $data = $request->validate([
            'status' => ['required', Rule::in(['VERIFIED', 'REJECTED'])],
            'rejection_reason' => ['nullable', 'string', 'min:8', 'max:255', 'required_if:status,REJECTED'],
        ]);
        if ($data['status'] === 'REJECTED') {
            $data['rejection_reason'] = $this->safeRejectionReason($data['rejection_reason']);
            if (mb_strlen($data['rejection_reason']) < 8) {
                throw ValidationException::withMessages([
                    'rejection_reason' => 'Provide a clear reason of at least 8 characters without sensitive identity numbers.',
                ]);
            }
        }

        $updated = DB::transaction(function () use ($request, $seller, $data): SellerProfile {
            $profile = SellerProfile::query()->where('user_id', $seller->id)->lockForUpdate()->firstOrFail();
            abort_unless($profile->verification_status === 'PENDING', 409, 'Only a pending seller verification can be reviewed.');
            $document = $profile->identityDocument()->first();
            abort_unless($document, 409, 'A submitted identity document is required before review.');
            $documentReviewed = AuditLog::query()
                ->where('user_id', $request->user()->id)
                ->where('entity_type', 'SELLER_PROFILE')
                ->where('entity_id', (string) $profile->id)
                ->where('action', 'seller.identity.document_reviewed')
                ->where('metadata->document_id', $document->id)
                ->where('created_at', '>=', $document->uploaded_at)
                ->exists();
            abort_unless($documentReviewed, 409, 'Open and confirm review of the identity document before recording a decision.');

            $fromStatus = $profile->verification_status;
            $now = now();
            $profile->forceFill([
                'verification_status' => $data['status'],
                'verification_rejection_reason' => $data['status'] === 'REJECTED' ? trim($data['rejection_reason']) : null,
                'verification_reviewed_at' => $now,
                'verification_reviewer_id' => $request->user()->id,
                'is_verified' => $data['status'] === 'VERIFIED',
            ])->save();

            AuditLog::query()->create([
                'user_id' => $request->user()->id,
                'action' => $data['status'] === 'VERIFIED' ? 'seller.identity.approved' : 'seller.identity.rejected',
                'method' => $request->method(),
                'route' => $request->path(),
                'status_code' => 200,
                'entity_type' => 'SELLER_PROFILE',
                'entity_id' => (string) $profile->id,
                'description' => $data['status'] === 'VERIFIED'
                    ? 'Admin approved seller identity verification.'
                    : 'Admin rejected seller identity verification.',
                'before_values' => ['verification_status' => $fromStatus],
                'after_values' => ['verification_status' => $data['status']],
                'changed_fields' => [['field' => 'verification_status', 'old' => $fromStatus, 'new' => $data['status']]],
            ]);

            $seller->notify(new SellerVerificationStatusNotification($data['status'], $now->toISOString()));

            return $profile->fresh();
        });

        return response()->json(['seller' => $this->adminPayload($seller, $updated, $request->user())]);
    }

    public function adminDocument(Request $request, User $seller): Response
    {
        abort_unless($request->user()?->role === Role::ADMIN, 403);
        abort_unless($seller->role === Role::SELLER, 404);
        $profile = $seller->sellerProfile()->with('identityDocument')->firstOrFail();
        $document = $profile->identityDocument;
        abort_unless($document, 404);

        $disk = Storage::disk('rider_private');
        abort_unless($disk->exists($document->encrypted_path), 404, 'The requested identity document could not be found.');
        try {
            $contents = Crypt::decryptString($disk->get($document->encrypted_path));
        } catch (DecryptException $exception) {
            report($exception);
            abort(500, 'The requested identity document could not be decrypted.');
        }

        AuditLog::query()->create([
            'user_id' => $request->user()->id,
            'action' => 'seller.identity.document_viewed',
            'method' => $request->method(),
            'route' => $request->path(),
            'status_code' => 200,
            'entity_type' => 'SELLER_PROFILE',
            'entity_id' => (string) $profile->id,
            'description' => 'Admin accessed the protected seller identity document.',
            'metadata' => ['document_id' => $document->id],
        ]);

        return response($contents, 200, [
            'Content-Type' => $document->mime_type,
            'Content-Disposition' => 'inline; filename="seller-identity-document"',
            'Cache-Control' => 'private, no-store',
            'X-Content-Type-Options' => 'nosniff',
        ]);
    }

    private function sellerPayload(SellerProfile $profile): array
    {
        return [
            'shop_name' => $profile->shop_name,
            'business_name' => $profile->business_name,
            'shop_image_url' => $profile->shop_image_path ? Storage::disk('public')->url($profile->shop_image_path) : null,
            'verification_status' => $profile->verification_status,
            'verification_rejection_reason' => $profile->verification_rejection_reason,
            'verification_submitted_at' => $profile->verification_submitted_at?->toIso8601String(),
            'verification_reviewed_at' => $profile->verification_reviewed_at?->toIso8601String(),
        ];
    }

    private function adminPayload(User $seller, SellerProfile $profile, User $reviewer): array
    {
        $document = $profile->identityDocument;

        return [
            'id' => $seller->id,
            'name' => $seller->name,
            'shop_name' => $profile->shop_name,
            'business_name' => $profile->business_name,
            'verification_status' => $profile->verification_status,
            'verification_rejection_reason' => $profile->verification_rejection_reason,
            'submitted_at' => $profile->verification_submitted_at?->toIso8601String(),
            'reviewed_at' => $profile->verification_reviewed_at?->toIso8601String(),
            'document' => $document ? [
                'mime_type' => $document->mime_type,
                'size' => $document->size,
                'uploaded_at' => $document->uploaded_at?->toIso8601String(),
                'viewed_by_current_admin' => AuditLog::query()
                    ->where('user_id', $reviewer->id)
                    ->where('entity_type', 'SELLER_PROFILE')
                    ->where('entity_id', (string) $profile->id)
                    ->where('action', 'seller.identity.document_viewed')
                    ->where('metadata->document_id', $document->id)
                    ->where('created_at', '>=', $document->uploaded_at)
                    ->exists(),
                'reviewed_by_current_admin' => AuditLog::query()
                    ->where('user_id', $reviewer->id)
                    ->where('entity_type', 'SELLER_PROFILE')
                    ->where('entity_id', (string) $profile->id)
                    ->where('action', 'seller.identity.document_reviewed')
                    ->where('metadata->document_id', $document->id)
                    ->where('created_at', '>=', $document->uploaded_at)
                    ->exists(),
                'view_url' => URL::temporarySignedRoute(
                    'admin.seller-verification-document',
                    now()->addMinutes(5),
                    ['seller' => $seller->id],
                ),
            ] : null,
            'audit_history' => AuditLog::query()
                ->with('actor:id,name')
                ->where('entity_type', 'SELLER_PROFILE')
                ->where('entity_id', (string) $profile->id)
                ->where('action', 'like', 'seller.identity.%')
                ->latest()
                ->limit(20)
                ->get()
                ->map(fn (AuditLog $log): array => [
                    'action' => $log->action,
                    'description' => $log->description,
                    'actor' => $log->actor?->name ?? 'System',
                    'created_at' => $log->created_at?->toIso8601String(),
                ])
                ->values(),
        ];
    }

    private function safeRejectionReason(string $reason): string
    {
        $reason = trim(strip_tags($reason));
        $reason = preg_replace('/(?<!\d)(?:\d[ -]?){4,}\d(?!\d)/u', '[redacted]', $reason) ?? $reason;

        return mb_substr($reason, 0, 255);
    }
}
