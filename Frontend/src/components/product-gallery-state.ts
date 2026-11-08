export interface ProductGalleryMedia {
  primaryUrl: string
  galleryUrls: string[]
}

export interface ProductGalleryState {
  selectedIndex: number
  failedUrls: string[]
}

export type ProductGalleryAction =
  | { type: 'select'; index: number; imageCount: number }
  | { type: 'fail'; url: string }
  | { type: 'reset' }

export function createGalleryImages(media: ProductGalleryMedia) {
  return [media.primaryUrl, ...media.galleryUrls]
}

export function createProductGalleryState(): ProductGalleryState {
  return { selectedIndex: 0, failedUrls: [] }
}

export function productGalleryReducer(
  state: ProductGalleryState,
  action: ProductGalleryAction,
): ProductGalleryState {
  if (action.type === 'reset') {
    return createProductGalleryState()
  }

  if (action.type === 'select') {
    if (action.index < 0 || action.index >= action.imageCount) {
      return state
    }

    return { ...state, selectedIndex: action.index }
  }

  if (state.failedUrls.includes(action.url)) {
    return state
  }

  return { ...state, failedUrls: [...state.failedUrls, action.url] }
}
