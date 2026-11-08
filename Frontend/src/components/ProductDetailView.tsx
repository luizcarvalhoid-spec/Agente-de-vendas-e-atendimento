import { AlertTriangle, ArrowLeft, Info, ShoppingBag, Star } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'

import type {
  BodyConcern,
  HairType,
  ProductCategory,
  ProductConcern,
  ProductDetailResponse,
  ProductIngredient,
  ProductSubcategory,
  RestrictionCode,
  ScalpType,
  SkinType,
} from '../api/contracts'
import ProductGallery from './ProductGallery'

const categoryLabels: Record<ProductCategory, string> = {
  shampoos: 'Shampoos',
  condicionadores: 'Condicionadores',
  mascaras: 'Máscaras',
  finalizadores: 'Finalizadores',
  sabonetes: 'Sabonetes',
  'oleos-corporais': 'Óleos corporais',
}

const subcategoryLabels: Record<ProductSubcategory, string> = {
  anticaspa: 'Anticaspa',
  antiqueda: 'Antiqueda',
  antirresiduos: 'Antirresíduos',
  'controle-de-oleosidade': 'Controle de oleosidade',
  hidratacao: 'Hidratação',
  nutricao: 'Nutrição',
  reconstrucao: 'Reconstrução',
  cachos: 'Cachos',
  'uso-diario': 'Uso diário',
  'protecao-termica': 'Proteção térmica',
  kit: 'Kit',
  barra: 'Barra',
  liquido: 'Líquido',
  relaxamento: 'Relaxamento',
  revitalizacao: 'Revitalização',
}

const hairTypeLabels: Record<HairType, string> = {
  todos: 'Todos os tipos',
  lisos: 'Lisos',
  ondulados: 'Ondulados',
  cacheados: 'Cacheados',
  crespos: 'Crespos',
}

const scalpTypeLabels: Record<ScalpType, string> = {
  todos: 'Todos os tipos',
  normal: 'Normal',
  seco: 'Seco',
  oleoso: 'Oleoso',
  sensivel: 'Sensível',
}

const productConcernLabels: Record<ProductConcern, string> = {
  caspa: 'Caspa',
  descamacao: 'Descamação',
  oleosidade: 'Oleosidade',
  ressecamento: 'Ressecamento',
  sensibilidade: 'Sensibilidade',
  'queda-e-quebra': 'Queda e quebra',
  frizz: 'Frizz',
  danos: 'Danos',
  'falta-de-brilho': 'Falta de brilho',
  'definicao-de-cachos': 'Definição de cachos',
  'acumulo-de-residuos': 'Acúmulo de resíduos',
}

const skinTypeLabels: Record<SkinType, string> = {
  todos: 'Todos os tipos',
  normal: 'Normal',
  seca: 'Seca',
  oleosa: 'Oleosa',
  mista: 'Mista',
  sensivel: 'Sensível',
}

const bodyConcernLabels: Record<BodyConcern, string> = {
  ressecamento: 'Ressecamento',
  sensibilidade: 'Sensibilidade',
  aspereza: 'Aspereza',
  'limpeza-suave': 'Limpeza suave',
  nutricao: 'Nutrição',
  relaxamento: 'Relaxamento',
  revitalizacao: 'Revitalização',
}

const restrictionLabels: Record<RestrictionCode, string> = {
  'evitar-couro-cabeludo-sensivel': 'Evitar em couro cabeludo sensível',
  'evitar-couro-cabeludo-seco': 'Evitar em couro cabeludo seco',
  'evitar-couro-cabeludo-oleoso': 'Evitar em couro cabeludo oleoso',
  'evitar-cabelos-coloridos': 'Evitar em cabelos coloridos',
  'evitar-cabelos-quimicamente-tratados':
    'Evitar em cabelos quimicamente tratados',
  'evitar-sensibilidade-a-fragrancia':
    'Evitar em caso de sensibilidade declarada a fragrâncias',
}

const priceFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
})

const numberFormatter = new Intl.NumberFormat('pt-BR', {
  maximumFractionDigits: 2,
})

interface ChipListProps {
  label: string
  values: string[]
}

function ChipList({ label, values }: ChipListProps) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-700">{label}</h3>
      <ul className="mt-2 flex flex-wrap gap-2">
        {values.map((value) => (
          <li
            key={value}
            className="rounded-full bg-[#f2f8ed] px-3 py-1.5 text-xs font-medium text-[#5f873f]"
          >
            {value}
          </li>
        ))}
      </ul>
    </div>
  )
}

interface FormulationDetailsProps {
  title: string
  ingredients: ProductIngredient[]
  usage: string
  restrictions: RestrictionCode[]
  warnings: string[]
  contraindications: string[]
}

function FormulationDetails({
  title,
  ingredients,
  usage,
  restrictions,
  warnings,
  contraindications,
}: FormulationDetailsProps) {
  return (
    <article className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm sm:p-6">
      <h3 className="text-lg font-semibold text-gray-900">{title}</h3>

      <div className="mt-5 grid gap-6 lg:grid-cols-2">
        <div>
          <h4 className="text-sm font-semibold text-gray-800">
            Ingredientes sintéticos de demonstração
          </h4>
          <ul className="mt-3 space-y-2 text-sm text-gray-600">
            {ingredients.map((ingredient) => (
              <li key={ingredient.id} className="flex gap-2">
                <span aria-hidden="true" className="text-[#8BB964]">
                  •
                </span>
                {ingredient.name}
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h4 className="text-sm font-semibold text-gray-800">
            Modo de uso demonstrativo
          </h4>
          <p className="mt-3 text-sm leading-relaxed text-gray-600">{usage}</p>
        </div>
      </div>

      <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4">
        <h4 className="flex items-center gap-2 text-sm font-semibold text-amber-900">
          <AlertTriangle aria-hidden="true" size={18} />
          Informações de segurança não avaliadas
        </h4>

        <div className="mt-4 grid gap-5 lg:grid-cols-3">
          <div>
            <h5 className="text-xs font-semibold uppercase tracking-wide text-amber-900">
              Advertências
            </h5>
            <ul className="mt-2 space-y-2 text-sm leading-relaxed text-amber-950/80">
              {warnings.map((warning) => (
                <li key={warning}>• {warning}</li>
              ))}
            </ul>
          </div>

          <div>
            <h5 className="text-xs font-semibold uppercase tracking-wide text-amber-900">
              Restrições registradas
            </h5>
            {restrictions.length > 0 ? (
              <ul className="mt-2 space-y-2 text-sm text-amber-950/80">
                {restrictions.map((restriction) => (
                  <li key={restriction}>• {restrictionLabels[restriction]}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm leading-relaxed text-amber-950/80">
                Nenhuma restrição específica foi registrada. Isso não comprova ausência de riscos.
              </p>
            )}
          </div>

          <div>
            <h5 className="text-xs font-semibold uppercase tracking-wide text-amber-900">
              Contraindicações registradas
            </h5>
            {contraindications.length > 0 ? (
              <ul className="mt-2 space-y-2 text-sm text-amber-950/80">
                {contraindications.map((contraindication) => (
                  <li key={contraindication}>• {contraindication}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm leading-relaxed text-amber-950/80">
                Nenhuma contraindicação específica foi registrada. Isso não comprova ausência de riscos.
              </p>
            )}
          </div>
        </div>
      </div>
    </article>
  )
}

function createCatalogUrl(
  category: ProductCategory,
  subcategory?: ProductSubcategory,
) {
  const params = new URLSearchParams({ category })
  if (subcategory) params.set('subcategory', subcategory)
  return `/?${params.toString()}`
}

function formatNetContent(value: number, unit: 'ml' | 'g') {
  return `${numberFormatter.format(value)} ${unit}`
}

interface ProductDetailViewProps {
  response: ProductDetailResponse
}

export default function ProductDetailView({ response }: ProductDetailViewProps) {
  const { item: product, media } = response
  const [purchaseMessage, setPurchaseMessage] = useState('')
  const discount = product.originalPrice
    ? Math.round((1 - product.price / product.originalPrice) * 100)
    : undefined

  useEffect(() => {
    setPurchaseMessage('')
  }, [product.slug])

  const compatibility =
    product.applicationArea === 'hair'
      ? [
          {
            label: 'Tipos de cabelo',
            values: product.hairTypes.map((value) => hairTypeLabels[value]),
          },
          {
            label: 'Tipos de couro cabeludo',
            values: product.scalpTypes.map((value) => scalpTypeLabels[value]),
          },
          {
            label: 'Necessidades',
            values: product.concerns.map((value) => productConcernLabels[value]),
          },
        ]
      : [
          {
            label: 'Tipos de pele',
            values: product.skinTypes.map((value) => skinTypeLabels[value]),
          },
          {
            label: 'Necessidades corporais',
            values: product.bodyConcerns.map((value) => bodyConcernLabels[value]),
          },
        ]

  return (
    <>
      <nav aria-label="Navegação estrutural" className="mb-6">
        <ol className="flex flex-wrap items-center gap-2 text-sm text-gray-500">
          <li>
            <Link className="hover:text-[#6f994c] hover:underline" to="/">
              Início
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li>
            <Link
              className="hover:text-[#6f994c] hover:underline"
              to={createCatalogUrl(product.category)}
            >
              {categoryLabels[product.category]}
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li>
            <Link
              className="hover:text-[#6f994c] hover:underline"
              to={createCatalogUrl(product.category, product.subcategory)}
            >
              {subcategoryLabels[product.subcategory]}
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li aria-current="page" className="font-medium text-gray-700">
            {product.name}
          </li>
        </ol>
      </nav>

      <section className="grid gap-8 lg:grid-cols-2 lg:items-start">
        <ProductGallery
          key={product.slug}
          productName={product.name}
          primaryUrl={media.primaryUrl}
          galleryUrls={media.galleryUrls}
        />

        <div className="rounded-3xl border border-gray-100 bg-white p-6 shadow-sm sm:p-8">
          <div className="flex flex-wrap gap-2">
            <span className="rounded-full bg-[#f2f8ed] px-3 py-1 text-xs font-semibold uppercase tracking-wide text-[#5f873f]">
              Catálogo demonstrativo
            </span>
            {product.productKind === 'kit' && (
              <span className="rounded-full bg-sky-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-sky-700">
                Kit
              </span>
            )}
          </div>

          <p className="mt-5 text-sm font-semibold uppercase tracking-wide text-[#6f994c]">
            {product.brand}
          </p>
          <h1 className="mt-2 text-3xl font-semibold leading-tight text-gray-900 sm:text-4xl">
            {product.name}
          </h1>
          {product.visibleLabelBrand && (
            <p className="mt-2 text-xs text-gray-500">
              Marca visível no rótulo: {product.visibleLabelBrand}
            </p>
          )}

          {product.rating !== undefined && product.reviews !== undefined && (
            <div
              className="mt-4 flex items-center gap-1"
              aria-label={`Avaliação ${product.rating} de 5, ${product.reviews} avaliações`}
            >
              {Array.from({ length: 5 }).map((_, index) => (
                <Star
                  key={index}
                  aria-hidden="true"
                  size={16}
                  className={
                    index < Math.floor(product.rating ?? 0)
                      ? 'fill-amber-400 text-amber-400'
                      : 'fill-gray-200 text-gray-200'
                  }
                />
              ))}
              <span className="ml-1 text-sm text-gray-500">
                ({product.reviews})
              </span>
            </div>
          )}

          <div className="mt-7 border-y border-gray-100 py-5">
            {product.originalPrice !== undefined && (
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm text-gray-400 line-through">
                  {priceFormatter.format(product.originalPrice)}
                </span>
                {discount !== undefined && discount > 0 && (
                  <span className="rounded-full bg-[#8BB964] px-2.5 py-1 text-xs font-semibold text-white">
                    -{discount}%
                  </span>
                )}
              </div>
            )}
            <p className="mt-1 text-3xl font-bold text-gray-900">
              {priceFormatter.format(product.price)}
            </p>
          </div>

          <dl className="mt-5 grid grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="text-gray-500">Disponibilidade</dt>
              <dd
                className={`mt-1 font-semibold ${
                  product.stock > 0 ? 'text-[#5f873f]' : 'text-red-600'
                }`}
              >
                {product.stock > 0
                  ? `Em estoque — ${product.stock} unidades demonstrativas`
                  : 'Esgotado no catálogo demonstrativo'}
              </dd>
            </div>
            {product.netContent && (
              <div>
                <dt className="text-gray-500">Conteúdo</dt>
                <dd className="mt-1 font-semibold text-gray-800">
                  {formatNetContent(
                    product.netContent.value,
                    product.netContent.unit,
                  )}
                </dd>
              </div>
            )}
            <div>
              <dt className="text-gray-500">Variante</dt>
              <dd className="mt-1 font-semibold text-gray-800">
                {product.variant.name}
              </dd>
            </div>
            {product.soapForm && (
              <div>
                <dt className="text-gray-500">Apresentação</dt>
                <dd className="mt-1 font-semibold text-gray-800">
                  {product.soapForm === 'bar' ? 'Sabonete em barra' : 'Sabonete líquido'}
                </dd>
              </div>
            )}
          </dl>

          <button
            type="button"
            disabled={product.stock === 0}
            onClick={() =>
              setPurchaseMessage(
                'Nenhum item foi adicionado. O carrinho será implementado em uma etapa futura.',
              )
            }
            className="mt-7 inline-flex w-full items-center justify-center gap-2 rounded-full bg-[#8BB964] px-6 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-[#7aa854] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8BB964] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-600"
          >
            <ShoppingBag aria-hidden="true" size={18} />
            {product.stock > 0
              ? 'Adicionar ao carrinho (demonstração)'
              : 'Produto esgotado'}
          </button>
          <p className="mt-3 text-center text-xs leading-relaxed text-gray-500">
            Experiência demonstrativa: nenhum pedido ou pagamento real será criado.
          </p>
          <p
            role="status"
            aria-live="polite"
            className="mt-3 min-h-5 text-center text-sm font-medium text-[#5f873f]"
          >
            {purchaseMessage}
          </p>
        </div>
      </section>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
          <h2 className="text-xl font-semibold text-gray-900">Sobre o produto</h2>
          <p className="mt-4 text-sm leading-7 text-gray-600">
            {product.description}
          </p>

          <h3 className="mt-6 text-sm font-semibold text-gray-800">Benefícios</h3>
          <ul className="mt-3 space-y-2 text-sm leading-relaxed text-gray-600">
            {product.benefits.map((benefit) => (
              <li key={benefit} className="flex gap-2">
                <span aria-hidden="true" className="text-[#8BB964]">
                  •
                </span>
                {benefit}
              </li>
            ))}
          </ul>

          <h3 className="mt-6 text-sm font-semibold text-gray-800">Indicações</h3>
          <ul className="mt-3 space-y-2 text-sm leading-relaxed text-gray-600">
            {product.indications.map((indication) => (
              <li key={indication} className="flex gap-2">
                <span aria-hidden="true" className="text-[#8BB964]">
                  •
                </span>
                {indication}
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
          <h2 className="text-xl font-semibold text-gray-900">
            Compatibilidade comercial
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-gray-500">
            Os perfis abaixo são posicionamentos demonstrativos e não representam avaliação dermatológica.
          </p>
          <div className="mt-5 space-y-5">
            {compatibility.map((group) => (
              <ChipList key={group.label} label={group.label} values={group.values} />
            ))}
            {product.variant.sensoryNotes && (
              <ChipList
                label="Notas sensoriais"
                values={product.variant.sensoryNotes}
              />
            )}
          </div>
        </section>
      </div>

      <section className="mt-8" aria-labelledby="formulation-heading">
        <div className="mb-5 rounded-2xl border border-sky-200 bg-sky-50 p-5">
          <h2
            id="formulation-heading"
            className="flex items-center gap-2 text-lg font-semibold text-sky-900"
          >
            <Info aria-hidden="true" size={20} />
            Dados demonstrativos da formulação
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-sky-900/80">
            Os ingredientes e modos de uso abaixo são dados sintéticos para testar a aplicação. Eles não representam a formulação fotografada e não autorizam recomendações reais de segurança.
          </p>
        </div>

        {product.productKind === 'single' ? (
          <FormulationDetails
            title="Informações do produto"
            ingredients={product.ingredients}
            usage={product.usage}
            restrictions={product.restrictions}
            warnings={product.warnings}
            contraindications={product.contraindications}
          />
        ) : (
          <div className="space-y-5">
            {product.kitContents.map((content, index) => (
              <div key={`${content.name}-${index}`}>
                <div className="mb-2 flex flex-wrap items-center gap-2 text-sm text-gray-600">
                  <span className="font-semibold text-gray-800">
                    {content.quantity}× {content.name}
                  </span>
                  {content.netContent && (
                    <span>
                      · {formatNetContent(content.netContent.value, content.netContent.unit)}
                    </span>
                  )}
                </div>
                <FormulationDetails
                  title={`Componente ${index + 1}: ${content.name}`}
                  ingredients={content.formulation.ingredients}
                  usage={content.formulation.usage}
                  restrictions={content.formulation.restrictions}
                  warnings={content.formulation.warnings}
                  contraindications={content.formulation.contraindications}
                />
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="mt-8">
        <Link
          to="/"
          className="inline-flex items-center justify-center rounded-full border-2 border-[#8BB964] px-5 py-2.5 text-sm font-semibold text-[#6f994c] transition-colors hover:bg-[#8BB964] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8BB964] focus-visible:ring-offset-2"
        >
          <ArrowLeft aria-hidden="true" className="mr-2" size={16} />
          Voltar à vitrine
        </Link>
      </div>
    </>
  )
}
