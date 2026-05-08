import { useState } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, CardElement, useStripe, useElements } from '@stripe/react-stripe-js';
import toast from 'react-hot-toast';
import { CreditCard, Lock } from 'lucide-react';
import api from '../lib/api';

const publishableKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || '';

const stripePromise = publishableKey ? loadStripe(publishableKey) : null;

const cardElementOptions = {
    style: {
        base: {
            fontSize: '16px',
            color: '#111827',
            fontFamily: 'system-ui, sans-serif',
            '::placeholder': { color: '#9ca3af' },
        },
        invalid: {
            color: '#b91c1c',
            iconColor: '#b91c1c',
        },
    },
};

/** Base URL for PayPal return/cancel links (must be absolute). Prefer env if origin differs from window (e.g. reverse proxy). */
function getAppPublicOrigin() {
    const fromEnv = import.meta.env.VITE_APP_ORIGIN || import.meta.env.VITE_PUBLIC_APP_URL;
    if (fromEnv && String(fromEnv).trim()) {
        return String(fromEnv).replace(/\/$/, '');
    }
    if (typeof window !== 'undefined') {
        return window.location.origin;
    }
    return '';
}

function paypalReturnUrls() {
    const base = getAppPublicOrigin();
    return {
        returnUrl: `${base}/paypal/success`,
        cancelUrl: `${base}/paypal/cancel`,
    };
}

/** PayPal / display: use locked carrier quote first (matches dropdown), then summary API. */
function resolveCheckoutMoney(lockedCarrierOption, summary) {
    const fromLocked = String(lockedCarrierOption?.currency ?? '').trim().toUpperCase();
    const fromSummary = String(summary?.currency ?? '').trim().toUpperCase();
    const currency = fromLocked || fromSummary;
    const amount =
        summary?.finalAmount != null && summary.finalAmount !== ''
            ? summary.finalAmount
            : lockedCarrierOption?.total != null && lockedCarrierOption?.total !== ''
                ? lockedCarrierOption.total
                : undefined;
    return { currency, amount, fromLocked, fromSummary };
}

function extractPaypalRedirect(payload) {
    const root = payload?.data ?? payload;
    const data = root?.data ?? root;
    if (typeof data?.approvalUrl === 'string') return data.approvalUrl;
    if (typeof data?.approval_url === 'string') return data.approval_url;
    const links = data?.links;
    if (Array.isArray(links)) {
        const approve = links.find(
            (l) => l?.rel === 'approve' || l?.rel === 'payer-action',
        );
        if (approve?.href) return approve.href;
    }
    return null;
}

function StripePayForm({ disabled, onPay, busy }) {
    const stripe = useStripe();
    const elements = useElements();
    const [cardReady, setCardReady] = useState(false);

    const handlePay = async () => {
        if (!stripe || !elements) {
            toast.error('Stripe is still loading. Try again in a moment.');
            return;
        }
        const card = elements.getElement(CardElement);
        if (!card) {
            toast.error('Card form not found.');
            return;
        }
        const { error, paymentMethod } = await stripe.createPaymentMethod({
            type: 'card',
            card,
        });
        if (error) {
            toast.error(error.message || 'Card validation failed');
            return;
        }
        await onPay({ provider: 'STRIPE', paymentMethodId: paymentMethod.id });
    };

    return (
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#635BFF] text-white">
                    <CreditCard className="h-4 w-4" />
                </div>
                <div>
                    <h4 className="text-sm font-semibold text-slate-900">Pay with card</h4>
                    <p className="text-xs text-slate-500">Secured by Stripe — card data is sent directly to Stripe.</p>
                </div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-3">
                <CardElement options={cardElementOptions} onReady={() => setCardReady(true)} />
            </div>
            <button
                type="button"
                disabled={disabled || busy || !stripe || !cardReady}
                onClick={handlePay}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-[#635BFF] px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-[#544bdb] disabled:cursor-not-allowed disabled:opacity-50"
            >
                <Lock className="h-4 w-4 opacity-90" />
                {busy ? 'Processing…' : 'Pay with card'}
            </button>
        </div>
    );
}

/**
 * Stripe Card Element (set VITE_STRIPE_PUBLISHABLE_KEY) or manual pm id; PayPal CTA with redirect when API returns a URL.
 *
 * @param {'shipin'|'batch'} checkoutMode — `shipin`: POST `/customer/checkout/shipin/:id/pay`. `batch`: POST `/customer/batches/:batchId/pay`.
 * @param {string} [shipmentId] — required when checkoutMode is `shipin`.
 * @param {string} [batchId] — required when checkoutMode is `batch`.
 */
export default function CheckoutPaymentPanel({
    shipmentId,
    batchId,
    checkoutMode = 'shipin',
    summary,
    /** Selected rate row from Get Rates (currency/total match what the customer chose). */
    lockedCarrierOption = null,
    disabled,
    busy,
    onBusyChange,
    onPaidSuccess,
}) {
    const [manualPmId, setManualPmId] = useState('');
    const [useManualStripe, setUseManualStripe] = useState(!publishableKey);

    const { currency: payCurrency, amount: payAmount, fromLocked, fromSummary } = resolveCheckoutMoney(
        lockedCarrierOption,
        summary,
    );
    const currencyMismatch =
        fromLocked &&
        fromSummary &&
        fromLocked !== fromSummary;

    const payPath =
        checkoutMode === 'batch'
            ? `/customer/batches/${batchId}/pay`
            : `/customer/checkout/shipin/${shipmentId}/pay`;

    const completePay = async ({ provider, paymentMethodId }) => {
        if (checkoutMode === 'batch') {
            if (!batchId?.trim()) {
                toast.error('Missing batch id');
                return;
            }
        } else if (!shipmentId) {
            return;
        }
        if (provider === 'STRIPE' && !paymentMethodId?.trim()) {
            toast.error('Add a card or enter a payment method id');
            return;
        }
        onBusyChange(true);
        try {
            let body;
            if (provider === 'STRIPE') {
                body = { provider, paymentMethodId: paymentMethodId.trim() };
            } else {
                const { currency: ccRaw, amount: amt } = resolveCheckoutMoney(lockedCarrierOption, summary);
                const cc = String(ccRaw ?? '').trim().toUpperCase();
                const hasAmount = amt != null && amt !== '';
                body = {
                    provider,
                    ...paypalReturnUrls(),
                    /** Single-ship checkout only — batch PayPal uses server-stored amount from `POST .../rate`. */
                    ...(checkoutMode === 'shipin'
                        ? {
                              ...(cc ? { currencyCode: cc } : {}),
                              ...(hasAmount ? { amount: amt } : {}),
                          }
                        : {}),
                };
            }
            const res = await api.post(payPath, body);

            if (provider === 'PAYPAL') {
                const redirectUrl = extractPaypalRedirect(res.data);
                if (redirectUrl) {
                    toast.success('Redirecting to PayPal…');
                    window.location.assign(redirectUrl);
                    return;
                }
            }

            const status = res?.data?.data?.status;
            toast.success(status === 'succeeded' ? 'Payment successful' : 'Payment submitted');
            await onPaidSuccess?.();
        } catch (err) {
            toast.error(err?.response?.data?.error || 'Payment failed');
            window.dispatchEvent(new Event('customer-notification:new'));
        } finally {
            onBusyChange(false);
        }
    };

    return (
        <div className="space-y-5 border border-slate-200 rounded-xl bg-slate-50/50 p-5">
            <div>
                <h3 className="text-base font-semibold text-slate-900">Payment</h3>
                <p className="mt-1 text-xs text-slate-500">
                    {checkoutMode === 'batch' ? (
                        <>
                            Consolidated batch <code className="rounded bg-slate-100 px-1">{batchId}</code>
                        </>
                    ) : (
                        <>Single shipment checkout</>
                    )}
                </p>
                <p className="mt-1 text-sm text-slate-600">
                    Amount due:{' '}
                    <span className="font-semibold text-slate-900">
                        {payAmount ?? summary?.finalAmount} {payCurrency || summary?.currency || '—'}
                    </span>
                </p>
                {currencyMismatch && (
                    <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
                        Summary says <strong>{fromSummary}</strong> but your locked carrier is <strong>{fromLocked}</strong>.
                        PayPal is sent <strong>{payCurrency}</strong> (carrier). Your server must create the PayPal order in
                        that currency.
                    </p>
                )}
            </div>

            {stripePromise && !useManualStripe && (
                <Elements stripe={stripePromise}>
                    <StripePayForm disabled={disabled} busy={busy} onPay={completePay} />
                </Elements>
            )}

            {stripePromise && (
                <button
                    type="button"
                    onClick={() => setUseManualStripe((v) => !v)}
                    className="text-xs font-medium text-indigo-600 hover:text-indigo-800"
                >
                    {useManualStripe ? '← Use Stripe card form' : 'Use payment method id (advanced)'}
                </button>
            )}

            {(useManualStripe || !stripePromise) && (
                <div className="rounded-xl border border-dashed border-slate-300 bg-white p-4">
                    <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">
                        Stripe payment method id
                    </label>
                    <input
                        value={manualPmId}
                        onChange={(e) => setManualPmId(e.target.value)}
                        placeholder="pm_…"
                        className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    />
                    <button
                        type="button"
                        disabled={disabled || busy || !manualPmId.trim()}
                        onClick={() => completePay({ provider: 'STRIPE', paymentMethodId: manualPmId })}
                        className="mt-3 w-full rounded-lg bg-slate-800 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-900 disabled:opacity-50"
                    >
                        {busy ? 'Processing…' : 'Pay with Stripe (manual id)'}
                    </button>
                </div>
            )}

            <div className="relative">
                <div className="absolute inset-0 flex items-center" aria-hidden>
                    <div className="w-full border-t border-slate-200" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-slate-50 px-2 text-slate-400">or</span>
                </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="mb-3 space-y-2 text-xs text-slate-600">
                    <div className="flex items-start gap-2">
                        <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                        <p>Continue to PayPal to log in and approve this payment in your PayPal account.</p>
                    </div>
                    {payCurrency && checkoutMode === 'shipin' && (
                        <p className="pl-5 text-slate-500">
                            Sent to server for PayPal:{' '}
                            <span className="font-semibold text-slate-700">{payCurrency}</span>
                            {fromLocked ? ' (from your selected carrier)' : ' (from checkout summary)'}.
                            If PayPal still errors, the API must pass this into PayPal&apos;s{' '}
                            <code className="rounded bg-slate-100 px-0.5">currency_code</code>, not a hard-coded USD.
                        </p>
                    )}
                    {checkoutMode === 'batch' && (
                        <p className="pl-5 text-slate-500">
                            Batch PayPal orders use the amount from <strong>POST /customer/batches/:id/rate</strong> on the
                            server (no extra fields required here).
                        </p>
                    )}
                </div>
                <button
                    type="button"
                    disabled={disabled || busy}
                    onClick={() => completePay({ provider: 'PAYPAL' })}
                    className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-[#0070ba] bg-[#ffc439] px-4 py-3 text-[15px] font-bold tracking-tight text-[#003087] shadow-sm transition hover:bg-[#f2b635] disabled:cursor-not-allowed disabled:opacity-50"
                >
                    {busy ? (
                        'Processing…'
                    ) : (
                        <>
                            <PayPalIcon className="h-6 w-6 shrink-0" />
                            Pay with PayPal
                        </>
                    )}
                </button>
            </div>

            {!publishableKey && (
                <p className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    For the embedded card form, add{' '}
                    <code className="rounded bg-amber-100/80 px-1">VITE_STRIPE_PUBLISHABLE_KEY</code> to{' '}
                    <code className="rounded bg-amber-100/80 px-1">.env</code> (use your Stripe publishable key{' '}
                    <code className="rounded bg-amber-100/80 px-1">pk_test_…</code> or{' '}
                    <code className="rounded bg-amber-100/80 px-1">pk_live_…</code>).
                </p>
            )}
        </div>
    );
}

function PayPalIcon({ className }) {
    return (
        <svg className={className} viewBox="0 0 24 24" aria-hidden xmlns="http://www.w3.org/2000/svg">
            <path
                fill="#003087"
                d="M8.32 19.59H5.7l-.43-2.73h2.05c1.02 0 1.82-.33 2.05-1.45l.85-5.4c.23-1.45 1.28-1.45 2.3-1.45h3.68c2.18 0 3.73.45 4.5 2.05.18.4.28.85.28 1.35 0 2.5-1.7 3.85-4.73 3.85h-1.18c-.45 0-.75.3-.82.73l-.9 5.68c-.05.28-.28.47-.57.47z"
            />
            <path
                fill="#009cde"
                d="M19.5 8.5c.75 1.35.65 3.1-.28 4.35-.98 1.35-2.85 2.05-5.35 2.05h-1.18c-.45 0-.75.3-.82.73l-.9 5.68c-.05.28-.28.47-.57.47H8.9l.43-2.73h2.05c1.02 0 1.82-.33 2.05-1.45l.85-5.4c.23-1.45 1.28-1.45 2.3-1.45h3.68c1.35 0 2.45.25 3.24.73z"
            />
        </svg>
    );
}
