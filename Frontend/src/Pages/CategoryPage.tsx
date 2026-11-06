import Header from './Header'
import ProductCard, { type Product } from './ProductCard'
import ChatbotButton from './ChatbotButton'
import AnnouncementBar from './AnnouncementBar'

// Product images from assets
import antiCaspa from '../assets/Anti-caspa.jpg'
import antiQueda from '../assets/Anti-queda.jpg'
import antiResiduo from '../assets/Anti-residuo.jpg'
import controleOleo from '../assets/Controle de oliosidade.jpg'
import hidraLabels from '../assets/Change_name_to_HidraSplash_6b60b9a7_2K.jpg'
import shampooLabels from '../assets/Shampoo_label_design_for_curly_cd85cb03_2K.jpg'
import hidratante from '../assets/Change_product_label_name_and_64bdb95c_2K.jpg'
import shampooDesign from '../assets/Create_oil_control_shampoo_label_692b4bfd_2K.jpg'
import fireIcon from '../assets/Icons/fire_1f525.gif'

const products: Product[] = [
  {
    id: 1,
    name: 'Shampoo Anti-Caspa HidraSplash',
    shortDescription:
      'Fórmula avançada com zinco piritiona que combate a caspa e alivia o couro cabeludo sensível, deixando o cabelo limpo e sedoso.',
    image: antiCaspa,
    originalPrice: 59.9,
    price: 44.9,
    installments: 12,
    installmentValue: 3.74,
    discount: 25,
    rating: 4,
    reviews: 128,
  },
  {
    id: 2,
    name: 'Shampoo Anti-Queda Reconstrutor',
    shortDescription:
      'Enriquecido com biotina e queratina hidrolisada para fortalecer os fios desde a raiz e reduzir a queda capilar.',
    image: antiQueda,
    originalPrice: 69.9,
    price: 52.9,
    installments: 12,
    installmentValue: 4.41,
    discount: 24,
    rating: 5,
    reviews: 213,
  },
  {
    id: 3,
    name: 'Shampoo Anti-Resíduo Purificante',
    shortDescription:
      'Remove resíduos de produtos acumulados no couro cabeludo, devolvendo leveza e brilho natural aos cabelos.',
    image: antiResiduo,
    price: 39.9,
    installments: 10,
    installmentValue: 3.99,
    rating: 4,
    reviews: 87,
  },
  {
    id: 4,
    name: 'Shampoo Controle de Oleosidade',
    shortDescription:
      'Tecnologia balanceadora que regula a produção de sebo, mantendo o cabelo fresco e sem aspecto gorduroso por mais tempo.',
    image: controleOleo,
    originalPrice: 54.9,
    price: 42.9,
    installments: 12,
    installmentValue: 3.57,
    discount: 22,
    rating: 4,
    reviews: 95,
  },
  {
    id: 5,
    name: 'Shampoo Hidratação Profunda HidraSplash',
    shortDescription:
      'Com óleos de argan e abissínia que penetram nos fios para uma hidratação intensa e duradoura, perfeito para cabelos secos.',
    image: hidraLabels,
    originalPrice: 74.9,
    price: 57.9,
    installments: 12,
    installmentValue: 4.82,
    discount: 23,
    rating: 5,
    reviews: 304,
  },
  {
    id: 6,
    name: 'Shampoo Cachos Definidos',
    shortDescription:
      'Especialmente formulado para cabelos cacheados e crespos: define, hidrata e combate o frizz sem pesar nos fios.',
    image: shampooLabels,
    price: 48.9,
    installments: 10,
    installmentValue: 4.89,
    rating: 4,
    reviews: 176,
  },
  {
    id: 7,
    name: 'Shampoo Hidratante Nutritivo',
    shortDescription:
      'Enriquecido com manteiga de karité e proteínas do leite para nutrir profundamente cabelos ressecados e sem brilho.',
    image: hidratante,
    originalPrice: 62.9,
    price: 46.9,
    installments: 12,
    installmentValue: 3.91,
    discount: 25,
    rating: 5,
    reviews: 241,
  },
  {
    id: 8,
    name: 'Shampoo Reconstrutor Intensivo',
    shortDescription:
      'Tecnologia de reconstrução capilar com aminoácidos e colágeno que restaura o fio danificado de dentro para fora.',
    image: shampooDesign,
    originalPrice: 79.9,
    price: 59.9,
    installments: 12,
    installmentValue: 4.99,
    discount: 25,
    rating: 4,
    reviews: 189,
  },
]

export default function CategoryPage() {
  return (
    <div className="min-h-screen bg-gray-50 font-poppins">
      {/* Announcement Bar — hides on scroll down */}
      <AnnouncementBar />

      {/* Top Header */}
      <Header />

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

        {/* Category Title */}
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-1">
            <img src={fireIcon} alt="Destaque" className="w-7 h-7 sm:w-8 sm:h-8 object-contain" />
            <h1 className="text-2xl sm:text-3xl font-medium text-gray-900 tracking-tight">
              Produtos em destaque
            </h1>
          </div>
          <p className="text-sm text-gray-500 ml-9 sm:ml-10">
            {products.length} produtos encontrados
          </p>
        </div>

        {/* Filter Bar */}
        <div className="flex items-center gap-2 mb-6 overflow-x-auto pb-2 scrollbar-hide">
          {['Todos', 'Anti-Caspa', 'Anti-Queda', 'Hidratação', 'Cachos', 'Oleosidade'].map(
            (filter, idx) => (
              <button
                key={filter}
                className={`flex-shrink-0 px-4 py-1.5 rounded-full text-sm font-medium transition-all border ${
                  idx === 0
                    ? 'bg-[#8BB964] text-white border-[#8BB964] shadow-sm'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-[#8BB964] hover:text-[#8BB964]'
                }`}
              >
                {filter}
              </button>
            )
          )}
        </div>

        {/* Product Grid — 1 col → 2 → 4 */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5 sm:gap-6">
          {products.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>

        {/* Load More */}
        <div className="flex justify-center mt-10">
          <button className="px-8 py-3 border-2 border-[#8BB964] text-[#8BB964] rounded-full text-sm font-semibold hover:bg-[#8BB964] hover:text-white transition-all duration-200">
            Ver mais produtos
          </button>
        </div>
      </main>

      {/* Chatbot FAB */}
      <ChatbotButton />
    </div>
  )
}
