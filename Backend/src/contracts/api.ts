import { z } from 'zod'

export const apiErrorCodeSchema = z.enum([
  'VALIDATION_ERROR',
  'NOT_FOUND',
  'HTTP_ERROR',
  'INTERNAL_SERVER_ERROR',
])

export const apiErrorSchema = z.object({
  code: apiErrorCodeSchema,
  message: z.string().min(1),
})

export type ApiError = z.infer<typeof apiErrorSchema>

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.literal('hidrasplash-api'),
  version: z.literal('0.1.0-demo'),
})

export type HealthResponse = z.infer<typeof healthResponseSchema>
