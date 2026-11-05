import api, { initializeCsrf } from '../../lib/api';
import { showSuccess } from '../../lib/alerts';

type InterestButtonProps = {
    listingId: number;
    interested: boolean;
    onChange: (interested: boolean) => void;
    onError: (message: string) => void;
};

export function InterestButton({ listingId, interested, onChange, onError }: InterestButtonProps) {
    async function toggleInterest() {
        try {
            await initializeCsrf();
            const response = await api.post<{ interested: boolean }>(`/api/listings/${listingId}/interest`);
            onChange(response.data.interested);
            showSuccess(response.data.interested ? 'Listing saved to your interests.' : 'Listing removed from your interests.');
        } catch (requestError: any) {
            onError(requestError.response?.data?.message ?? 'The Interested update could not be saved.');
        }
    }

    return <button className="interest-button" type="button" onClick={toggleInterest}>{interested ? 'Interested' : 'Mark Interested'}</button>;
}
