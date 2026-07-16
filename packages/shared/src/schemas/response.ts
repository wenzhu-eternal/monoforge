import { z } from 'zod'
import { ErrorCodes } from '../constants/errors'

export const ApiResponseSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({
    code: z.number().int(),
    message: z.string(),
    data: dataSchema.nullable(),
  })

export const ErrorCodeSchema = z.enum(
  Object.keys(ErrorCodes) as [keyof typeof ErrorCodes, ...(keyof typeof ErrorCodes)[]],
)

export type ErrorCode = z.infer<typeof ErrorCodeSchema>
