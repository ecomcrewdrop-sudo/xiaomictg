import { BrowserRouter, Routes, Route, Navigate, useLocation, Outlet } from 'react-router';
import { Header } from './components/Header';
import { Footer } from './components/Footer';

import { WhatsAppButton } from './components/WhatsAppButton';
import { SocialProof } from './components/SocialProof';
import { HomePage } from './components/pages/HomePage';
import { CategoryPage } from './components/pages/CategoryPage';
import { AdminPanel } from './components/pages/AdminPanel';
import { ProductDetailPage } from './components/pages/ProductDetailPage';
import { ProductProvider, useProducts } from './components/ProductContext';
import { ToastProvider } from './components/ToastContext';
import { LoginPage } from './components/pages/LoginPage';
import { AdminLinkGenerator } from './components/pages/AdminLinkGenerator';
import { DirectCheckoutPage } from './components/pages/DirectCheckoutPage';
import { useState, useEffect, useCallback, useRef } from 'react';
import { Toaster } from 'sonner';

import { Dashboard } from './components/pages/Blocking/Dashboard';
import { Devices } from './components/pages/Blocking/Devices';
import BlockingLogin from './components/pages/Blocking/Login';

/** Refresca datos de la tienda al navegar, pero con un TTL de 60s para no sobrecargar la BD */
function DataRefresher() {
  const location = useLocation();
  const { loadData } = useProducts();
  const lastFetchRef = useRef<number>(0);

  const refresh = useCallback(() => {
    const now = Date.now();
    // Solo refrescar si pasaron más de 60 segundos desde la última carga
    if (now - lastFetchRef.current > 60_000) {
      lastFetchRef.current = now;
      loadData();
    }
  }, [loadData]);

  useEffect(() => {
    refresh();
  }, [location.pathname, refresh]);

  return null;
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);

  useEffect(() => {
    const token = localStorage.getItem('adminToken');
    setIsAuthenticated(!!token);
  }, []);

  if (isAuthenticated === null) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return isAuthenticated ? <>{children}</> : <Navigate to="/login-admin" />;
}

function MainLayout({ children }: { children?: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-white flex flex-col">
      <Header />
      <main className="flex-1">
        {children ? children : <Outlet />}
      </main>
      <Footer />

      <WhatsAppButton />
      <SocialProof />
    </div>
  );
}

function App() {
  return (
    <ProductProvider>
      <ToastProvider>
        <BrowserRouter>
          {/* Toaster de sonner — notificaciones elegantes globales */}
          <Toaster
            position="bottom-right"
            richColors
            closeButton
            toastOptions={{
              duration: 4000,
              style: { fontFamily: 'inherit' },
            }}
          />

          <DataRefresher />
          <Routes>
            <Route path="/login-admin" element={<LoginPage />} />
            <Route path="/panel-gestion-xiaomi" element={
              <AdminRoute>
                <MainLayout>
                  <AdminPanel />
                </MainLayout>
              </AdminRoute>
            } />
            <Route path="/admin/gpedidos" element={
              <AdminRoute>
                <MainLayout>
                  <AdminLinkGenerator />
                </MainLayout>
              </AdminRoute>
            } />
            <Route path="/" element={
              <MainLayout>
                <HomePage />
              </MainLayout>
            } />
            <Route path="/comprar" element={
              <MainLayout>
                <DirectCheckoutPage />
              </MainLayout>
            } />
            <Route path="/moviles" element={
              <MainLayout>
                <CategoryPage category="moviles" />
              </MainLayout>
            } />
            <Route path="/smartwatch" element={
              <MainLayout>
                <CategoryPage category="smartwatch" />
              </MainLayout>
            } />
            <Route path="/audifonos" element={
              <MainLayout>
                <CategoryPage category="audifonos" />
              </MainLayout>
            } />
            <Route path="/tablet" element={
              <MainLayout>
                <CategoryPage category="tablet" />
              </MainLayout>
            } />
            <Route path="/accesorios" element={
              <MainLayout>
                <CategoryPage category="accesorios" />
              </MainLayout>
            } />
            <Route path="/scooter" element={
              <MainLayout>
                <CategoryPage category="scooter" />
              </MainLayout>
            } />
            <Route path="/poco" element={
              <MainLayout>
                <CategoryPage category="poco" />
              </MainLayout>
            } />
            <Route path="/product/:id" element={
              <MainLayout>
                <ProductDetailPage />
              </MainLayout>
            } />

            <Route path="/admin/blocking/login" element={<BlockingLogin />} />
            <Route path="/admin/blocking" element={
              <AdminRoute>
                <MainLayout>
                  <Dashboard />
                </MainLayout>
              </AdminRoute>
            } />
            <Route path="/admin/blocking/dashboard" element={
              <AdminRoute>
                <MainLayout>
                  <Dashboard />
                </MainLayout>
              </AdminRoute>
            } />
            <Route path="/admin/blocking/devices" element={
              <AdminRoute>
                <MainLayout>
                  <Devices />
                </MainLayout>
              </AdminRoute>
            } />

          </Routes>
        </BrowserRouter>
      </ToastProvider>
    </ProductProvider>
  );
}

export default App;
