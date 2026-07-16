import { z } from 'zod'

export const DashboardStatsSchema = z.object({
  totalUsers: z.number().int().nonnegative(),
  activeUsers: z.number().int().nonnegative(),
})

export type DashboardStats = z.infer<typeof DashboardStatsSchema>
