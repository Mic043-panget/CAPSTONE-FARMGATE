export type SellerPickupLocation = {
    latitude: number | null;
    longitude: number | null;
    pickup_location_confirmed: boolean;
};

export function hasValidPickupCoordinates(latitude: number | null, longitude: number | null): boolean {
    return typeof latitude === 'number'
        && Number.isFinite(latitude)
        && latitude >= -90
        && latitude <= 90
        && typeof longitude === 'number'
        && Number.isFinite(longitude)
        && longitude >= -180
        && longitude <= 180
        && !(latitude === 0 && longitude === 0);
}

export function hasValidSavedPickupLocation(profile: SellerPickupLocation): boolean {
    return profile.pickup_location_confirmed
        && hasValidPickupCoordinates(profile.latitude, profile.longitude);
}
