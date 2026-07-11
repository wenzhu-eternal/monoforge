import { UpdateRolePermissionsSchema } from '@shared/schemas/permission'
import { createZodDto } from 'nestjs-zod'

export class UpdateRolePermissionsDto extends createZodDto(UpdateRolePermissionsSchema) {}
