<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\AiListingSearchService;
use App\Services\Chat\ChatProviderException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class AiListingSearchController extends Controller
{
    public function __invoke(Request $request, AiListingSearchService $search): JsonResponse
    {
        $data = $request->validate([
            'query' => ['required', 'string', 'min:3', 'max:120'],
        ]);

        try {
            $filters = $search->interpret(trim($data['query']));
        } catch (ChatProviderException) {
            return response()->json([
                'message' => "AI search is temporarily unavailable. We're showing regular listing matches from your search words instead.",
            ], 503);
        }

        return response()->json([
            'filters' => $filters,
        ]);
    }
}
