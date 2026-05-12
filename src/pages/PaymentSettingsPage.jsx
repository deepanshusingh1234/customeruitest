import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, CardElement, useStripe, useElements } from '@stripe/react-stripe-js';
import toast from 'react-hot-toast';
import { ArrowLeft, CreditCard, Wallet } from 'lucide-react';
import Header from '../components/Header';
import { useAuth } from '../contexts/AuthContext';
import * as paymentsApi from '../lib/paymentMethodsApi';
import { paypalVaultReturnUrls } from '../lib/paymentOrigin';

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
        invalid: { color: '#b91c1c', iconColor: '#b91c1c' },
    },
};

function SaveCardForm({ clientSecret, onSaved, onCancel }) {
    const stripe = useStripe();
    const elements = useElements();
    const [busy, setBusy] = useState(false);
    const [ready, setReady] = useState(false);

    const handleSave = async () => {
        if (!stripe || !elements || !clientSecret) {
            toast.error('Stripe is not ready.');
            return;
        }
        const card = elements.getElement(CardElement);
        if (!card) {
            toast.error('Card form not found.');
            return;
        }
        setBusy(true);
        try {
            const { error, setupIntent } = await stripe.confirmCardSetup(clientSecret, {
                payment_method: { card },
            });
            if (error) {
                toast.error(error.message || 'Card setup failed');
                return;
            }
            const pmId = setupIntent?.payment_method;
            const pmStr = typeof pmId === 'string' ? pmId : pmId?.id;
            if (!pmStr) {
                toast.error('No payment method returned from Stripe.');
                return;
            }
            await paymentsApi.attachPaymentMethod(pmStr);
            toast.success('Card saved.');
            await onSaved?.();
        } catch (err) {
            toast.error(err?.response?.data?.error || err?.message || 'Save failed');
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-3">
                <CardElement options={cardElementOptions} onReady={() => setReady(true)} />
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
                <button
                    type="button"
                    disabled={busy || !ready || !stripe}
                    onClick={() => void handleSave()}
                    className="rounded-lg bg-[#635BFF] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#544bdb] disabled:opacity-50"
                >
                    {busy ? 'Saving…' : 'Save card'}
                </button>
                <button
                    type="button"
                    disabled={busy}
                    onClick={onCancel}
                    className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                    Cancel
                </button>
            </div>
        </div>
    );
}

export default function PaymentSettingsPage() {
    const { user, loading } = useAuth();
    const [methods, setMethods] = useState([]);
    const [loadingMethods, setLoadingMethods] = useState(true);
    const [clientSecret, setClientSecret] = useState(null);
    const [showAddCard, setShowAddCard] = useState(false);
    const [vaultBusy, setVaultBusy] = useState(false);

    const refreshMethods = useCallback(async () => {
        setLoadingMethods(true);
        try {
            const list = await paymentsApi.listPaymentMethods();
            setMethods(list);
        } catch {
            toast.error('Could not load saved payment methods.');
            setMethods([]);
        } finally {
            setLoadingMethods(false);
        }
    }, []);

    useEffect(() => {
        if (loading || !user) return;
        const t = setTimeout(() => {
            void refreshMethods();
        }, 0);
        return () => clearTimeout(t);
    }, [loading, user, refreshMethods]);

    const beginAddCard = async () => {
        if (!stripePromise) {
            toast.error('Set VITE_STRIPE_PUBLISHABLE_KEY to save cards.');
            return;
        }
        setShowAddCard(true);
        setClientSecret(null);
        try {
            const { clientSecret: secret } = await paymentsApi.createSetupIntent();
            if (!secret) {
                toast.error('No setup intent from server.');
                setShowAddCard(false);
                return;
            }
            setClientSecret(secret);
        } catch (err) {
            toast.error(err?.response?.data?.error || 'Could not start card setup.');
            setShowAddCard(false);
        }
    };

    const setDefault = async (id) => {
        try {
            await paymentsApi.setDefaultPaymentMethod(id);
            toast.success('Default updated.');
            await refreshMethods();
        } catch (err) {
            toast.error(err?.response?.data?.error || 'Could not set default.');
        }
    };

    const linkPayPal = async () => {
        setVaultBusy(true);
        try {
            const { returnUrl, cancelUrl } = paypalVaultReturnUrls();
            const data = await paymentsApi.startPayPalVault(returnUrl, cancelUrl);
            const url = data?.approvalUrl;
            if (typeof url === 'string' && url.length > 0) {
                window.location.assign(url);
                return;
            }
            toast.error(
                data?.clientSdkNote
                    ? 'PayPal did not return a redirect URL. Enable vault on your PayPal app or use the PayPal JS SDK with the setup token from the API response.'
                    : 'PayPal did not return an approval URL.',
            );
        } catch (err) {
            const msg = err?.response?.data?.error || err?.message || 'PayPal vault start failed';
            toast.error(msg);
        } finally {
            setVaultBusy(false);
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center">
                <p className="text-slate-600">Loading…</p>
            </div>
        );
    }

    if (!user) {
        return (
            <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center gap-4">
                <p className="text-slate-600">Sign in to manage payment methods.</p>
                <Link to="/login" className="text-indigo-600 font-medium">
                    Go to login
                </Link>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50">
            <Header />
            <main className="max-w-2xl mx-auto px-4 py-8">
                <Link
                    to="/dashboard"
                    className="inline-flex items-center gap-2 text-sm font-medium text-indigo-600 hover:text-indigo-800 mb-6"
                >
                    <ArrowLeft className="h-4 w-4" />
                    Back to dashboard
                </Link>
                <h1 className="text-2xl font-bold text-slate-900">Saved payments</h1>
                <p className="mt-1 text-sm text-slate-600">
                    Save a card or PayPal account for faster checkout. Your dashboard checkout can use these methods.
                </p>

                <section className="mt-8">
                    <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
                        <CreditCard className="h-5 w-5 text-[#635BFF]" />
                        Saved methods
                    </h2>
                    {loadingMethods ? (
                        <p className="mt-3 text-sm text-slate-500">Loading…</p>
                    ) : methods.length === 0 ? (
                        <p className="mt-3 text-sm text-slate-600">No saved methods yet.</p>
                    ) : (
                        <ul className="mt-3 space-y-2">
                            {methods.map((m) => (
                                <li
                                    key={m.id}
                                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm"
                                >
                                    <div>
                                        <span className="font-medium text-slate-900">
                                            {m.provider === 'PAYPAL'
                                                ? `PayPal${m.paypalEmail ? ` (${m.paypalEmail})` : ''}`
                                                : `${m.brand || 'Card'} •••• ${m.last4 || '????'}`}
                                        </span>
                                        {m.provider === 'STRIPE' && m.expMonth && m.expYear && (
                                            <span className="ml-2 text-slate-500">
                                                {m.expMonth}/{m.expYear}
                                            </span>
                                        )}
                                        {m.isDefault && (
                                            <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
                                                Default
                                            </span>
                                        )}
                                    </div>
                                    {!m.isDefault && (
                                        <button
                                            type="button"
                                            onClick={() => void setDefault(m.id)}
                                            className="text-xs font-medium text-indigo-600 hover:text-indigo-800"
                                        >
                                            Set as default
                                        </button>
                                    )}
                                </li>
                            ))}
                        </ul>
                    )}
                </section>

                <section className="mt-10">
                    <h2 className="text-lg font-semibold text-slate-900">Add a card</h2>
                    {!showAddCard ? (
                        <button
                            type="button"
                            onClick={() => void beginAddCard()}
                            disabled={!stripePromise}
                            className="mt-3 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                        >
                            Add card with Stripe
                        </button>
                    ) : !clientSecret ? (
                        <p className="mt-3 text-sm text-slate-500">Preparing secure form…</p>
                    ) : (
                        <div className="mt-4">
                            {stripePromise && (
                                <Elements stripe={stripePromise} options={{ clientSecret }}>
                                    <SaveCardForm
                                        clientSecret={clientSecret}
                                        onSaved={async () => {
                                            setShowAddCard(false);
                                            setClientSecret(null);
                                            await refreshMethods();
                                        }}
                                        onCancel={() => {
                                            setShowAddCard(false);
                                            setClientSecret(null);
                                        }}
                                    />
                                </Elements>
                            )}
                        </div>
                    )}
                    {!publishableKey && (
                        <p className="mt-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                            Add <code className="px-1">VITE_STRIPE_PUBLISHABLE_KEY</code> to your{' '}
                            <code className="px-1">.env</code> to enable saving cards.
                        </p>
                    )}
                </section>

                <section className="mt-10">
                    <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
                        <Wallet className="h-5 w-5 text-[#0070ba]" />
                        Link PayPal
                    </h2>
                    <p className="mt-1 text-sm text-slate-600">
                        Requires Payment Method Tokens (vault) on your PayPal REST app. You will approve linking in a
                        PayPal window.
                    </p>
                    <button
                        type="button"
                        disabled={vaultBusy}
                        onClick={() => void linkPayPal()}
                        className="mt-3 rounded-lg border-2 border-[#0070ba] bg-[#ffc439] px-4 py-2.5 text-sm font-bold text-[#003087] hover:bg-[#f2b635] disabled:opacity-50"
                    >
                        {vaultBusy ? 'Starting…' : 'Save PayPal account'}
                    </button>
                </section>
            </main>
        </div>
    );
}
