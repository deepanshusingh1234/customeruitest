import React, { useState, useEffect, useCallback } from 'react';
import { Bell, Package, CheckCircle, AlertCircle } from 'lucide-react';
import api from '../lib/api';

const NotificationBell = () => {
    const [notifications, setNotifications] = useState([]);
    const [showDropdown, setShowDropdown] = useState(false);
    const [unreadCount, setUnreadCount] = useState(0);

    const formatTime = (createdAt) => {
        const d = new Date(createdAt);
        if (Number.isNaN(d.getTime())) return 'Just now';
        const mins = Math.max(0, Math.floor((Date.now() - d.getTime()) / 60000));
        if (mins < 1) return 'Just now';
        if (mins < 60) return `${mins} min ago`;
        const hrs = Math.floor(mins / 60);
        if (hrs < 24) return `${hrs} hr ago`;
        const days = Math.floor(hrs / 24);
        return `${days} day${days > 1 ? 's' : ''} ago`;
    };

    const mapType = (type) => {
        const t = String(type || '').toUpperCase();
        if (t === 'PAYMENT_COMPLETED') return 'success';
        if (t === 'PAYMENT_FAILED') return 'error';
        return 'info';
    };

    const loadNotifications = useCallback(async () => {
        try {
            const res = await api.get('/customer/notifications');
            const list = Array.isArray(res?.data) ? res.data : [];
            const mapped = list.map((n) => ({
                id: n.id,
                title: n.title,
                message: n.message,
                time: formatTime(n.createdAt),
                read: false,
                type: mapType(n.type),
            }));
            setNotifications(mapped);
            setUnreadCount(mapped.filter((n) => !n.read).length);
        } catch {
            setNotifications([]);
            setUnreadCount(0);
        }
    }, []);

    useEffect(() => {
        loadNotifications();
        const onExternalNotification = () => {
            loadNotifications();
        };
        window.addEventListener('customer-notification:new', onExternalNotification);
        return () => window.removeEventListener('customer-notification:new', onExternalNotification);
    }, [loadNotifications]);

    const markAsRead = (id) => {
        setNotifications(prev =>
            prev.map(notif =>
                notif.id === id ? { ...notif, read: true } : notif
            )
        );
        setUnreadCount(prev => Math.max(0, prev - 1));
    };

    const markAllAsRead = () => {
        setNotifications(prev =>
            prev.map(notif => ({ ...notif, read: true }))
        );
        setUnreadCount(0);
    };

    const getIcon = (type) => {
        switch (type) {
            case 'success':
                return <CheckCircle className="w-5 h-5 text-green-500" />;
            case 'info':
                return <Package className="w-5 h-5 text-blue-500" />;
            case 'error':
                return <AlertCircle className="w-5 h-5 text-red-500" />;
            default:
                return <Package className="w-5 h-5 text-gray-500" />;
        }
    };

    return (
        <div className="relative">
            <button
                onClick={() => setShowDropdown(!showDropdown)}
                className="relative p-2 rounded-lg hover:bg-gray-100 transition"
            >
                <Bell className="w-5 h-5 text-gray-600" />
                {unreadCount > 0 && (
                    <span className="absolute top-1 right-1 w-4 h-4 bg-red-500 text-white text-xs rounded-full flex items-center justify-center">
                        {unreadCount}
                    </span>
                )}
            </button>

            {showDropdown && (
                <>
                    <div
                        className="fixed inset-0 z-10"
                        onClick={() => setShowDropdown(false)}
                    />
                    <div className="absolute right-0 mt-2 w-80 bg-white rounded-lg shadow-xl z-20 border">
                        <div className="flex justify-between items-center p-4 border-b">
                            <h3 className="font-semibold text-gray-900">Notifications</h3>
                            {unreadCount > 0 && (
                                <button
                                    onClick={markAllAsRead}
                                    className="text-xs text-indigo-600 hover:text-indigo-700"
                                >
                                    Mark all as read
                                </button>
                            )}
                        </div>

                        <div className="max-h-96 overflow-y-auto">
                            {notifications.length === 0 ? (
                                <div className="p-4 text-center text-gray-500">
                                    No notifications
                                </div>
                            ) : (
                                notifications.map(notif => (
                                    <div
                                        key={notif.id}
                                        className={`p-3 border-b hover:bg-gray-50 cursor-pointer transition ${!notif.read ? 'bg-blue-50' : ''}`}
                                        onClick={() => markAsRead(notif.id)}
                                    >
                                        <div className="flex items-start space-x-3">
                                            <div className="flex-shrink-0">
                                                {getIcon(notif.type)}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm font-medium text-gray-900">
                                                    {notif.title}
                                                </p>
                                                <p className="text-xs text-gray-600 mt-1">
                                                    {notif.message}
                                                </p>
                                                <p className="text-xs text-gray-400 mt-1">
                                                    {notif.time}
                                                </p>
                                            </div>
                                            {!notif.read && (
                                                <div className="w-2 h-2 bg-blue-500 rounded-full flex-shrink-0 mt-1" />
                                            )}
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};

export default NotificationBell;