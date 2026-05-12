/** Base URL for PayPal return/cancel links (must be absolute). */
export function getAppPublicOrigin() {
    const fromEnv = import.meta.env.VITE_APP_ORIGIN || import.meta.env.VITE_PUBLIC_APP_URL;
    if (fromEnv && String(fromEnv).trim()) {
        return String(fromEnv).replace(/\/$/, '');
    }
    if (typeof window !== 'undefined') {
        return window.location.origin;
    }
    return '';
}

export function paypalCheckoutReturnUrls() {
    const base = getAppPublicOrigin();
    return {
        returnUrl: `${base}/paypal/success`,
        cancelUrl: `${base}/paypal/cancel`,
    };
}

export function paypalVaultReturnUrls() {
    const base = getAppPublicOrigin();
    return {
        returnUrl: `${base}/paypal/vault/success`,
        cancelUrl: `${base}/paypal/vault/cancel`,
    };
}
