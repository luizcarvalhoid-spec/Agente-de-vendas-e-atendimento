import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createGalleryImages,
  createProductGalleryState,
  productGalleryReducer,
} from '../src/components/product-gallery-state.ts'

test('gallery supports one image without creating additional media', () => {
  const images = createGalleryImages({
    primaryUrl: 'http://api.test/images/main.jpg',
    galleryUrls: [],
  })

  assert.deepEqual(images, ['http://api.test/images/main.jpg'])
  assert.deepEqual(createProductGalleryState(), {
    selectedIndex: 0,
    failedUrls: [],
  })
})

test('gallery selects simulated additional images and resets failures', () => {
  const images = createGalleryImages({
    primaryUrl: 'http://api.test/images/main.jpg',
    galleryUrls: [
      'http://api.test/images/detail-1.jpg',
      'http://api.test/images/detail-2.jpg',
    ],
  })
  let state = createProductGalleryState()

  assert.equal(images.length, 3)

  state = productGalleryReducer(state, {
    type: 'select',
    index: 2,
    imageCount: images.length,
  })
  state = productGalleryReducer(state, {
    type: 'fail',
    url: images[2],
  })

  assert.deepEqual(state, {
    selectedIndex: 2,
    failedUrls: ['http://api.test/images/detail-2.jpg'],
  })

  assert.deepEqual(productGalleryReducer(state, { type: 'reset' }), {
    selectedIndex: 0,
    failedUrls: [],
  })
})
