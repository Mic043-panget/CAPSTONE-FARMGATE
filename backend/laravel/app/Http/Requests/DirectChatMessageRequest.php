<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class DirectChatMessageRequest extends FormRequest
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
            'message' => ['required', 'string', 'max:2000'],
            'client_message_id' => ['required', 'uuid'],
            'order_id' => ['sometimes', 'integer', 'min:1'],
        ];
    }
}
