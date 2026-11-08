export type UserRole = 'ADMIN' | 'SELLER' | 'BUYER' | 'RIDER';

export type User = {
    id?: number;
    name: string;
    username?: string;
    email: string;
    role: UserRole;
    phone_number?: string | null;
    phone_verified_at?: string | null;
    email_verified_at?: string | null;
    created_at?: string | null;
    profile_photo_url?: string | null;
    rider_profile?: {
        is_verified: boolean;
        availability?: 'AVAILABLE' | 'OFFLINE';
        vehicle_type?: string | null;
        plate_number?: string | null;
        vehicle_make_model?: string | null;
        vehicle_color?: string | null;
    } | null;
};

export type Category = { id: number; name: string; slug: string };

export type Listing = {
    id: number;
    name: string;
    breed?: string;
    pricing_type: 'PER_KILO' | 'PER_HEAD';
    price_per_kilo?: string;
    price_per_head?: string;
    original_price?: string;
    current_price?: string;
    promotion?: {
        id: number;
        name: string;
        description?: string | null;
        image_url?: string | null;
        discount_type: 'PERCENTAGE' | 'FIXED';
        discount_value: string;
        ends_at: string;
    } | null;
    estimated_weight_kg?: string;
    quantity: number;
    category: Category;
    seller: { id: number; name: string };
    images: { url: string; alt_text?: string }[];
};

export type ReportRow = Record<string, any>;

export type ReportResponse = {
    report: string;
    timezone?: string;
    proof_summary?: { with_proof: number; delivered_without_proof: number } | null;
    data: { data: ReportRow[]; total: number; last_page: number };
};
