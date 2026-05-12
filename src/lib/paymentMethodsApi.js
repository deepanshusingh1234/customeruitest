import api from './api';

/** @returns {Promise<Array<Record<string, unknown>>>} */
export async function listPaymentMethods() {
    const res = await api.get('/payments/methods');
    return Array.isArray(res.data) ? res.data : [];
}

export async function createSetupIntent() {
    const res = await api.post('/payments/setup-intent');
    return res.data;
}

export async function attachPaymentMethod(paymentMethodId) {
    const res = await api.post('/payments/attach-method', { paymentMethodId });
    return res.data;
}

export async function setDefaultPaymentMethod(methodId) {
    const res = await api.patch(`/payments/methods/${encodeURIComponent(methodId)}/default`);
    return res.data;
}

export async function startPayPalVault(returnUrl, cancelUrl) {
    const res = await api.post('/payments/paypal/vault/start', { returnUrl, cancelUrl });
    return res.data;
}

export async function completePayPalVault(setupTokenIdOrToken) {
    const t = String(setupTokenIdOrToken ?? '').trim();
    const res = await api.post('/payments/paypal/vault/complete', { token: t });
    return res.data;
}
