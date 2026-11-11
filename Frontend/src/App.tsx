import { BrowserRouter, Route, Routes } from 'react-router'

import CategoryPage from './Pages/CategoryPage'
import CartDeferredPage from './Pages/CartDeferredPage'
import DeferredFeaturePage from './Pages/DeferredFeaturePage'
import ProductRoutePage from './Pages/ProductRoutePage'
import RouteNotFoundPage from './Pages/RouteNotFoundPage'
import ApiHealthStatus from './components/ApiHealthStatus'
import RouteFocusManager from './components/RouteFocusManager'
import CartProvider from './cart/CartProvider'

function App() {
  return (
    <BrowserRouter>
      <CartProvider>
        <div className="font-poppins">
          <RouteFocusManager />
          <Routes>
            <Route path="/" element={<CategoryPage />} />
            <Route path="/produtos/:slug" element={<ProductRoutePage />} />
            <Route path="/carrinho" element={<CartDeferredPage />} />
            <Route
              path="/checkout-demo"
              element={
                <DeferredFeaturePage
                  title="Checkout demonstrativo"
                  description="Este checkout é apenas uma demonstração planejada. Nenhum pagamento ou pedido real é processado."
                />
              }
            />
            <Route path="*" element={<RouteNotFoundPage />} />
          </Routes>
          {import.meta.env.DEV && <ApiHealthStatus />}
        </div>
      </CartProvider>
    </BrowserRouter>
  )
}

export default App
