<?php

namespace App\Http\Controllers\Api;

use App\Enums\Role;
use App\Http\Controllers\Controller;
use App\Models\Category;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

class CategoryController extends Controller
{
    public function index(): JsonResponse
    {
        return response()->json(['categories' => Category::query()->where('is_active', true)->orderBy('name')->get()]);
    }

    public function store(Request $request): JsonResponse
    {
        abort_unless($request->user()?->role === Role::ADMIN, 403);

        $data = $request->validate(['name' => ['required', 'string', 'max:120', 'unique:categories,name']]);
        $category = Category::create(['name' => $data['name'], 'slug' => Str::slug($data['name'])]);

        return response()->json(['category' => $category], 201);
    }
}