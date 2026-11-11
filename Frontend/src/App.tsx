import { BrowserRouter, Route, Routes } from 'react-router'

import CategoryPage from './Pages/CategoryPage'
import CartPage from './Pages/CartPage'
import CheckoutDemoPage from './Pages/CheckoutDemoPage'
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
            <Route path="/carrinho" element={<CartPage />} />
            <Route path="/checkout-demo" element={<CheckoutDemoPage />} />
            <Route path="*" element={<RouteNotFoundPage />} />
          </Routes>
          {import.meta.env.DEV && <ApiHealthStatus />}
        </div>
      </CartProvider>
    </BrowserRouter>
  )
}

export default App
