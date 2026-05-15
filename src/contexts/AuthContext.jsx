import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import api, {
    registerSessionRefreshed,
    runSharedRefresh,
    clearAuthStorage,
    forceLogoutAndRedirect,
} from '../lib/api';

const AuthContext = createContext();

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error('useAuth must be used within AuthProvider');
    }
    return context;
};

const applySession = (customer, accessToken, setUser, setToken) => {
    if (accessToken) {
        setToken(accessToken);
        api.defaults.headers.common.Authorization = `Bearer ${accessToken}`;
    }
    if (customer) {
        setUser(customer);
    }
    if (accessToken === null && customer === null) {
        setUser(null);
        setToken(null);
    }
};

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const [token, setToken] = useState(() => localStorage.getItem('accessToken'));
    const [loading, setLoading] = useState(true);

    const clearSession = useCallback(() => {
        clearAuthStorage();
        setUser(null);
        setToken(null);
    }, []);

    useEffect(() => {
        registerSessionRefreshed(({ customer, accessToken }) => {
            if (accessToken === null && customer === null) {
                setUser(null);
                setToken(null);
                return;
            }
            applySession(customer, accessToken, setUser, setToken);
        });
        return () => registerSessionRefreshed(null);
    }, []);

    useEffect(() => {
        const bootstrap = async () => {
            const path = window.location.pathname.replace(/\/$/, '') || '/';
            if (path === '/login') {
                setLoading(false);
                return;
            }

            const storedToken = localStorage.getItem('accessToken');
            const storedUser = localStorage.getItem('user');
            const hadSession = Boolean(storedToken || storedUser);

            if (storedToken) {
                api.defaults.headers.common.Authorization = `Bearer ${storedToken}`;
            }
            if (storedUser) {
                try {
                    setUser(JSON.parse(storedUser));
                } catch {
                    localStorage.removeItem('user');
                }
            }

            try {
                const res = await runSharedRefresh();
                applySession(res.data?.customer, res.data?.accessToken, setUser, setToken);
            } catch {
                if (hadSession) {
                    clearSession();
                    forceLogoutAndRedirect();
                }
            } finally {
                setLoading(false);
            }
        };

        void bootstrap();
    }, [clearSession]);

    useEffect(() => {
        if (token) {
            api.defaults.headers.common.Authorization = `Bearer ${token}`;
        }
    }, [token]);

    const login = async (email, password) => {
        try {
            const response = await api.post('/customer/auth/login', {
                email,
                password,
            });

            const { customer, accessToken } = response.data;
            applySession(customer, accessToken, setUser, setToken);
            localStorage.setItem('accessToken', accessToken);
            localStorage.setItem('user', JSON.stringify(customer));

            return { success: true, data: response.data };
        } catch (error) {
            return {
                success: false,
                error: error.response?.data?.error || error.response?.data?.message || 'Login failed',
            };
        }
    };

    const logout = async () => {
        try {
            await api.post('/customer/auth/logout');
        } catch {
            // Still clear local session if server logout fails
        }
        clearSession();
    };

    const value = {
        user,
        token,
        login,
        logout,
        loading,
    };

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
};
