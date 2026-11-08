import { ImageOff } from 'lucide-react'
import { useEffect, useMemo, useReducer } from 'react'

import {
  createGalleryImages,
  createProductGalleryState,
  productGalleryReducer,
} from './product-gallery-state'

interface ProductGalleryProps {
  productName: string
  primaryUrl: string
  galleryUrls: string[]
}

export default function ProductGallery({
  productName,
  primaryUrl,
  galleryUrls,
}: ProductGalleryProps) {
  const images = useMemo(
    () => createGalleryImages({ primaryUrl, galleryUrls }),
    [galleryUrls, primaryUrl],
  )
  const mediaKey = images.join('\u0000')
  const [state, dispatch] = useReducer(
    productGalleryReducer,
    undefined,
    createProductGalleryState,
  )
  const selectedIndex = Math.min(state.selectedIndex, images.length - 1)
  const selectedUrl = images[selectedIndex]
  const selectedImageFailed = state.failedUrls.includes(selectedUrl)
  const imageDescription =
    images.length > 1
      ? `${productName} — imagem ${selectedIndex + 1} de ${images.length}`
      : productName

  useEffect(() => {
    dispatch({ type: 'reset' })
  }, [mediaKey])

  return (
    <section aria-label={`Galeria de ${productName}`}>
      <div className="aspect-square overflow-hidden rounded-3xl border border-gray-100 bg-white shadow-sm">
        {selectedImageFailed ? (
          <div
            role="img"
            aria-label={`Imagem indisponível de ${productName}`}
            className="flex h-full w-full flex-col items-center justify-center gap-3 bg-gray-100 text-gray-600"
          >
            <ImageOff aria-hidden="true" size={44} strokeWidth={1.5} />
            <span className="text-sm font-medium">Imagem indisponível</span>
          </div>
        ) : (
          <img
            src={selectedUrl}
            alt={imageDescription}
            className="h-full w-full object-cover"
            onError={() => dispatch({ type: 'fail', url: selectedUrl })}
          />
        )}
      </div>

      {images.length > 1 && (
        <div className="mt-4 grid grid-cols-4 gap-3 sm:grid-cols-5">
          {images.map((url, index) => {
            const hasFailed = state.failedUrls.includes(url)
            const isSelected = index === selectedIndex

            return (
              <button
                key={url}
                type="button"
                aria-label={`Exibir imagem ${index + 1} de ${images.length} de ${productName}`}
                aria-pressed={isSelected}
                onClick={() =>
                  dispatch({
                    type: 'select',
                    index,
                    imageCount: images.length,
                  })
                }
                className={`aspect-square overflow-hidden rounded-xl border-2 bg-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#527A36] focus-visible:ring-offset-2 ${
                  isSelected
                    ? 'border-[#527A36]'
                    : 'border-transparent hover:border-[#527A36]/50'
                }`}
              >
                {hasFailed ? (
                  <span className="flex h-full w-full items-center justify-center bg-gray-100 text-gray-600">
                    <ImageOff aria-hidden="true" size={20} />
                  </span>
                ) : (
                  <img
                    src={url}
                    alt=""
                    className="h-full w-full object-cover"
                    onError={() => dispatch({ type: 'fail', url })}
                  />
                )}
              </button>
            )
          })}
        </div>
      )}
    </section>
  )
}
