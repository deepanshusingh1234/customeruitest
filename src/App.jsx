
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import PayPalReturn from './pages/PayPalReturn';
import PayPalVaultReturn from './pages/PayPalVaultReturn';
import PaymentSettingsPage from './pages/PaymentSettingsPage';
import { AuthProvider } from './contexts/AuthContext';

function App() {
  return (
    <Router>
      <AuthProvider>
        <Toaster position="top-right" />
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/settings/payment" element={<PaymentSettingsPage />} />
          <Route path="/paypal/success" element={<PayPalReturn />} />
          <Route path="/paypal/cancel" element={<PayPalReturn />} />
          <Route path="/paypal/vault/success" element={<PayPalVaultReturn />} />
          <Route path="/paypal/vault/cancel" element={<PayPalVaultReturn />} />
          <Route path="/" element={<Navigate to="/login" />} />
        </Routes>
      </AuthProvider>
    </Router>
  );
}

export default App;