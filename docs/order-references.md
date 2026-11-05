# Order reference format

New references use:

```text
FG-{CATEGORY}-{SELLER_CODE}-{PRODUCT_CODE}-{RANDOM_CODE}
```

For example, `FG-SW-S00042-P00127-7C4W2N8J5R3X6BHP` identifies a swine order for seller 42 and listing 127. Seller and listing IDs are left-zero-padded to a **minimum width of five digits** and are never truncated. The listing segment is only a lookup hint: an order can still contain multiple items.

Category codes are stored on each category record and are assigned centrally:

| Category | Code |
| --- | --- |
| Swine / pig | `SW` |
| Carabao | `CA` |
| Cattle | `CT` |
| Goat | `GO` |
| Sheep | `SH` |
| Chicken / poultry | `CH` |
| Duck | `DU` |
| Fish | `FI` |
| Other or unrecognized category | `OT` |
| An order containing multiple category codes | `MX` |

The random suffix is 16 characters from an unambiguous 32-character alphabet, providing 80 bits of entropy. References are unique, generated server-side, and immutable after creation. The structured-reference migration expands the database column and rekeys historical orders using their first retained order item, category, and seller; orders without a usable item/category fall back to `OT` and `P00000`. Previous random references are retained as aliases so printed receipts and QR links continue to resolve to the same privacy-limited public verification response. This data migration is intentionally not reversible because references may already have been shared.
