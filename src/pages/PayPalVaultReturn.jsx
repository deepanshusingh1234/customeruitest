import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import * as paymentsApi from '../lib/paymentMethodsApi';

const completeByToken = new Map();

function completeVaultOnce(token) {
    const existing = completeByToken.get(token);
    if (existing) return existing;
    const p = paymentsApi.completePayPalVault(token);
    completeByToken.set(token, p);
    return p;
}

/**
 * After PayPal vault approval, payer returns with ?token=…, ?setup_token=…, or (newer flows)
 * ?approval_token_id=… (and sometimes approval_session_id). Same id is sent to vault/complete.
 */
export default function PayPalVaultReturn() {
    const { pathname } = useLocation();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const isCancel = pathname.includes('/paypal/vault/cancel');

    const [phase, setPhase] = useState(() => (isCancel ? 'cancelled' : 'pending'));
    const [result, setResult] = useState(null);
    const navigateTimerRef = useRef(null);

    const token =
        searchParams.get('token')?.trim() ||
        searchParams.get('setup_token')?.trim() ||
        searchParams.get('setupTokenId')?.trim() ||
        searchParams.get('approval_token_id')?.trim() ||
        searchParams.get('approval_session_id')?.trim() ||
        '';

    useEffect(() => {
        const outerTimer = window.setTimeout(() => {
            if (isCancel) {
                toast.error('PayPal linking was cancelled.');
                return;
            }

            if (!token) {
                setPhase('missing_token');
                toast.error('Missing setup token. Try linking PayPal again from Saved payments.');
                return;
            }

            const jwt = localStorage.getItem('accessToken');
            if (!jwt) {
                setPhase('error');
                toast.error('You must be signed in to save PayPal. Sign in, then retry.');
                return;
            }

            setPhase('completing');

            void (async () => {
                try {
                    const data = await completeVaultOnce(token);
                    setResult(data);
                    setPhase('done');
                    toast.success('PayPal saved for checkout.');
                    navigateTimerRef.current = setTimeout(() => {
                        navigateTimerRef.current = null;
                        navigate('/settings/payment', { replace: true });
                    }, 3500);
                } catch (err) {
                    setPhase('error');
                    const msg =
                        err?.response?.data?.error ||
                        err?.message ||
                        'Could not save PayPal. Check vault is enabled for your PayPal app.';
                    toast.error(msg);
                }
            })();
        }, 0);

        return () => {
            clearTimeout(outerTimer);
            if (navigateTimerRef.current) {
                clearTimeout(navigateTimerRef.current);
                navigateTimerRef.current = null;
            }
        };
    }, [isCancel, navigate, token]);

    const title = isCancel
        ? 'Linking cancelled'
        : phase === 'completing'
          ? 'Saving PayPal…'
          : phase === 'done'
            ? 'PayPal saved'
            : phase === 'missing_token'
              ? 'Missing token'
              : phase === 'error'
                ? 'Could not save'
                : 'PayPal';

    return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
            <div className="max-w-md w-full rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
                <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
                <p className="mt-2 text-sm text-slate-600">
                    {isCancel
                        ? 'You can link PayPal later from Saved payments.'
                        : phase === 'completing'
                          ? 'Creating your saved PayPal payment method…'
                          : phase === 'done'
                            ? 'You can use this account for faster checkout. Redirecting…'
                            : phase === 'missing_token'
                              ? 'PayPal did not return a token in the URL.'
                              : phase === 'error'
                                ? 'Something went wrong. Return to Saved payments and try again.'
                                : 'Processing…'}
                </p>
                {phase === 'completing' && (
                    <div className="mt-6 flex justify-center" aria-hidden>
                        <div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
                    </div>
                )}
                {phase === 'done' && result && (
                    <p className="mt-4 text-left text-xs text-slate-600">
                        {result.paypalEmail ? (
                            <>
                                Linked account: <strong>{String(result.paypalEmail)}</strong>
                            </>
                        ) : (
                            'Payment method saved.'
                        )}
                    </p>
                )}
                <Link
                    to="/settings/payment"
                    className="mt-6 inline-flex rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-700"
                >
                    {phase === 'done' ? 'Open Saved payments' : 'Saved payments'}
                </Link>
            </div>
        </div>
    );
}
