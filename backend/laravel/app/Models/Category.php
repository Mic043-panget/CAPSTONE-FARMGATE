<?php

namespace App\Models;

use App\Support\CategoryReferenceCode;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use LogicException;

class Category extends Model
{
    use HasFactory, \Illuminate\Database\Eloquent\SoftDeletes;

    protected $fillable = ['name', 'slug', 'is_active'];

    protected static function booted(): void
    {
        static::creating(function (Category $category): void {
            if (blank($category->reference_code)) {
                $category->reference_code = CategoryReferenceCode::forSlugAndName($category->slug, $category->name);
            }
        });

        static::updating(function (Category $category): void {
            if ($category->isDirty('reference_code')) {
                throw new LogicException('A category reference code cannot be changed after creation.');
            }
        });
    }

    protected function casts(): array
    {
        return ['is_active' => 'boolean'];
    }

    public function listings(): HasMany
    {
        return $this->hasMany(LivestockListing::class);
    }
}
