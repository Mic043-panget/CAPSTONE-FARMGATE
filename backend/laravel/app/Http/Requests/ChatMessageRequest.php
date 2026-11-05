<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Validator;
use App\Enums\Role;

class ChatMessageRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user() !== null;
    }

    /**
     * @return array<string, array<int, mixed>>
     */
    public function rules(): array
    {
        return [
            'conversation_id' => ['nullable', 'integer', 'min:1'],
            'message' => ['required', 'string', 'max:2000'],
            'report' => ['sometimes', 'nullable', 'array:type,from,to,status,search,order_status,payment_status,payment_method,role,account_status,complaint_type,resolution_status,amount_min,amount_max,category_id,listing_id,seller_id'],
            'clear_report_context' => ['sometimes', 'boolean'],
            'report.type' => ['required_with:report', 'string', 'in:sales,transactions,listings,users,sellers,buyers,riders,categories,deliveries,complaints'],
            'report.from' => ['nullable', 'date_format:Y-m-d'],
            'report.to' => ['nullable', 'date_format:Y-m-d', 'after_or_equal:report.from'],
            'report.status' => ['nullable', 'string', 'max:40'],
            'report.search' => ['nullable', 'string', 'max:100'],
            'report.order_status' => ['nullable', 'string', 'in:PENDING_CONFIRMATION,CONFIRMED,PREPARING,READY_FOR_PICKUP,FULFILLING,COMPLETED,CANCELLED,REJECTED'],
            'report.payment_status' => ['nullable', 'string', 'in:PENDING,PAID,UNPAID,FAILED'],
            'report.payment_method' => ['nullable', 'string', 'in:COD,GCASH,CARD,GOOGLE_PAY'],
            'report.role' => ['nullable', 'string', 'in:ADMIN,SELLER,BUYER,RIDER'],
            'report.account_status' => ['nullable', 'string', 'in:VERIFIED,UNVERIFIED'],
            'report.complaint_type' => ['nullable', 'string', 'max:120'],
            'report.resolution_status' => ['nullable', 'string', 'in:RESOLVED,UNRESOLVED'],
            'report.amount_min' => ['nullable', 'numeric', 'min:0', 'max:9999999999.99'],
            'report.amount_max' => ['nullable', 'numeric', 'min:0', 'max:9999999999.99'],
            'report.category_id' => ['nullable', 'integer', 'min:1'],
            'report.listing_id' => ['nullable', 'integer', 'min:1'],
            'report.seller_id' => ['nullable', 'integer', 'min:1'],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator): void {
            $minimum = $this->input('report.amount_min');
            $maximum = $this->input('report.amount_max');
            if ($minimum !== null && $maximum !== null && (float) $minimum > (float) $maximum) {
                $validator->errors()->add('report.amount_max', 'The maximum amount must be at least the minimum amount.');
            }
            if ($this->filled('report.seller_id') && $this->user()?->role !== Role::ADMIN) {
                $validator->errors()->add('report.seller_id', 'Only administrators can filter reports by seller.');
            }
        });
    }
}
