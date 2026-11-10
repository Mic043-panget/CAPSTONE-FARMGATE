<?php

namespace App\Http\Controllers\Api;

use App\Enums\Role;
use App\Http\Controllers\Controller;
use App\Models\SellerPayoutPolicy;
use App\Models\SellerPayoutPolicyAcknowledgement;
use App\Services\SellerPayoutPolicyService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Symfony\Component\HttpFoundation\StreamedResponse;
use Throwable;

class SellerPayoutPolicyController extends Controller
{
    public function adminIndex(Request $request, SellerPayoutPolicyService $service): JsonResponse
    {
        $this->admin($request);
        $active = $service->effective();
        $policies = SellerPayoutPolicy::query()
            ->with(['creator:id,name', 'approver:id,name', 'publisher:id,name', 'basedOn:id,version'])
            ->latest('id')
            ->paginate(20);

        $policies->getCollection()->transform(fn (SellerPayoutPolicy $policy): array => [
            ...$this->payload($policy),
            'creator' => $policy->creator ? ['id' => $policy->creator->id, 'name' => $policy->creator->name] : null,
            'approver' => $policy->approver ? ['id' => $policy->approver->id, 'name' => $policy->approver->name] : null,
            'publisher' => $policy->publisher ? ['id' => $policy->publisher->id, 'name' => $policy->publisher->name] : null,
            'is_effective' => $active?->is($policy) ?? false,
            'based_on' => $policy->based_on_policy_id ? [
                'id' => $policy->based_on_policy_id,
                'version' => $policy->basedOn?->version,
                'policy_text' => $policy->basedOn?->policy_text,
            ] : null,
        ]);

        return response()->json(['policies' => $policies, 'effective_policy_id' => $active?->id])
            ->header('Cache-Control', 'private, no-store');
    }

    public function store(Request $request): JsonResponse
    {
        $this->admin($request);
        $data = $request->validate([
            'version' => ['required', 'string', 'max:40', 'regex:/^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/', 'unique:seller_payout_policies,version'],
            'effective_date' => ['required', 'date', 'after_or_equal:today'],
            'policy_text' => ['required', 'string', 'min:100', 'max:50000'],
            'supporting_document' => ['nullable', 'file', 'mimes:pdf,jpg,jpeg,png,webp', 'max:10240'],
        ]);
        [$path, $mime] = $request->hasFile('supporting_document')
            ? $this->storeDocument($request)
            : [null, null];

        try {
            $policy = SellerPayoutPolicy::query()->create([
                'version' => trim($data['version']),
                'effective_date' => $data['effective_date'],
                'policy_text' => trim($data['policy_text']),
                'supporting_document_path' => $path,
                'supporting_document_mime_type' => $mime,
                'status' => 'DRAFT',
                'created_by' => $request->user()->id,
            ]);
        } catch (Throwable $exception) {
            Storage::disk('delivery_proofs')->delete($path);
            throw $exception;
        }

        return response()->json(['message' => 'Seller payout policy saved as a draft.', 'policy' => $this->payload($policy)], 201)
            ->header('Cache-Control', 'private, no-store');
    }

    public function createAmendment(Request $request, SellerPayoutPolicy $basePolicy, SellerPayoutPolicyService $service): JsonResponse
    {
        $this->admin($request);
        abort_unless($basePolicy->status === 'PUBLISHED' && $service->effective()?->is($basePolicy), 409, 'An amendment must be based on the currently effective published policy.');
        $data = $request->validate([
            'version' => ['required', 'string', 'max:40', 'regex:/^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/', 'unique:seller_payout_policies,version'],
            'effective_date' => ['required', 'date', 'after_or_equal:today'],
            'policy_sections' => ['required', 'array:eligibility,calculation,timing,destination_requirements,fees,failed_returned,dispute_corrections'],
            'policy_sections.eligibility' => ['required', 'string', 'max:10000'],
            'policy_sections.calculation' => ['required', 'string', 'max:10000'],
            'policy_sections.timing' => ['required', 'string', 'max:10000'],
            'policy_sections.destination_requirements' => ['required', 'string', 'max:10000'],
            'policy_sections.fees' => ['required', 'string', 'max:10000'],
            'policy_sections.failed_returned' => ['required', 'string', 'max:10000'],
            'policy_sections.dispute_corrections' => ['required', 'string', 'max:10000'],
            'amendment_reason' => ['required', 'string', 'min:12', 'max:500'],
        ]);
        $text = $service->compileCompletePolicy($data['policy_sections']);

        $amendment = DB::transaction(function () use ($request, $basePolicy, $data, $text): SellerPayoutPolicy {
            $base = SellerPayoutPolicy::query()->lockForUpdate()->findOrFail($basePolicy->id);
            abort_unless(
                $base->status === 'PUBLISHED' && app(SellerPayoutPolicyService::class)->effective()?->is($base),
                409,
                'An amendment must be based on the currently effective published policy.',
            );

            return SellerPayoutPolicy::query()->create([
                'version' => trim($data['version']),
                'effective_date' => $data['effective_date'],
                'policy_text' => $text,
                'status' => 'DRAFT',
                'created_by' => $request->user()->id,
                'based_on_policy_id' => $base->id,
                'amendment_reason' => trim($data['amendment_reason']),
            ]);
        });

        $request->merge(['reason' => trim($data['amendment_reason'])]);

        return response()->json([
            'message' => 'Versioned payout policy amendment saved as a draft. The prior published policy remains unchanged.',
            'policy' => $this->payload($amendment->load('basedOn')),
        ], 201)->header('Cache-Control', 'private, no-store');
    }

    public function update(Request $request, SellerPayoutPolicy $policy): JsonResponse
    {
        $this->admin($request);
        abort_unless($policy->status === 'DRAFT', 409, 'Only a draft seller payout policy can be edited.');
        $data = $request->validate([
            'version' => ['required', 'string', 'max:40', 'regex:/^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/', Rule::unique('seller_payout_policies', 'version')->ignore($policy->id)],
            'effective_date' => ['required', 'date', 'after_or_equal:today'],
            'policy_text' => ['required', 'string', 'min:100', 'max:50000'],
            'supporting_document' => ['nullable', 'file', 'mimes:pdf,jpg,jpeg,png,webp', 'max:10240'],
        ]);
        $oldPath = $policy->supporting_document_path;
        $newDocument = $request->hasFile('supporting_document') ? $this->storeDocument($request) : null;

        try {
            DB::transaction(function () use ($policy, $data, $newDocument): void {
                $locked = SellerPayoutPolicy::query()->lockForUpdate()->findOrFail($policy->id);
                abort_unless($locked->status === 'DRAFT', 409, 'Only a draft seller payout policy can be edited.');
                $locked->fill([
                    'version' => trim($data['version']),
                    'effective_date' => $data['effective_date'],
                    'policy_text' => trim($data['policy_text']),
                ]);
                if ($newDocument) {
                    $locked->supporting_document_path = $newDocument[0];
                    $locked->supporting_document_mime_type = $newDocument[1];
                }
                $locked->save();
            });
        } catch (Throwable $exception) {
            if ($newDocument) {
                Storage::disk('delivery_proofs')->delete($newDocument[0]);
            }
            throw $exception;
        }

        if ($newDocument && $oldPath) {
            Storage::disk('delivery_proofs')->delete($oldPath);
        }

        return response()->json(['message' => 'Seller payout policy draft updated.', 'policy' => $this->payload($policy->fresh())])
            ->header('Cache-Control', 'private, no-store');
    }

    public function approve(Request $request, SellerPayoutPolicy $policy): JsonResponse
    {
        $this->admin($request);
        $data = $request->validate([
            'reason' => ['required', 'string', 'min:12', 'max:500'],
            'policy_sections' => ['required', 'array:eligibility,calculation,timing,destination_requirements,fees,failed_returned,dispute_corrections'],
            'policy_sections.eligibility' => ['required', 'string', 'max:10000'],
            'policy_sections.calculation' => ['required', 'string', 'max:10000'],
            'policy_sections.timing' => ['required', 'string', 'max:10000'],
            'policy_sections.destination_requirements' => ['required', 'string', 'max:10000'],
            'policy_sections.fees' => ['required', 'string', 'max:10000'],
            'policy_sections.failed_returned' => ['required', 'string', 'max:10000'],
            'policy_sections.dispute_corrections' => ['required', 'string', 'max:10000'],
            'confirmed_actual_terms' => ['required', 'accepted'],
        ]);
        $policyText = app(SellerPayoutPolicyService::class)->compileCompletePolicy($data['policy_sections']);
        DB::transaction(function () use ($request, $policy, $data, $policyText): void {
            $locked = SellerPayoutPolicy::query()->lockForUpdate()->findOrFail($policy->id);
            abort_unless($locked->status === 'DRAFT', 409, 'Only a draft payout policy can be approved.');
            abort_unless($locked->effective_date?->gte(today()), 422, 'The effective date must be today or later.');
            abort_unless(
                $this->normalizePolicyText($locked->policy_text) === $this->normalizePolicyText($policyText),
                409,
                'The reviewed policy text differs from the saved draft. Edit and save the complete policy sections before approval.',
            );
            $locked->forceFill([
                'status' => 'APPROVED',
                'approved_by' => $request->user()->id,
                'approved_at' => now(),
                'approval_reason' => trim($data['reason']),
            ])->save();
            $request->merge(['reason' => trim($data['reason'])]);
        });

        return response()->json(['message' => 'Complete seller payout policy approved.', 'policy' => $this->payload($policy->fresh())])
            ->header('Cache-Control', 'private, no-store');
    }

    public function publish(Request $request, SellerPayoutPolicy $policy): JsonResponse
    {
        $this->admin($request);
        $data = $request->validate([
            'reason' => ['required', 'string', 'min:12', 'max:500'],
            'policy_sections' => ['required', 'array:eligibility,calculation,timing,destination_requirements,fees,failed_returned,dispute_corrections'],
            'policy_sections.eligibility' => ['required', 'string', 'max:10000'],
            'policy_sections.calculation' => ['required', 'string', 'max:10000'],
            'policy_sections.timing' => ['required', 'string', 'max:10000'],
            'policy_sections.destination_requirements' => ['required', 'string', 'max:10000'],
            'policy_sections.fees' => ['required', 'string', 'max:10000'],
            'policy_sections.failed_returned' => ['required', 'string', 'max:10000'],
            'policy_sections.dispute_corrections' => ['required', 'string', 'max:10000'],
            'confirmed_actual_terms' => ['required', 'accepted'],
        ]);
        $policyText = app(SellerPayoutPolicyService::class)->compileCompletePolicy($data['policy_sections']);
        DB::transaction(function () use ($request, $policy, $data, $policyText): void {
            $locked = SellerPayoutPolicy::query()->lockForUpdate()->findOrFail($policy->id);
            abort_unless($locked->status === 'APPROVED', 409, 'An authorized admin must approve the complete amendment before publication.');
            abort_unless($locked->effective_date?->gte(today()), 422, 'The effective date must be today or later.');
            abort_unless(
                $this->normalizePolicyText($locked->policy_text) === $this->normalizePolicyText($policyText),
                409,
                'Approved policy content is immutable. Create a new draft to update its terms.',
            );
            if ($locked->based_on_policy_id) {
                abort_unless(
                    app(SellerPayoutPolicyService::class)->effective()?->getKey() === $locked->based_on_policy_id,
                    409,
                    'The source policy is no longer effective. Create a new amendment from the current published version.',
                );
            }
            $locked->forceFill([
                'status' => 'PUBLISHED',
                'published_by' => $request->user()->id,
                'published_at' => now(),
                'publication_reason' => trim($data['reason']),
            ])->save();
            $request->merge(['reason' => trim($data['reason'])]);
        });

        return response()->json(['message' => 'Complete seller payout policy published and effective on its stated date.', 'policy' => $this->payload($policy->fresh())])
            ->header('Cache-Control', 'private, no-store');
    }

    public function sellerCurrent(Request $request, SellerPayoutPolicyService $service): JsonResponse
    {
        abort_unless($request->user()?->role === Role::SELLER, 403);
        $policy = $service->effective();
        $acknowledgement = $policy ? SellerPayoutPolicyAcknowledgement::query()
            ->where('seller_id', $request->user()->id)
            ->where('seller_payout_policy_id', $policy->id)
            ->first() : null;

        return response()->json([
            'policy' => $policy ? [
                ...$this->payload($policy),
                'supporting_document_url' => filled($policy->supporting_document_path)
                    ? route('seller-payout-policies.document', $policy)
                    : null,
                'acknowledged' => $acknowledgement !== null,
                'acknowledged_at' => $acknowledgement?->acknowledged_at?->toISOString(),
            ] : null,
            'status_message' => $policy ? null : 'Seller payout setup is unavailable until Farmgate publishes an effective seller payout policy.',
        ])->header('Cache-Control', 'private, no-store');
    }

    public function acknowledge(Request $request, SellerPayoutPolicy $policy, SellerPayoutPolicyService $service): JsonResponse
    {
        abort_unless($request->user()?->role === Role::SELLER, 403);
        $data = $request->validate(['acknowledged' => ['required', 'accepted']]);
        $acknowledgement = $service->acknowledge($request->user(), $policy);
        $request->merge(['acknowledged' => true, 'policy_version' => $policy->version]);

        return response()->json([
            'message' => 'Seller payout policy acknowledgment recorded.',
            'policy_id' => $policy->id,
            'version' => $policy->version,
            'acknowledged_at' => $acknowledgement->acknowledged_at->toISOString(),
        ])->header('Cache-Control', 'private, no-store');
    }

    public function document(Request $request, SellerPayoutPolicy $policy): StreamedResponse
    {
        $user = $request->user();
        abort_unless($user && ($user->role === Role::ADMIN || $user->role === Role::SELLER && app(SellerPayoutPolicyService::class)->effective()?->is($policy)), 403);
        $disk = Storage::disk('delivery_proofs');
        abort_unless(filled($policy->supporting_document_path) && $disk->exists($policy->supporting_document_path), 404, 'Supporting payout policy document is unavailable.');

        return response()->stream(function () use ($disk, $policy): void {
            $stream = $disk->readStream($policy->supporting_document_path);
            if (! is_resource($stream)) {
                throw new \RuntimeException('The private payout policy document could not be opened.');
            }
            try {
                fpassthru($stream);
            } finally {
                fclose($stream);
            }
        }, 200, [
            'Content-Type' => $policy->supporting_document_mime_type ?? 'application/octet-stream',
            'Content-Disposition' => 'inline; filename="seller-payout-policy-document"',
            'Cache-Control' => 'private, no-store',
            'X-Content-Type-Options' => 'nosniff',
            'X-Frame-Options' => 'DENY',
        ]);
    }

    private function payload(SellerPayoutPolicy $policy): array
    {
        return [
            'id' => $policy->id,
            'version' => $policy->version,
            'effective_date' => $policy->effective_date?->toDateString(),
            'policy_text' => $policy->policy_text,
            'status' => $policy->status,
            'based_on' => $policy->based_on_policy_id && $policy->relationLoaded('basedOn') ? [
                'id' => $policy->based_on_policy_id,
                'version' => $policy->basedOn?->version,
                'policy_text' => $policy->basedOn?->policy_text,
            ] : null,
            'has_supporting_document' => filled($policy->supporting_document_path),
            'supporting_document_url' => filled($policy->supporting_document_path)
                ? route('admin-seller-payout-policies.document', $policy)
                : null,
            'created_at' => $policy->created_at?->toISOString(),
            'approved_at' => $policy->approved_at?->toISOString(),
            'published_at' => $policy->published_at?->toISOString(),
            'approval_reason' => $policy->approval_reason,
            'publication_reason' => $policy->publication_reason,
            'amendment_reason' => $policy->amendment_reason,
        ];
    }

    /**
     * @return array{0: string, 1: string}
     */
    private function storeDocument(Request $request): array
    {
        $file = $request->file('supporting_document');
        $extension = $file->guessExtension();
        abort_if(! $extension, 422, 'The supporting document type could not be identified.');
        $path = 'seller-payout-policies/'.Str::random(40).'.'.$extension;
        $storedPath = $file->storeAs('seller-payout-policies', basename($path), 'delivery_proofs');
        abort_unless($storedPath === $path && Storage::disk('delivery_proofs')->exists($path), 500, 'The supporting policy document could not be securely stored.');

        return [$path, $file->getMimeType() ?? 'application/octet-stream'];
    }

    private function admin(Request $request): void
    {
        abort_unless($request->user()?->role === Role::ADMIN, 403);
    }

    private function normalizePolicyText(string $text): string
    {
        return str_replace(["\r\n", "\r"], "\n", trim($text));
    }
}
