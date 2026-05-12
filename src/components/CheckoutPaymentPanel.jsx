import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, CardElement, useStripe, useElements } from '@stripe/react-stripe-js';
import toast from 'react-hot-toast';
import { CreditCard, Lock, Tag, X } from 'lucide-react';
import api from '../lib/api';
import { attachPaymentMethod, listPaymentMethods } from '../lib/paymentMethodsApi';
import { paypalCheckoutReturnUrls } from '../lib/paymentOrigin';

const MAX_COUPONS = 8;

function normalizeCouponCodes(list) {
    const out = [];
    for (const x of list || []) {
        const s = String(x ?? '').trim();
        if (!s) continue;
        const up = s.toUpperCase();
        if (!out.includes(up) && out.length < MAX_COUPONS) out.push(up);
    }
    return out;
}

function couponPricingFromSummary(summary) {
    return summary?.couponPricing ?? summary?.pricing ?? null;
}

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

/** PayPal / display: prefer coupon-adjusted total from summary, then locked carrier quote. */
function resolveCheckoutMoney(lockedCarrierOption, summary) {
    const couponPricing = couponPricingFromSummary(summary);
    const fromLocked = String(lockedCarrierOption?.currency ?? '').trim().toUpperCase();
    const fromSummary = String(summary?.currency ?? '').trim().toUpperCase();
    const currency = fromLocked || fromSummary;
    const baseSummaryAmount =
        summary?.finalAmount != null && summary.finalAmount !== ''
            ? summary.finalAmount
            : lockedCarrierOption?.total != null && lockedCarrierOption?.total !== ''
                ? lockedCarrierOption.total
                : undefined;
    const amount =
        couponPricing?.finalAmount != null && couponPricing.finalAmount !== ''
            ? couponPricing.finalAmount
            : baseSummaryAmount;
    return { currency, amount, fromLocked, fromSummary, couponPricing };
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

/** Batch pay puts `orderId` on the envelope `data`; ship-in nests the PayPal object under `data.data`. */
function extractPaypalOrderId(payload) {
    const root = payload?.data ?? payload;
    if (typeof root?.orderId === 'string' && root.orderId.trim()) {
        return root.orderId.trim();
    }
    const nested = root?.data;
    if (nested && typeof nested.orderId === 'string' && nested.orderId.trim()) {
        return nested.orderId.trim();
    }
    return null;
}

function extractPaypalAlreadyCompleted(payload) {
    const root = payload?.data ?? payload;
    if (root?.alreadyCompleted === true) return true;
    const nested = root?.data;
    if (nested?.alreadyCompleted === true) return true;
    return false;
}

/** Same envelope shapes as `extractPaypalOrderId` (batch vs ship-in). */
function extractPaymentIdFromPay(payload) {
    const root = payload?.data ?? payload;
    if (typeof root?.paymentId === 'string' && root.paymentId.trim()) {
        return root.paymentId.trim();
    }
    const nested = root?.data;
    if (nested && typeof nested.paymentId === 'string' && nested.paymentId.trim()) {
        return nested.paymentId.trim();
    }
    return null;
}

function StripePayForm({ disabled, onPay, busy, saveForFuture, onSaveForFutureChange }) {
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
        await onPay({
            provider: 'STRIPE',
            paymentMethodId: paymentMethod.id,
            saveForFuture: Boolean(saveForFuture),
        });
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
            <label className="mt-3 flex cursor-pointer items-start gap-2 text-sm text-slate-700">
                <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-[#635BFF] focus:ring-[#635BFF]"
                    checked={Boolean(saveForFuture)}
                    onChange={(e) => onSaveForFutureChange?.(e.target.checked)}
                    disabled={disabled || busy}
                />
                <span>Save this card for future checkout</span>
            </label>
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
 * @param {'shipin'|'batch'} checkoutMode — `shipin`: POST `/customer/checkout/shipin/:id/pay`. `batch`: POST `/customer/batches/pay` (stateless).
 * @param {string} [shipmentId] — required when checkoutMode is `shipin`.
 * @param {{ shipInIds: string[], addressId: string, carrierName: string, carrierService?: string, addonServices?: object }} [batchContext] — required when checkoutMode is `batch`.
 * @param {(patch: object) => void} [onCheckoutSummaryPatch] — merge ship-in coupon apply (`POST .../coupons`) into dashboard summary state.
 * @param {(patch: object) => void} [onBatchPriceSummaryPatch] — merge batch coupon preview (`POST .../batches/coupons/preview`) into `batchPriceSummary`.
 */
export default function CheckoutPaymentPanel({
    shipmentId,
    batchContext,
    checkoutMode = 'shipin',
    summary,
    /** Selected rate row from Get Rates (currency/total match what the customer chose). */
    lockedCarrierOption = null,
    disabled,
    busy,
    onBusyChange,
    onPaidSuccess,
    onCheckoutSummaryPatch,
    onBatchPriceSummaryPatch,
}) {
    const navigate = useNavigate();
    const [manualPmId, setManualPmId] = useState('');
    const [useManualStripe, setUseManualStripe] = useState(!publishableKey);
    const [couponDraft, setCouponDraft] = useState('');
    const [couponBusy, setCouponBusy] = useState(false);

    /** @type {[Array<Record<string, unknown>>, function]} */
    const [savedPaymentMethods, setSavedPaymentMethods] = useState([]);
    /** Which processor the customer is paying with (Stripe vs PayPal are mutually exclusive in the UI). */
    const [activeWallet, setActiveWallet] = useState('STRIPE');
    const [stripePaySource, setStripePaySource] = useState('new');
    const [selectedStripePmId, setSelectedStripePmId] = useState('');
    const [paypalPaySource, setPaypalPaySource] = useState('redirect');
    const [selectedPaypalVaultId, setSelectedPaypalVaultId] = useState('');
    const [saveNewCardAfterPay, setSaveNewCardAfterPay] = useState(false);

    const couponCodes = normalizeCouponCodes(summary?.couponCodes ?? []);

    const batchShipInKey =
        checkoutMode === 'batch' && Array.isArray(batchContext?.shipInIds)
            ? batchContext.shipInIds.join(',')
            : '';

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const list = await listPaymentMethods();
                if (cancelled) return;
                setSavedPaymentMethods(Array.isArray(list) ? list : []);
                const stripeRows = (list || []).filter(
                    (m) => m.provider === 'STRIPE' && String(m.stripePaymentMethodId || '').trim(),
                );
                const pick =
                    stripeRows.find((m) => m.isDefault) || (stripeRows.length ? stripeRows[0] : null);
                const ppRows = (list || []).filter(
                    (m) => m.provider === 'PAYPAL' && String(m.paypalVaultId || '').trim(),
                );
                const ppPick =
                    ppRows.find((m) => m.isDefault) || (ppRows.length === 1 ? ppRows[0] : null);
                if (pick?.stripePaymentMethodId) {
                    setActiveWallet('STRIPE');
                    setStripePaySource('saved');
                    setSelectedStripePmId(String(pick.stripePaymentMethodId));
                    setSaveNewCardAfterPay(false);
                    setPaypalPaySource('redirect');
                } else if (!stripeRows.length && ppRows.length) {
                    setActiveWallet('PAYPAL');
                    setStripePaySource('new');
                    setSelectedStripePmId('');
                    setPaypalPaySource(ppPick?.paypalVaultId ? 'saved' : 'redirect');
                } else {
                    setActiveWallet('STRIPE');
                    setStripePaySource('new');
                    setSelectedStripePmId('');
                    setPaypalPaySource('redirect');
                }
                if (ppPick?.paypalVaultId) {
                    setSelectedPaypalVaultId(String(ppPick.paypalVaultId));
                } else {
                    setSelectedPaypalVaultId(ppRows[0] ? String(ppRows[0].paypalVaultId) : '');
                }
            } catch {
                if (!cancelled) setSavedPaymentMethods([]);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [shipmentId, checkoutMode, batchShipInKey]);

    const { currency: payCurrency, amount: payAmount, fromLocked, fromSummary, couponPricing } = resolveCheckoutMoney(
        lockedCarrierOption,
        summary,
    );
    const currencyMismatch =
        fromLocked &&
        fromSummary &&
        fromLocked !== fromSummary;

    const payPath =
        checkoutMode === 'batch'
            ? '/customer/batches/pay'
            : `/customer/checkout/shipin/${shipmentId}/pay`;

    const persistShipInCoupons = async (codes) => {
        if (!shipmentId?.trim()) return;
        setCouponBusy(true);
        try {
            const res = await api.post(`/customer/checkout/shipin/${shipmentId.trim()}/coupons`, {
                codes: normalizeCouponCodes(codes),
            });
            const data = res?.data?.data;
            const patch = data
                ? {
                      ...data,
                      couponPricing: data.couponPricing ?? data.pricing ?? null,
                  }
                : null;
            onCheckoutSummaryPatch?.(patch);
            toast.success(!codes.length ? 'Coupons cleared' : 'Coupons updated');
        } catch (err) {
            toast.error(err?.response?.data?.error || 'Could not apply coupon');
        } finally {
            setCouponBusy(false);
        }
    };

    const persistBatchCouponsPreview = async (codes) => {
        if (!batchContext?.shipInIds?.length) return;
        setCouponBusy(true);
        try {
            const res = await api.post('/customer/batches/coupons/preview', {
                shipInIds: batchContext.shipInIds,
                addressId: batchContext.addressId,
                carrierName: batchContext.carrierName,
                ...(batchContext.carrierService ? { carrierService: batchContext.carrierService } : {}),
                ...(batchContext.addonServices ? { addonServices: batchContext.addonServices } : {}),
                codes: normalizeCouponCodes(codes),
            });
            const data = res?.data?.data;
            const patch = data
                ? {
                      ...data,
                      couponPricing: data.couponPricing ?? data.pricing ?? null,
                      couponCodes: Array.isArray(data.couponCodes) ? normalizeCouponCodes(data.couponCodes) : [],
                  }
                : null;
            onBatchPriceSummaryPatch?.(patch);
            toast.success(!codes.length ? 'Coupons cleared' : 'Coupons updated');
        } catch (err) {
            toast.error(err?.response?.data?.error || 'Could not apply coupon');
        } finally {
            setCouponBusy(false);
        }
    };

    const addCouponFromDraft = async () => {
        const code = couponDraft.trim();
        if (!code) {
            toast.error('Enter a coupon code');
            return;
        }
        const next = normalizeCouponCodes([...couponCodes, code]);
        if (checkoutMode === 'batch') {
            await persistBatchCouponsPreview(next);
        } else {
            await persistShipInCoupons(next);
        }
        setCouponDraft('');
    };

    const removeCouponCode = async (code) => {
        const next = couponCodes.filter((c) => c !== code);
        if (checkoutMode === 'batch') {
            await persistBatchCouponsPreview(next);
            return;
        }
        await persistShipInCoupons(next);
    };

    const clearAllCoupons = async () => {
        if (checkoutMode === 'batch') {
            await persistBatchCouponsPreview([]);
            return;
        }
        await persistShipInCoupons([]);
    };

    const completePay = async ({ provider, paymentMethodId, saveForFuture = false }) => {
        if (checkoutMode === 'batch') {
            if (!batchContext?.shipInIds?.length) {
                toast.error('Missing batch checkout data');
                return;
            }
        } else if (!shipmentId) {
            return;
        }

        let effectiveStripePm = '';
        if (provider === 'STRIPE') {
            if (useManualStripe) {
                effectiveStripePm = String(manualPmId || '').trim();
            } else if (stripePaySource === 'saved') {
                effectiveStripePm = String(selectedStripePmId || '').trim();
            } else {
                effectiveStripePm = String(paymentMethodId || '').trim();
            }
            if (!effectiveStripePm) {
                toast.error('Choose a saved card, add a card, or enter a payment method id');
                return;
            }
        }

        const hasSavedPaypalMethods = savedPaymentMethods.some(
            (m) => m.provider === 'PAYPAL' && String(m.paypalVaultId || '').trim(),
        );
        if (provider === 'PAYPAL' && hasSavedPaypalMethods && activeWallet !== 'PAYPAL') {
            toast.error('Select PayPal under saved payment methods to pay with PayPal.');
            return;
        }

        if (provider === 'PAYPAL' && paypalPaySource === 'saved' && !String(selectedPaypalVaultId || '').trim()) {
            toast.error('No saved PayPal account. Add one under Saved payments.');
            return;
        }

        const hasSavedStripeMethods = savedPaymentMethods.some(
            (m) => m.provider === 'STRIPE' && String(m.stripePaymentMethodId || '').trim(),
        );
        if (provider === 'STRIPE' && !useManualStripe && hasSavedStripeMethods && activeWallet !== 'STRIPE') {
            toast.error('Select a card option under saved payment methods to pay with Stripe.');
            return;
        }

        const paypalUrls = paypalCheckoutReturnUrls();
        const paypalVaultExtra =
            provider === 'PAYPAL' &&
            paypalPaySource === 'saved' &&
            String(selectedPaypalVaultId || '').trim()
                ? { paypalVaultId: String(selectedPaypalVaultId).trim() }
                : {};

        onBusyChange(true);
        try {
            const codesPayload =
                couponCodes.length > 0 ? { couponCodes: normalizeCouponCodes(couponCodes) } : {};
            let body;
            if (checkoutMode === 'batch') {
                body = {
                    shipInIds: batchContext.shipInIds,
                    addressId: batchContext.addressId,
                    carrierName: batchContext.carrierName,
                    ...(batchContext.carrierService ? { carrierService: batchContext.carrierService } : {}),
                    ...(batchContext.addonServices ? { addonServices: batchContext.addonServices } : {}),
                    provider,
                    ...(provider === 'STRIPE'
                        ? { paymentMethodId: effectiveStripePm }
                        : { ...paypalUrls, ...paypalVaultExtra }),
                    ...codesPayload,
                };
            } else if (provider === 'STRIPE') {
                body = { provider, paymentMethodId: effectiveStripePm, ...codesPayload };
            } else {
                const { currency: ccRaw, amount: amt } = resolveCheckoutMoney(lockedCarrierOption, summary);
                const cc = String(ccRaw ?? '').trim().toUpperCase();
                const hasAmount = amt != null && amt !== '';
                body = {
                    provider,
                    ...paypalUrls,
                    ...paypalVaultExtra,
                    ...codesPayload,
                    ...(cc ? { currencyCode: cc } : {}),
                    ...(hasAmount ? { amount: amt } : {}),
                };
            }
            const res = await api.post(payPath, body);

            let paypalImmediateSuccess = provider === 'PAYPAL' && extractPaypalAlreadyCompleted(res.data);
            /** Saved PayPal (vault) inline: show same confirmation UI as `/paypal/success` redirect flow. */
            let paypalVaultSuccessNav = null;
            if (provider === 'PAYPAL') {
                const redirectUrl = extractPaypalRedirect(res.data);
                if (redirectUrl) {
                    toast.success('Redirecting to PayPal…');
                    window.location.assign(redirectUrl);
                    return;
                }
                if (!paypalImmediateSuccess) {
                    const orderId = extractPaypalOrderId(res.data);
                    if (orderId) {
                        try {
                            const capRes = await api.post('/payments/capture-paypal', { orderId });
                            const cap = capRes?.data;
                            const capStatus = String(cap?.captureStatus ?? '').toUpperCase();
                            paypalImmediateSuccess =
                                cap?.alreadyCompleted === true || capStatus === 'COMPLETED';
                            if (paypalImmediateSuccess && paypalPaySource === 'saved') {
                                paypalVaultSuccessNav = {
                                    orderId,
                                    captureResult: cap,
                                };
                            }
                        } catch (captureErr) {
                            toast.error(
                                captureErr?.response?.data?.error ||
                                    (typeof captureErr?.response?.data === 'string'
                                        ? captureErr.response.data
                                        : null) ||
                                    captureErr?.message ||
                                    'Could not capture PayPal payment.',
                            );
                            window.dispatchEvent(new Event('customer-notification:new'));
                            return;
                        }
                    }
                } else if (paypalPaySource === 'saved') {
                    const oid = extractPaypalOrderId(res.data) || '';
                    paypalVaultSuccessNav = {
                        orderId: oid,
                        captureResult: {
                            paymentId: extractPaymentIdFromPay(res.data),
                            captureStatus: 'COMPLETED',
                            paypalCaptureId: null,
                            alreadyCompleted: true,
                        },
                    };
                }
            }

            const payRoot = res?.data;
            const payStatus = payRoot?.data?.status ?? payRoot?.status;
            const stripeChargeSucceeded =
                provider === 'STRIPE' && String(payStatus ?? '').toLowerCase() === 'succeeded';

            const skipPaypalToastForVaultSuccessPage =
                provider === 'PAYPAL' && paypalImmediateSuccess && paypalVaultSuccessNav;

            if (!skipPaypalToastForVaultSuccessPage) {
                toast.success(
                    stripeChargeSucceeded || paypalImmediateSuccess
                        ? 'Payment successful'
                        : 'Payment submitted',
                );
            }

            if (
                provider === 'STRIPE' &&
                saveForFuture &&
                stripeChargeSucceeded &&
                !useManualStripe &&
                stripePaySource === 'new'
            ) {
                try {
                    await attachPaymentMethod(effectiveStripePm);
                    toast.success('Card saved for future checkout.');
                    const list = await listPaymentMethods();
                    setSavedPaymentMethods(Array.isArray(list) ? list : []);
                    setSaveNewCardAfterPay(false);
                } catch (attachErr) {
                    toast.error(
                        attachErr?.response?.data?.error ||
                            'Payment succeeded, but this card could not be saved for later.',
                    );
                }
            }

            await onPaidSuccess?.();

            if (paypalVaultSuccessNav?.captureResult) {
                navigate('/paypal/success', {
                    replace: true,
                    state: {
                        inlineVaultCapture: true,
                        orderId: paypalVaultSuccessNav.orderId,
                        captureResult: paypalVaultSuccessNav.captureResult,
                    },
                });
            }
        } catch (err) {
            toast.error(err?.response?.data?.error || 'Payment failed');
            window.dispatchEvent(new Event('customer-notification:new'));
        } finally {
            onBusyChange(false);
        }
    };

    const stripeSavedRows = savedPaymentMethods.filter(
        (m) => m.provider === 'STRIPE' && String(m.stripePaymentMethodId || '').trim(),
    );
    const paypalSavedRows = savedPaymentMethods.filter(
        (m) => m.provider === 'PAYPAL' && String(m.paypalVaultId || '').trim(),
    );
    /** When saved PayPal methods exist, the yellow button only runs PayPal if that rail is selected. */
    const payPalCtaRequiresWalletSelection = paypalSavedRows.length > 0;

    return (
        <div className="space-y-5 border border-slate-200 rounded-xl bg-slate-50/50 p-5">
            <div>
                <h3 className="text-base font-semibold text-slate-900">Payment</h3>
                <p className="mt-1 text-xs text-slate-500">
                    {checkoutMode === 'batch' ? (
                        <>
                            Consolidated batch ({batchContext?.shipInIds?.length ?? 0} shipments)
                        </>
                    ) : (
                        <>Single shipment checkout</>
                    )}
                </p>
                {summary &&
                    summary.productAmount != null &&
                    summary.shippingAmount != null &&
                    summary.addOnAmount != null && (
                        <div className="mt-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700">
                            <p className="mb-2 font-semibold text-slate-900">Order summary</p>
                            <dl className="space-y-1">
                                <div className="flex justify-between gap-4">
                                    <dt>Products</dt>
                                    <dd className="font-medium tabular-nums">
                                        {summary.productAmount} {payCurrency || summary.currency || ''}
                                    </dd>
                                </div>
                                <div className="flex justify-between gap-4">
                                    <dt>Shipping</dt>
                                    <dd className="font-medium tabular-nums">
                                        {summary.shippingAmount} {payCurrency || summary.currency || ''}
                                    </dd>
                                </div>
                                <div className="flex justify-between gap-4">
                                    <dt>Add-ons</dt>
                                    <dd className="font-medium tabular-nums">
                                        {summary.addOnAmount} {payCurrency || summary.currency || ''}
                                    </dd>
                                </div>
                                <div className="flex justify-between gap-4 border-t border-slate-100 pt-1 text-slate-600">
                                    <dt>Subtotal</dt>
                                    <dd className="tabular-nums">
                                        {summary.finalAmount} {payCurrency || summary.currency || ''}
                                    </dd>
                                </div>
                                {couponPricing &&
                                    couponPricing.discountTotal != null &&
                                    Number(couponPricing.discountTotal) > 0 && (
                                        <div className="flex justify-between gap-4 text-emerald-800">
                                            <dt>Coupon discount</dt>
                                            <dd className="font-semibold tabular-nums">
                                                −{couponPricing.discountTotal}{' '}
                                                {payCurrency || summary.currency || ''}
                                            </dd>
                                        </div>
                                    )}
                                <div className="flex justify-between gap-4 border-t border-slate-200 pt-1 font-semibold text-slate-900">
                                    <dt>Amount due</dt>
                                    <dd className="tabular-nums">
                                        {payAmount ?? summary.finalAmount}{' '}
                                        {payCurrency || summary.currency || '—'}
                                    </dd>
                                </div>
                            </dl>
                        </div>
                    )}
                {!(
                    summary &&
                    summary.productAmount != null &&
                    summary.shippingAmount != null &&
                    summary.addOnAmount != null
                ) && (
                    <p className="mt-1 text-sm text-slate-600">
                        Amount due:{' '}
                        <span className="font-semibold text-slate-900">
                            {payAmount ?? summary?.finalAmount} {payCurrency || summary?.currency || '—'}
                        </span>
                    </p>
                )}
                {currencyMismatch && (
                    <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
                        Summary says <strong>{fromSummary}</strong> but your locked carrier is <strong>{fromLocked}</strong>.
                        PayPal is sent <strong>{payCurrency}</strong> (carrier). Your server must create the PayPal order in
                        that currency.
                    </p>
                )}
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="mb-3 flex items-center gap-2">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-800 text-white">
                        <Tag className="h-4 w-4" />
                    </div>
                    <div>
                        <h4 className="text-sm font-semibold text-slate-900">Coupon codes</h4>
                        <p className="text-xs text-slate-500">
                            {checkoutMode === 'batch'
                                ? 'Up to 8 codes; order matters for stacking. Preview matches what you pay.'
                                : 'Applied on the server — totals update below when valid.'}
                        </p>
                    </div>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                    <input
                        value={couponDraft}
                        onChange={(e) => setCouponDraft(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                e.preventDefault();
                                void addCouponFromDraft();
                            }
                        }}
                        placeholder="Enter code"
                        disabled={disabled || busy || couponBusy || couponCodes.length >= MAX_COUPONS}
                        className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm uppercase placeholder:normal-case"
                    />
                    <button
                        type="button"
                        disabled={
                            disabled ||
                            busy ||
                            couponBusy ||
                            !couponDraft.trim() ||
                            couponCodes.length >= MAX_COUPONS
                        }
                        onClick={() => void addCouponFromDraft()}
                        className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        {couponBusy ? 'Applying…' : 'Apply'}
                    </button>
                </div>
                {couponCodes.length > 0 && (
                    <ul className="mt-3 flex flex-wrap gap-2">
                        {couponCodes.map((c) => (
                            <li
                                key={c}
                                className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-800"
                            >
                                {c}
                                <button
                                    type="button"
                                    disabled={disabled || busy || couponBusy}
                                    onClick={() => void removeCouponCode(c)}
                                    className="rounded-full p-0.5 text-slate-500 hover:bg-slate-200 hover:text-slate-900 disabled:opacity-50"
                                    aria-label={`Remove ${c}`}
                                >
                                    <X className="h-3.5 w-3.5" />
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
                {couponCodes.length > 0 && (
                    <button
                        type="button"
                        disabled={disabled || busy || couponBusy}
                        onClick={() => void clearAllCoupons()}
                        className="mt-2 text-xs font-medium text-slate-600 underline-offset-2 hover:text-slate-900 hover:underline"
                    >
                        Remove all coupons
                    </button>
                )}
            </div>

            {stripeSavedRows.length + paypalSavedRows.length > 0 && (
                    <div className="rounded-xl border border-indigo-100 bg-indigo-50/30 p-4 shadow-sm">
                        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                            <h4 className="text-sm font-semibold text-slate-900">Use a saved payment method</h4>
                            <Link
                                to="/settings/payment"
                                className="text-xs font-medium text-indigo-600 hover:text-indigo-800"
                            >
                                Manage saved payments
                            </Link>
                        </div>
                        {stripeSavedRows.length > 0 && !useManualStripe && (
                            <fieldset className="mb-4 space-y-2">
                                <legend className="text-xs font-medium text-slate-600">Card (Stripe)</legend>
                                <label className="flex cursor-pointer items-center gap-2 text-sm">
                                    <input
                                        type="radio"
                                        name="checkout-pay-rail"
                                        checked={activeWallet === 'STRIPE' && stripePaySource === 'saved'}
                                        onChange={() => {
                                            setActiveWallet('STRIPE');
                                            setStripePaySource('saved');
                                            setSaveNewCardAfterPay(false);
                                        }}
                                        disabled={disabled || busy}
                                    />
                                    <span>Saved card</span>
                                </label>
                                {activeWallet === 'STRIPE' && stripePaySource === 'saved' && (
                                    <div className="ml-6 space-y-1 border-l border-slate-200 pl-3">
                                        {stripeSavedRows.map((m) => (
                                            <label
                                                key={m.id}
                                                className="flex cursor-pointer items-center gap-2 text-sm text-slate-800"
                                            >
                                                <input
                                                    type="radio"
                                                    name="stripeSavedPm"
                                                    checked={selectedStripePmId === m.stripePaymentMethodId}
                                                    onChange={() => {
                                                        setActiveWallet('STRIPE');
                                                        setStripePaySource('saved');
                                                        setSelectedStripePmId(String(m.stripePaymentMethodId));
                                                        setSaveNewCardAfterPay(false);
                                                    }}
                                                    disabled={disabled || busy}
                                                />
                                                <span>
                                                    {(m.brand || 'Card').toString()} •••• {m.last4 || '????'}
                                                    {m.expMonth && m.expYear
                                                        ? ` · ${m.expMonth}/${m.expYear}`
                                                        : ''}
                                                    {m.isDefault ? ' · default' : ''}
                                                </span>
                                            </label>
                                        ))}
                                    </div>
                                )}
                                <label className="flex cursor-pointer items-center gap-2 text-sm">
                                    <input
                                        type="radio"
                                        name="checkout-pay-rail"
                                        checked={activeWallet === 'STRIPE' && stripePaySource === 'new'}
                                        onChange={() => {
                                            setActiveWallet('STRIPE');
                                            setStripePaySource('new');
                                        }}
                                        disabled={disabled || busy}
                                    />
                                    <span>New card (form below)</span>
                                </label>
                            </fieldset>
                        )}
                        {paypalSavedRows.length > 0 && (
                            <fieldset className="space-y-2">
                                <legend className="text-xs font-medium text-slate-600">PayPal</legend>
                                <label className="flex cursor-pointer items-center gap-2 text-sm">
                                    <input
                                        type="radio"
                                        name="checkout-pay-rail"
                                        checked={activeWallet === 'PAYPAL' && paypalPaySource === 'saved'}
                                        onChange={() => {
                                            setActiveWallet('PAYPAL');
                                            setPaypalPaySource('saved');
                                        }}
                                        disabled={disabled || busy}
                                    />
                                    <span>Saved PayPal</span>
                                </label>
                                {activeWallet === 'PAYPAL' && paypalPaySource === 'saved' && (
                                    <div className="ml-6 space-y-1 border-l border-slate-200 pl-3">
                                        {paypalSavedRows.map((m) => (
                                            <label
                                                key={m.id}
                                                className="flex cursor-pointer items-center gap-2 text-sm text-slate-800"
                                            >
                                                <input
                                                    type="radio"
                                                    name="paypalVaultPick"
                                                    checked={selectedPaypalVaultId === m.paypalVaultId}
                                                    onChange={() => {
                                                        setActiveWallet('PAYPAL');
                                                        setPaypalPaySource('saved');
                                                        setSelectedPaypalVaultId(String(m.paypalVaultId));
                                                    }}
                                                    disabled={disabled || busy}
                                                />
                                                <span>
                                                    {m.paypalEmail
                                                        ? String(m.paypalEmail)
                                                        : `Vault ${String(m.paypalVaultId).slice(0, 8)}…`}
                                                    {m.isDefault ? ' · default' : ''}
                                                </span>
                                            </label>
                                        ))}
                                    </div>
                                )}
                                <label className="flex cursor-pointer items-center gap-2 text-sm">
                                    <input
                                        type="radio"
                                        name="checkout-pay-rail"
                                        checked={activeWallet === 'PAYPAL' && paypalPaySource === 'redirect'}
                                        onChange={() => {
                                            setActiveWallet('PAYPAL');
                                            setPaypalPaySource('redirect');
                                        }}
                                        disabled={disabled || busy}
                                    />
                                    <span>Log in with PayPal each time</span>
                                </label>
                            </fieldset>
                        )}
                    </div>
                )}

            {stripePromise && !useManualStripe && activeWallet === 'STRIPE' && stripePaySource === 'new' && (
                <Elements stripe={stripePromise}>
                    <StripePayForm
                        disabled={disabled}
                        busy={busy}
                        onPay={completePay}
                        saveForFuture={saveNewCardAfterPay}
                        onSaveForFutureChange={setSaveNewCardAfterPay}
                    />
                </Elements>
            )}

            {stripePromise &&
                !useManualStripe &&
                activeWallet === 'STRIPE' &&
                stripePaySource === 'new' &&
                publishableKey.startsWith('pk_test') && (
                    <div className="rounded-lg border border-dashed border-violet-200 bg-violet-50/70 px-3 py-2 text-xs text-slate-700">
                        <p className="font-semibold text-slate-800">Stripe test cards</p>
                        <ul className="mt-1 list-disc space-y-1 pl-4">
                            <li>
                                <span className="font-mono">4242 4242 4242 4242</span> (Visa) — use any 3-digit CVC and
                                any <strong>future</strong> expiry (e.g. 12/34).
                            </li>
                            <li>
                                <span className="font-mono">5555 5555 5555 4444</span> (Mastercard) — any CVC, any
                                future expiry.
                            </li>
                        </ul>
                        <p className="mt-2 text-slate-600">
                            Type a fresh card in the field each time. Reusing an old{' '}
                            <code className="rounded bg-white/90 px-0.5 font-mono text-[11px]">pm_…</code> id usually
                            fails after the first charge.
                        </p>
                    </div>
                )}

            {!useManualStripe && activeWallet === 'STRIPE' && stripePaySource === 'saved' && selectedStripePmId && (
                <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                    <p className="text-sm text-slate-700">Pay with your saved card on file.</p>
                    <button
                        type="button"
                        disabled={disabled || busy}
                        onClick={() => void completePay({ provider: 'STRIPE', paymentMethodId: selectedStripePmId })}
                        className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-[#635BFF] px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-[#544bdb] disabled:opacity-50"
                    >
                        <Lock className="h-4 w-4 opacity-90" />
                        {busy ? 'Processing…' : 'Pay with saved card'}
                    </button>
                </div>
            )}

            {stripePromise && (
                <button
                    type="button"
                    onClick={() => {
                        setUseManualStripe((v) => {
                            if (!v) setActiveWallet('STRIPE');
                            return !v;
                        });
                    }}
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
                        <p>
                            {activeWallet === 'PAYPAL' && paypalPaySource === 'saved'
                                ? 'Pay with your saved PayPal vault (you may still confirm in PayPal if prompted).'
                                : 'Continue to PayPal to log in and approve this payment in your PayPal account.'}
                        </p>
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
                            PayPal uses the priced batch total on the server (including any coupon discount when codes are
                            sent with pay).
                        </p>
                    )}
                </div>
                <button
                    type="button"
                    disabled={disabled || busy || (payPalCtaRequiresWalletSelection && activeWallet !== 'PAYPAL')}
                    title={
                        payPalCtaRequiresWalletSelection && activeWallet !== 'PAYPAL'
                            ? 'Choose a PayPal option under saved payment methods above'
                            : undefined
                    }
                    onClick={() => void completePay({ provider: 'PAYPAL' })}
                    className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-[#0070ba] bg-[#ffc439] px-4 py-3 text-[15px] font-bold tracking-tight text-[#003087] shadow-sm transition hover:bg-[#f2b635] disabled:cursor-not-allowed disabled:opacity-50"
                >
                    {busy ? (
                        'Processing…'
                    ) : (
                        <>
                            <PayPalIcon className="h-6 w-6 shrink-0" />
                            {activeWallet === 'PAYPAL' && paypalPaySource === 'saved'
                                ? 'Pay with saved PayPal'
                                : 'Pay with PayPal'}
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
