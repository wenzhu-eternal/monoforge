import { CreatePermissionSchema, UpdatePermissionSchema } from '@shared/schemas/permission'
import { createZodDto } from 'nestjs-zod'

export class CreatePermissionDto extends createZodDto(CreatePermissionSchema) {}

export class UpdatePermissionDto extends createZodDto(UpdatePermissionSchema) {}
