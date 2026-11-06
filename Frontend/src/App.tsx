import CategoryPage from './Pages/CategoryPage'
import ApiHealthStatus from './components/ApiHealthStatus'

function App() {
  return (
    <div className="font-poppins">
      <CategoryPage />
      {import.meta.env.DEV && <ApiHealthStatus />}
    </div>
  )
}

export default App
