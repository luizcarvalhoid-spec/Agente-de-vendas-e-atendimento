import { BrowserRouter, Route, Routes } from 'react-router'

import CategoryPage from './Pages/CategoryPage'
import DeferredFeaturePage from './Pages/DeferredFeaturePage'
import ProductRoutePage from './Pages/ProductRoutePage'
import RouteNotFoundPage from './Pages/RouteNotFoundPage'
import ApiHealthStatus from './components/ApiHealthStatus'
import RouteFocusManager from './components/RouteFocusManager'

function App() {
  return (
    <BrowserRouter>
      <div className="font-poppins">
        <RouteFocusManager />
        <Routes>
          <Route path="/" element={<CategoryPage />} />
          <Route path="/produtos/:slug" element={<ProductRoutePage />} />
          <Route
            path="/carrinho"
            element={
              <DeferredFeaturePage
                title="Carrinho"
                description="O carrinho demonstrativo será disponibilizado em uma etapa futura do projeto. Nenhum pedido é criado nesta página."
                relatedLink={{
                  to: '/checkout-demo',
                  label: 'Visualizar placeholder do checkout',
                }}
              />
            }
          />
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
    </BrowserRouter>
  )
}

export default App
