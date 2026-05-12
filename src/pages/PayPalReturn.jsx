import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../lib/api';

/**
 * One in-flight capture per PayPal order id so React Strict Mode (double mount) does not:
 * - cancel the success handler with a stale `cancelled` flag, or
 * - fire two separate captures.
 */
const capturePayPalByOrderId = new Map();

function capturePayPalOnce(orderId) {
    const existing = capturePayPalByOrderId.get(orderId);
    if (existing) return existing;
    const p = api.post('/payments/capture-paypal', { orderId }).then((res) => res.data);
    capturePayPalByOrderId.set(orderId, p);
    return p;
}

/**
 * After PayPal approval, PayPal redirects here with ?token=ORDER_ID&PayerID=...
 * Approval alone does not charge the buyer — we must call POST /api/payments/capture-paypal.
 */
export default function PayPalReturn() {
    const { pathname, state: locationState } = useLocation();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const isCancel = pathname.includes('/paypal/cancel');

    const [phase, setPhase] = useState(() => (isCancel ? 'cancelled' : 'pending')); // pending | capturing | done | error | cancelled | missing_token
    /** Set when capture API returns (paymentId = internal payment row; PayPal order id is in URL `token`). */
    const [captureResult, setCaptureResult] = useState(null);
    /** PayPal order id for display: URL `token` after redirect, or passed from saved-PayPal inline checkout. */
    const [displayOrderId, setDisplayOrderId] = useState('');

    const orderId = searchParams.get('token')?.trim() ?? '';
    const navigateTimerRef = useRef(null);

    useEffect(() => {
        if (isCancel) {
            toast.error('PayPal checkout was cancelled.');
            return;
        }

        const inline =
            locationState?.inlineVaultCapture === true &&
            locationState?.captureResult &&
            typeof locationState.captureResult === 'object';

        if (inline) {
            setCaptureResult(locationState.captureResult);
            setDisplayOrderId(String(locationState.orderId ?? '').trim());
            setPhase('done');
            toast.success('Payment completed.', { id: 'paypal-return-done' });
            window.dispatchEvent(new Event('customer-notification:new'));
            navigateTimerRef.current = setTimeout(() => {
                navigateTimerRef.current = null;
                navigate('/dashboard', { replace: true });
            }, 4500);
            return () => {
                if (navigateTimerRef.current) {
                    clearTimeout(navigateTimerRef.current);
                    navigateTimerRef.current = null;
                }
            };
        }

        if (!orderId) {
            setPhase('missing_token');
            toast.error('Missing PayPal order. Start checkout again from the dashboard.');
            return;
        }

        const jwt = localStorage.getItem('accessToken');
        if (!jwt) {
            setPhase('error');
            toast.error('You must be signed in to complete payment. Sign in, then retry checkout or contact support.');
            return;
        }

        setDisplayOrderId(orderId);
        setPhase('capturing');

        (async () => {
            try {
                const data = await capturePayPalOnce(orderId);
                setCaptureResult(data);
                setPhase('done');
                toast.success('Payment completed.', { id: 'paypal-return-done' });
                window.dispatchEvent(new Event('customer-notification:new'));
                navigateTimerRef.current = setTimeout(() => {
                    navigateTimerRef.current = null;
                    navigate('/dashboard', { replace: true });
                }, 4500);
            } catch (err) {
                setPhase('error');
                const msg =
                    err?.response?.data?.error ||
                    (typeof err?.response?.data === 'string' ? err.response.data : null) ||
                    err?.message ||
                    'Could not capture PayPal payment.';
                toast.error(msg);
            }
        })();

        return () => {
            if (navigateTimerRef.current) {
                clearTimeout(navigateTimerRef.current);
                navigateTimerRef.current = null;
            }
        };
    }, [isCancel, locationState, navigate, orderId]);

    const title =
        isCancel ? 'Payment cancelled' : phase === 'capturing' ? 'Completing payment…' : phase === 'done' ? 'Payment successful' : phase === 'missing_token' ? 'Missing order' : phase === 'error' ? 'Payment not completed' : 'PayPal';

    const subtitle = isCancel
        ? 'You can try again from the dashboard checkout when you are ready.'
        : phase === 'capturing'
          ? 'Confirming your PayPal payment with our server. Please wait…'
          : phase === 'done'
            ? 'Your payment was captured. You can note the reference below; we will take you to the dashboard in a few seconds.'
            : phase === 'missing_token'
              ? 'PayPal did not return an order id in the URL. Use Pay with PayPal from checkout again.'
              : phase === 'error'
                ? 'Capture did not succeed. You can return to the dashboard and try paying again, or sign in if your session expired.'
                : 'Processing…';

    return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
            <div className="max-w-md w-full rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
                <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
                <p className="mt-2 text-sm text-slate-600">{subtitle}</p>
                {phase === 'capturing' && (
                    <div className="mt-6 flex justify-center" aria-hidden>
                        <div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
                    </div>
                )}
                {phase === 'done' && captureResult && (
                    <div className="mt-6 rounded-lg border border-emerald-200 bg-emerald-50/80 p-4 text-left text-sm">
                        <p className="font-medium text-emerald-900">Transaction reference</p>
                        <dl className="mt-3 space-y-2 text-slate-800">
                            <div>
                                <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Payment id (our system)</dt>
                                <dd className="mt-0.5 break-all font-mono text-xs">{captureResult.paymentId ?? '—'}</dd>
                            </div>
                            <div>
                                <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Capture status</dt>
                                <dd className="mt-0.5 font-semibold">{captureResult.captureStatus ?? '—'}</dd>
                            </div>
                            {captureResult.paypalCaptureId && (
                                <div>
                                    <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                                        PayPal capture id (transaction)
                                    </dt>
                                    <dd className="mt-0.5 break-all font-mono text-xs">{captureResult.paypalCaptureId}</dd>
                                </div>
                            )}
                            <div>
                                <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">PayPal order id</dt>
                                <dd className="mt-0.5 break-all font-mono text-xs">
                                    {displayOrderId || orderId || '—'}
                                </dd>
                            </div>
                        </dl>
                    </div>
                )}
                <Link
                    to="/dashboard"
                    className="mt-6 inline-flex rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-700"
                >
                    {phase === 'done' ? 'Go to dashboard now' : 'Back to dashboard'}
                </Link>
                {!isCancel && phase === 'error' && (
                    <p className="mt-4 text-xs text-slate-500">
                        If PayPal already charged you but this failed, check your PayPal activity and contact support with
                        order id{' '}
                        <code className="rounded bg-slate-100 px-1">{displayOrderId || orderId || '—'}</code>.
                    </p>
                )}
            </div>
        </div>
    );
}
