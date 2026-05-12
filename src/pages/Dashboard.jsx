import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import Header from '../components/Header';
import AddShipButton from '../components/AddShipButton';
import CheckoutPaymentPanel from '../components/CheckoutPaymentPanel';
import { Package, MapPin, Truck } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../lib/api';

const Dashboard = () => {
    const { user, loading } = useAuth();
    const navigate = useNavigate();

    const [approvedShipments, setApprovedShipments] = useState([]);
    const [selectedIds, setSelectedIds] = useState([]);
    const [loadingShipments, setLoadingShipments] = useState(false);
    const [checkoutLoading, setCheckoutLoading] = useState(false);
    const [addresses, setAddresses] = useState([]);
    const [addressId, setAddressId] = useState('');
    const [ratesData, setRatesData] = useState(null);
    const [selectedService, setSelectedService] = useState('');
    const [serviceRows, setServiceRows] = useState([{ code: '', label: '', amount: '' }]);
    const [summary, setSummary] = useState(null);

    /** Batch checkout — stateless (no server-side batch until payment succeeds) */
    const [batchRatesData, setBatchRatesData] = useState(null);
    const [batchSelectedService, setBatchSelectedService] = useState('');
    const [batchPriceSummary, setBatchPriceSummary] = useState(null);
    const [batchSummaryView, setBatchSummaryView] = useState(null);

    const selectionKey = useMemo(() => [...selectedIds].sort().join(','), [selectedIds]);
    const isMultiCheckout = selectedIds.length >= 2;

    const activeShipment = useMemo(
        () => approvedShipments.find((s) => selectedIds.includes(s.id)) || null,
        [approvedShipments, selectedIds],
    );

    /** Unified carrier list: batch APIs when 2+ selected, else single-ship */
    const displayRatesData = isMultiCheckout ? batchRatesData : ratesData;
    const displaySelectedService = isMultiCheckout ? batchSelectedService : selectedService;
    const setDisplaySelectedService = isMultiCheckout ? setBatchSelectedService : setSelectedService;

    const lockedCarrierOption = useMemo(
        () => displayRatesData?.options?.find((o) => o.service === displaySelectedService) ?? null,
        [displayRatesData, displaySelectedService],
    );

    const addonServicesPayload = () => {
        const lines = serviceRows
            .map((s) => ({ code: s.code, label: s.label, amount: Number(s.amount) }))
            .filter((s) => s.code && s.label && Number.isFinite(s.amount) && s.amount >= 0);
        return lines.length ? { addOnLines: lines } : {};
    };

    const buildRatePayload = (shipment, currentAddressId) => {
        const toOriginCode = (raw) => {
            const v = String(raw || '').trim().toUpperCase();
            if (!v) return 'CA';
            if (v.length <= 3) return v;
            const map = {
                CANADA: 'CA',
                INDIA: 'IN',
                USA: 'US',
                UNITEDSTATES: 'US',
                UNITEDSTATESOFAMERICA: 'US',
                UNITEDKINGDOM: 'GB',
            };
            const compact = v.replace(/[^A-Z]/g, '');
            return map[compact] || compact.slice(0, 3);
        };

        const boxes = Array.isArray(shipment?.boxes) && shipment.boxes.length > 0
            ? shipment.boxes
            : [
                {
                    dimensionalUnit: 'INCH',
                    length: Number(shipment?.length || 1),
                    width: Number(shipment?.width || 1),
                    height: Number(shipment?.height || 1),
                    weight: Number(shipment?.weight || 1),
                    weightUnit: 'POUND',
                },
            ];

        const items = Array.isArray(shipment?.itemsDetailed) && shipment.itemsDetailed.length > 0
            ? shipment.itemsDetailed
            : (shipment?.items || []).map((it) => {
                const product = it?.product || {};
                return {
                    amount: Number(product.price || 0),
                    currencyCode: String(product.currency || 'USD').toUpperCase(),
                    countryOfOrigin: toOriginCode(product?.meta?.countryOfOrigin),
                    description: product.productName || 'Item',
                    hsCode: product?.meta?.hsCode || '0000.00.0000',
                    quantity: Number(it.quantity || 1),
                    measurements: [
                        {
                            type: 'WEIGHT',
                            unitOfMeasure: 'POUND',
                            value: Number(shipment?.weight || 1),
                        },
                    ],
                };
            });

        return {
            addressId: currentAddressId,
            boxes,
            items,
        };
    };

    const loadApprovedShipments = async () => {
        setLoadingShipments(true);
        try {
            const res = await api.get('/customer/shipments', { params: { status: 'APPROVED' } });
            const shipments = Array.isArray(res?.data?.shipments) ? res.data.shipments : [];
            setApprovedShipments(shipments);
            setSelectedIds((prev) => prev.filter((id) => shipments.some((s) => s.id === id)));
        } catch (err) {
            toast.error(err?.response?.data?.error || 'Failed to load approved shipments');
        } finally {
            setLoadingShipments(false);
        }
    };

    const loadAddresses = async () => {
        try {
            const res = await api.get('/customer-auth/addresses');
            const list = Array.isArray(res?.data?.addresses) ? res.data.addresses : [];
            setAddresses(list);
            const defaultAddress = list.find((a) => a.isDefault);
            if (defaultAddress?.id) {
                setAddressId(defaultAddress.id);
            } else if (list[0]?.id) {
                setAddressId(list[0].id);
            }
        } catch {
            setAddresses([]);
        }
    };

    useEffect(() => {
        if (!loading && !user) {
            navigate('/login');
        }
    }, [loading, user, navigate]);

    useEffect(() => {
        if (!user) return;
        let cancelled = false;
        queueMicrotask(() => {
            if (cancelled) return;
            void loadApprovedShipments();
            void loadAddresses();
        });
        return () => {
            cancelled = true;
        };
    }, [user]);

    const clearBatchCheckout = () => {
        setBatchRatesData(null);
        setBatchSelectedService('');
        setBatchPriceSummary(null);
        setBatchSummaryView(null);
    };

    /** When selection changes or drops below 2, clear stale batch checkout data */
    useEffect(() => {
        clearBatchCheckout();
    }, [isMultiCheckout, selectionKey]);

    useEffect(() => {
        if (isMultiCheckout) return;
        const id = requestAnimationFrame(() => {
            setRatesData(null);
            setSummary(null);
            setSelectedService('');
        });
        return () => cancelAnimationFrame(id);
    }, [activeShipment?.id, isMultiCheckout]);

    const toggleSelect = (id) => {
        setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    };

    const toggleSelectAll = () => {
        if (selectedIds.length === approvedShipments.length) {
            setSelectedIds([]);
        } else {
            setSelectedIds(approvedShipments.map((s) => s.id));
        }
    };

    /** Stateless batch rate — sends all context in the body, no server-side batch yet. */
    const runBatchRate = async ({ carrierName, carrierService } = {}) => {
        if (selectedIds.length < 2) throw new Error('Select at least 2 shipments');
        if (!addressId.trim()) throw new Error('Select a shipping address');
        const res = await api.post('/customer/batches/rate', {
            shipInIds: selectedIds,
            addressId: addressId.trim(),
            carrierName: carrierName || 'Quote',
            ...(carrierService ? { carrierService } : {}),
            addonServices: addonServicesPayload(),
        });
        const data = res?.data?.data || {};
        setBatchRatesData(data.rates || null);
        setBatchPriceSummary(data.summary || null);
        if (data.selected?.service) setBatchSelectedService(data.selected.service);
        return data;
    };

    const fetchRates = async () => {
        if (!addressId.trim()) return toast.error('Select a shipping address first');
        if (isMultiCheckout) {
            setCheckoutLoading(true);
            try {
                await runBatchRate({ carrierName: 'Quote' });
                toast.success('Batch rates loaded (one payment for all selected shipments)');
            } catch (err) {
                toast.error(err?.response?.data?.error || err.message || 'Failed to fetch batch rates');
            } finally {
                setCheckoutLoading(false);
            }
            return;
        }
        if (!activeShipment) return toast.error('Select a shipment first');
        setCheckoutLoading(true);
        try {
            const payload = buildRatePayload(activeShipment, addressId.trim());
            const res = await api.post(`/customer/checkout/shipin/${activeShipment.id}/rates`, payload);
            setRatesData(res?.data?.data || null);
            toast.success('Carrier rates loaded');
        } catch (err) {
            toast.error(err?.response?.data?.error || 'Failed to fetch rates');
        } finally {
            setCheckoutLoading(false);
        }
    };

    const selectCarrier = async () => {
        if (!displaySelectedService) return toast.error('Choose a service first');
        if (isMultiCheckout) {
            setCheckoutLoading(true);
            try {
                const opt = batchRatesData?.options?.find((o) => o.service === batchSelectedService);
                await runBatchRate({
                    carrierName: String(opt?.name || 'Selected carrier'),
                    carrierService: batchSelectedService,
                });
                toast.success('Carrier locked for batch');
            } catch (err) {
                toast.error(err?.response?.data?.error || err.message || 'Failed to lock batch carrier');
            } finally {
                setCheckoutLoading(false);
            }
            return;
        }
        if (!activeShipment) return;
        setCheckoutLoading(true);
        try {
            const payload = {
                ...buildRatePayload(activeShipment, addressId.trim()),
                selectedService,
            };
            const res = await api.post(`/customer/checkout/shipin/${activeShipment.id}/select-carrier`, payload);
            toast.success(res?.data?.message || 'Carrier selected');
        } catch (err) {
            toast.error(err?.response?.data?.error || 'Failed to select carrier');
        } finally {
            setCheckoutLoading(false);
        }
    };

    const addServices = async () => {
        if (isMultiCheckout) {
            setCheckoutLoading(true);
            try {
                const opt = batchRatesData?.options?.find((o) => o.service === batchSelectedService);
                await runBatchRate({
                    carrierName: String(opt?.name || 'Consolidated'),
                    carrierService: batchSelectedService || '',
                });
                toast.success('Batch add-ons saved and price updated');
            } catch (err) {
                toast.error(err?.response?.data?.error || err.message || 'Failed to update batch services');
            } finally {
                setCheckoutLoading(false);
            }
            return;
        }
        if (!activeShipment) return;
        const services = serviceRows
            .map((s) => ({ ...s, amount: Number(s.amount) }))
            .filter((s) => s.code && s.label && Number.isFinite(s.amount));
        setCheckoutLoading(true);
        try {
            const res = await api.post(`/customer/checkout/shipin/${activeShipment.id}/add-services`, { services });
            toast.success(res?.data?.message || 'Services updated');
        } catch (err) {
            toast.error(err?.response?.data?.error || 'Failed to add services');
        } finally {
            setCheckoutLoading(false);
        }
    };

    const fetchSummary = async () => {
        if (isMultiCheckout) {
            setCheckoutLoading(true);
            try {
                const res = await api.post('/customer/batches/summary', { shipInIds: selectedIds });
                setBatchSummaryView(res?.data?.data || null);
                toast.success('Batch summary loaded');
            } catch (err) {
                toast.error(err?.response?.data?.error || err.message || 'Failed to load batch summary');
            } finally {
                setCheckoutLoading(false);
            }
            return;
        }
        if (!activeShipment) return;
        setCheckoutLoading(true);
        try {
            const res = await api.get(`/customer/checkout/shipin/${activeShipment.id}/summary`);
            setSummary(res?.data?.data || null);
            toast.success('Summary loaded');
        } catch (err) {
            toast.error(err?.response?.data?.error || 'Failed to fetch summary');
        } finally {
            setCheckoutLoading(false);
        }
    };

    const handleCheckoutPaidSuccess = async () => {
        window.dispatchEvent(new Event('customer-notification:new'));
        await loadApprovedShipments();
        setSelectedIds([]);
        setSummary(null);
        setRatesData(null);
        clearBatchCheckout();
    };

    /** Merge `POST .../coupons` preview into single-shipment checkout summary for totals / chips. */
    const mergeShipInCouponPatch = (patch) => {
        if (!patch || typeof patch !== 'object') return;
        setSummary((prev) => {
            const base = prev || {};
            const couponPricing = patch.couponPricing ?? patch.pricing ?? base.couponPricing ?? null;
            return {
                ...base,
                ...patch,
                couponPricing,
                couponCodes: patch.couponCodes ?? base.couponCodes,
            };
        });
    };

    /** Merge `POST .../batches/:id/coupons/preview` into consolidated checkout totals / chips. */
    const mergeBatchCouponPatch = (patch) => {
        if (!patch || typeof patch !== 'object') return;
        setBatchPriceSummary((prev) => {
            const base = prev || {};
            const couponPricing = patch.couponPricing ?? patch.pricing ?? null;
            return {
                ...base,
                ...patch,
                couponPricing,
                couponCodes: Array.isArray(patch.couponCodes) ? patch.couponCodes : [],
            };
        });
    };

    const ratesButtonDisabled =
        checkoutLoading ||
        !addressId.trim() ||
        (isMultiCheckout ? selectedIds.length < 2 : !activeShipment);

    const stats = [
        { label: 'Approved Shipments', value: String(approvedShipments.length), icon: Package, color: 'bg-blue-500' },
        { label: 'Selected', value: String(selectedIds.length), icon: Truck, color: 'bg-green-500' },
        { label: 'Saved Addresses', value: String(addresses.length), icon: MapPin, color: 'bg-purple-500' },
    ];

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto"></div>
                    <p className="mt-4 text-gray-600">Loading...</p>
                </div>
            </div>
        );
    }

    if (!user) {
        return null;
    }

    return (
        <div className="min-h-screen bg-gray-50">
            <Header />

            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                <div className="mb-8">
                    <h1 className="text-3xl font-bold text-gray-900">
                        Welcome back, {user.name}!
                    </h1>
                    <p className="text-gray-600 mt-1">
                        Suite ID: {user.suiteId} | {user.countryCode}
                    </p>
                </div>

                <div className="mb-8">
                    <AddShipButton />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                    {stats.map((stat, index) => (
                        <div key={index} className="bg-white rounded-lg shadow p-6">
                            <div className="flex items-center">
                                <div className={`${stat.color} p-3 rounded-lg`}>
                                    <stat.icon className="w-6 h-6 text-white" />
                                </div>
                                <div className="ml-4">
                                    <p className="text-sm font-medium text-gray-600">{stat.label}</p>
                                    <p className="text-2xl font-semibold text-gray-900">{stat.value}</p>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>

                <div className="bg-white rounded-lg shadow">
                    <div className="px-6 py-4 border-b">
                        <div className="flex items-center justify-between gap-3">
                            <h2 className="text-xl font-semibold text-gray-900">Approved Shipments Checkout</h2>
                            <button
                                type="button"
                                onClick={loadApprovedShipments}
                                className="px-3 py-1.5 text-sm rounded-md bg-gray-100 hover:bg-gray-200"
                            >
                                Refresh
                            </button>
                        </div>
                    </div>
                    <div className="p-6 space-y-5">
                        {isMultiCheckout && (
                            <div className="rounded-lg border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-950">
                                <strong>{selectedIds.length} shipments selected</strong> — checkout uses a{' '}
                                <strong>stateless</strong> batch flow so you get <strong>one</strong> payment and{' '}
                                <strong>one</strong> ShipOut. Use Get Rates → Lock Carrier → Pay (same buttons as
                                single shipment).
                            </div>
                        )}

                        <div className="flex items-center gap-3">
                            <input
                                id="select-all-approved"
                                type="checkbox"
                                checked={approvedShipments.length > 0 && selectedIds.length === approvedShipments.length}
                                onChange={toggleSelectAll}
                            />
                            <label htmlFor="select-all-approved" className="text-sm text-gray-700">Select all approved shipments</label>
                        </div>

                        <div className="overflow-x-auto border rounded-lg">
                            <table className="w-full">
                                <thead className="bg-gray-50">
                                    <tr>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Select</th>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                            Shipment ID
                                        </th>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                            Tracking
                                        </th>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                            Status
                                        </th>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                            Merchant
                                        </th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-200">
                                    {approvedShipments.map((s) => (
                                        <tr key={s.id} className="hover:bg-gray-50">
                                            <td className="px-6 py-4">
                                                <input
                                                    type="checkbox"
                                                    checked={selectedIds.includes(s.id)}
                                                    onChange={() => toggleSelect(s.id)}
                                                />
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                                                {s.id}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                                                {s.trackingNumber || '—'}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <span className="px-2 py-1 text-xs rounded-full bg-emerald-100 text-emerald-800">
                                                    {s.status}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                                                {s.merchantName || '—'}
                                            </td>
                                        </tr>
                                    ))}
                                    {approvedShipments.length === 0 && !loadingShipments && (
                                        <tr>
                                            <td colSpan={5} className="px-6 py-8 text-center text-sm text-gray-500">
                                                No APPROVED shipments found.
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <select
                                value={addressId}
                                onChange={(e) => setAddressId(e.target.value)}
                                className="border rounded-md px-3 py-2 text-sm"
                            >
                                <option value="">Select address</option>
                                {addresses.map((addr) => (
                                    <option key={addr.id} value={addr.id}>
                                        {addr.name} - {addr.address}, {addr.city} ({addr.postalCode})
                                    </option>
                                ))}
                            </select>
                            <button
                                type="button"
                                onClick={fetchRates}
                                disabled={ratesButtonDisabled}
                                className="px-4 py-2 rounded-md bg-indigo-600 text-white disabled:opacity-50"
                            >
                                Get Rates
                            </button>
                        </div>

                        {displayRatesData?.options?.length > 0 && (
                            <div className="space-y-3 border rounded-lg p-4">
                                <h3 className="font-semibold text-gray-900">Select Carrier</h3>
                                <select
                                    value={displaySelectedService}
                                    onChange={(e) => setDisplaySelectedService(e.target.value)}
                                    className="border rounded-md px-3 py-2 text-sm w-full"
                                >
                                    <option value="">Choose service</option>
                                    {displayRatesData.options.map((opt) => (
                                        <option key={opt.service} value={opt.service}>
                                            {opt.name} - {opt.total} {opt.currency}
                                        </option>
                                    ))}
                                </select>
                                <button
                                    type="button"
                                    onClick={selectCarrier}
                                    disabled={checkoutLoading || !displaySelectedService}
                                    className="px-4 py-2 rounded-md bg-indigo-600 text-white disabled:opacity-50"
                                >
                                    Lock Carrier
                                </button>
                            </div>
                        )}

                        <div className="space-y-3 border rounded-lg p-4">
                            <h3 className="font-semibold text-gray-900">Add Services</h3>
                            {serviceRows.map((row, idx) => (
                                <div key={idx} className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                    <input
                                        value={row.code}
                                        onChange={(e) => setServiceRows((prev) => prev.map((r, i) => i === idx ? { ...r, code: e.target.value } : r))}
                                        placeholder="code"
                                        className="border rounded-md px-3 py-2 text-sm"
                                    />
                                    <input
                                        value={row.label}
                                        onChange={(e) => setServiceRows((prev) => prev.map((r, i) => i === idx ? { ...r, label: e.target.value } : r))}
                                        placeholder="label"
                                        className="border rounded-md px-3 py-2 text-sm"
                                    />
                                    <input
                                        value={row.amount}
                                        onChange={(e) => setServiceRows((prev) => prev.map((r, i) => i === idx ? { ...r, amount: e.target.value } : r))}
                                        placeholder="amount"
                                        className="border rounded-md px-3 py-2 text-sm"
                                    />
                                </div>
                            ))}
                            <div className="flex gap-2">
                                <button
                                    type="button"
                                    onClick={() => setServiceRows((prev) => [...prev, { code: '', label: '', amount: '' }])}
                                    className="px-3 py-2 rounded-md bg-gray-100"
                                >
                                    Add Row
                                </button>
                                <button
                                    type="button"
                                    onClick={addServices}
                                    disabled={
                                        checkoutLoading ||
                                        (isMultiCheckout ? selectedIds.length < 2 : !activeShipment)
                                    }
                                    className="px-3 py-2 rounded-md bg-indigo-600 text-white disabled:opacity-50"
                                >
                                    Save Services
                                </button>
                            </div>
                        </div>

                        <div className="flex flex-wrap gap-3">
                            <button
                                type="button"
                                onClick={fetchSummary}
                                disabled={
                                    checkoutLoading ||
                                    (isMultiCheckout ? selectedIds.length < 2 : !activeShipment)
                                }
                                className="px-4 py-2 rounded-md bg-gray-800 text-white disabled:opacity-50"
                            >
                                {isMultiCheckout ? 'Get batch summary (line items)' : 'Get Checkout Summary'}
                            </button>
                        </div>

                        {isMultiCheckout && batchSummaryView?.shipments?.length > 0 && (
                            <div className="border rounded-lg p-3 text-sm bg-gray-50 max-h-48 overflow-y-auto">
                                <p className="font-medium text-gray-900 mb-2">Batch line items</p>
                                <ul className="space-y-2">
                                    {batchSummaryView.shipments.map((row) => (
                                        <li key={row.shipInId} className="border-b border-gray-200 pb-2 last:border-0">
                                            <span className="text-xs text-gray-500">{row.shipInId}</span>
                                            <ul className="mt-1 ml-3 list-disc">
                                                {(row.items || []).map((it) => (
                                                    <li key={`${row.shipInId}-${it.productId}`}>
                                                        {it.name} × {it.qty}
                                                    </li>
                                                ))}
                                            </ul>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}

                        {isMultiCheckout && batchPriceSummary && (
                            <CheckoutPaymentPanel
                                key={`batch-checkout-${selectionKey}`}
                                checkoutMode="batch"
                                batchContext={{
                                    shipInIds: selectedIds,
                                    addressId: addressId.trim(),
                                    carrierName: lockedCarrierOption?.name || batchSelectedService || 'Selected carrier',
                                    carrierService: batchSelectedService || undefined,
                                    addonServices: addonServicesPayload(),
                                }}
                                summary={batchPriceSummary}
                                lockedCarrierOption={lockedCarrierOption}
                                disabled={checkoutLoading}
                                busy={checkoutLoading}
                                onBusyChange={setCheckoutLoading}
                                onPaidSuccess={handleCheckoutPaidSuccess}
                                onBatchPriceSummaryPatch={mergeBatchCouponPatch}
                            />
                        )}

                        {!isMultiCheckout && summary && activeShipment && (
                            <CheckoutPaymentPanel
                                key={`shipin-checkout-${activeShipment.id}`}
                                checkoutMode="shipin"
                                shipmentId={activeShipment.id}
                                summary={summary}
                                lockedCarrierOption={lockedCarrierOption}
                                disabled={checkoutLoading || !activeShipment}
                                busy={checkoutLoading}
                                onBusyChange={setCheckoutLoading}
                                onPaidSuccess={handleCheckoutPaidSuccess}
                                onCheckoutSummaryPatch={mergeShipInCouponPatch}
                            />
                        )}
                    </div>
                </div>

                <div className="mt-8 bg-white rounded-lg shadow p-6">
                    <h2 className="text-xl font-semibold text-gray-900 mb-4">Customer Information</h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <p className="text-sm text-gray-600">Name</p>
                            <p className="font-medium">{user.name}</p>
                        </div>
                        <div>
                            <p className="text-sm text-gray-600">Email</p>
                            <p className="font-medium">{user.email}</p>
                        </div>
                        <div>
                            <p className="text-sm text-gray-600">Phone</p>
                            <p className="font-medium">{user.phone}</p>
                        </div>
                        <div>
                            <p className="text-sm text-gray-600">Suite ID</p>
                            <p className="font-medium">{user.suiteId}</p>
                        </div>
                        <div>
                            <p className="text-sm text-gray-600">Member Since</p>
                            <p className="font-medium">{new Date(user.createdAt).toLocaleDateString()}</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Dashboard;
