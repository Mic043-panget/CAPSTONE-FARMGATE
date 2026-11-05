<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class StartDirectChatRequest extends FormRequest
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
            'recipient_id' => ['required', 'integer', 'min:1', 'exists:users,id'],
        ];
    }
}
