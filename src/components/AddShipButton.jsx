import React, { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { Truck, X, Plus, MapPin } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import api from '../lib/api';

/**
 * Opens a modal to list saved addresses and add a new shipping address.
 * Uses the same `api` client as checkout (Bearer from localStorage via interceptor).
 */
const AddShipButton = () => {
    const [showModal, setShowModal] = useState(false);
    const [addresses, setAddresses] = useState([]);
    const [loading, setLoading] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const { token } = useAuth();

    const [formData, setFormData] = useState({
        name: '',
        phone: '',
        address: '',
        city: '',
        state: '',
        country: 'CA',
        postalCode: '',
        isDefault: false,
    });

    useEffect(() => {
        if (showModal) {
            fetchAddresses();
        }
    }, [showModal]);

    const fetchAddresses = async () => {
        setLoading(true);
        try {
            const response = await api.get('/customer-auth/addresses', {
                headers: token ? { Authorization: `Bearer ${token}` } : {},
            });
            setAddresses(response.data.addresses || []);
        } catch (error) {
            console.error('Error fetching addresses:', error);
            toast.error(error.response?.data?.message || error.response?.data?.error || 'Failed to load addresses');
        } finally {
            setLoading(false);
        }
    };

    const handleInputChange = (e) => {
        const { name, value, type, checked } = e.target;
        setFormData((prev) => ({
            ...prev,
            [name]: type === 'checkbox' ? checked : value,
        }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setSubmitting(true);

        try {
            await api.post('/customer-auth/addresses', formData, {
                headers: token ? { Authorization: `Bearer ${token}` } : {},
            });

            toast.success('Address added successfully!');
            setShowModal(false);
            setFormData({
                name: '',
                phone: '',
                address: '',
                city: '',
                state: '',
                country: 'CA',
                postalCode: '',
                isDefault: false,
            });
            fetchAddresses();
        } catch (error) {
            toast.error(error.response?.data?.message || error.response?.data?.error || 'Failed to add address');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <>
            <button
                type="button"
                onClick={() => setShowModal(true)}
                className="flex items-center space-x-2 bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition"
            >
                <Truck className="w-4 h-4" />
                <span>Add shipping address</span>
            </button>

            {showModal && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
                        <div className="flex justify-between items-center p-6 border-b">
                            <div className="flex items-center space-x-2">
                                <Truck className="w-6 h-6 text-indigo-600" />
                                <h2 className="text-2xl font-bold text-gray-900">Add shipping address</h2>
                            </div>
                            <button
                                type="button"
                                onClick={() => setShowModal(false)}
                                className="text-gray-400 hover:text-gray-600"
                            >
                                <X className="w-6 h-6" />
                            </button>
                        </div>

                        {addresses.length > 0 && (
                            <div className="p-6 border-b">
                                <h3 className="font-semibold text-gray-900 mb-3 flex items-center">
                                    <MapPin className="w-4 h-4 mr-2" />
                                    Your addresses
                                </h3>
                                <div className="space-y-2">
                                    {addresses.map((addr) => (
                                        <div key={addr.id} className="p-3 bg-gray-50 rounded-lg">
                                            <p className="font-medium">{addr.name}</p>
                                            <p className="text-sm text-gray-600">{addr.address}</p>
                                            <p className="text-sm text-gray-600">
                                                {addr.city}, {addr.state} {addr.postalCode}
                                            </p>
                                            {addr.isDefault && (
                                                <span className="inline-block mt-1 text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded">
                                                    Default
                                                </span>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {loading && (
                            <p className="px-6 py-2 text-sm text-gray-500">Loading addresses…</p>
                        )}

                        <form onSubmit={handleSubmit} className="p-6">
                            <h3 className="font-semibold text-gray-900 mb-4">New address</h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                        Full name *
                                    </label>
                                    <input
                                        type="text"
                                        name="name"
                                        value={formData.name}
                                        onChange={handleInputChange}
                                        required
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                        Phone *
                                    </label>
                                    <input
                                        type="tel"
                                        name="phone"
                                        value={formData.phone}
                                        onChange={handleInputChange}
                                        required
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                                    />
                                </div>

                                <div className="md:col-span-2">
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                        Street address *
                                    </label>
                                    <input
                                        type="text"
                                        name="address"
                                        value={formData.address}
                                        onChange={handleInputChange}
                                        required
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                        City *
                                    </label>
                                    <input
                                        type="text"
                                        name="city"
                                        value={formData.city}
                                        onChange={handleInputChange}
                                        required
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                        State / province *
                                    </label>
                                    <input
                                        type="text"
                                        name="state"
                                        value={formData.state}
                                        onChange={handleInputChange}
                                        required
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                        Country *
                                    </label>
                                    <input
                                        type="text"
                                        name="country"
                                        value={formData.country}
                                        onChange={handleInputChange}
                                        required
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                        Postal code *
                                    </label>
                                    <input
                                        type="text"
                                        name="postalCode"
                                        value={formData.postalCode}
                                        onChange={handleInputChange}
                                        required
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                                    />
                                </div>

                                <div className="md:col-span-2">
                                    <label className="flex items-center space-x-2">
                                        <input
                                            type="checkbox"
                                            name="isDefault"
                                            checked={formData.isDefault}
                                            onChange={handleInputChange}
                                            className="rounded text-indigo-600 focus:ring-indigo-500"
                                        />
                                        <span className="text-sm text-gray-700">Set as default address</span>
                                    </label>
                                </div>
                            </div>

                            <div className="flex justify-end space-x-3 mt-6">
                                <button
                                    type="button"
                                    onClick={() => setShowModal(false)}
                                    className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={submitting}
                                    className="flex items-center space-x-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                                >
                                    <Plus className="w-4 h-4" />
                                    <span>{submitting ? 'Adding…' : 'Save address'}</span>
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </>
    );
};

export default AddShipButton;
