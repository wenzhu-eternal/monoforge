import { HttpResponse, http } from 'msw'

const mockUser = {
  id: 1,
  username: 'admin',
  email: 'admin@example.com',
  nickname: 'Administrator',
  avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=admin',
  phone: '1234567890',
  status: true,
  roles: [
    {
      id: 1,
      name: 'admin',
      description: 'Administrator',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ],
  permissions: [
    'user:view',
    'user:create',
    'user:update',
    'user:delete',
    'role:view',
    'role:create',
    'role:update',
    'role:delete',
    'file:view',
    'file:upload',
  ],
  createdAt: new Date(),
  updatedAt: new Date(),
}

const mockUsers = [
  mockUser,
  {
    id: 2,
    username: 'user1',
    email: 'user1@example.com',
    nickname: 'User One',
    avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=user1',
    phone: '0987654321',
    status: true,
    roles: [
      {
        id: 2,
        name: 'user',
        description: 'Regular User',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
    permissions: ['user:view', 'file:view'],
    createdAt: new Date(),
    updatedAt: new Date(),
  },
]

export const handlers = [
  http.post('/api/v1/auth/login', async ({ request }) => {
    const body = (await request.json()) as { username: string; password: string }

    if (body.username === 'admin' && body.password === '123456') {
      return HttpResponse.json({
        code: 200,
        message: 'Success',
        data: {
          accessToken: 'mock-jwt-token-123456',
          refreshToken: 'mock-refresh-token-123456',
          user: mockUser,
        },
      })
    }

    return HttpResponse.json(
      {
        code: 401,
        message: 'Invalid username or password',
      },
      { status: 401 },
    )
  }),

  http.get('/api/v1/auth/me', ({ request }) => {
    const authHeader = request.headers.get('Authorization')

    if (!authHeader?.startsWith('Bearer ')) {
      return HttpResponse.json(
        {
          code: 401,
          message: 'Unauthorized',
        },
        { status: 401 },
      )
    }

    return HttpResponse.json({
      code: 200,
      message: 'Success',
      data: mockUser,
    })
  }),

  http.get('/api/v1/users', ({ request }) => {
    const authHeader = request.headers.get('Authorization')

    if (!authHeader?.startsWith('Bearer ')) {
      return HttpResponse.json(
        {
          code: 401,
          message: 'Unauthorized',
        },
        { status: 401 },
      )
    }

    const url = new URL(request.url)
    const page = Number(url.searchParams.get('page')) || 1
    const pageSize = Number(url.searchParams.get('pageSize')) || 10

    return HttpResponse.json({
      code: 200,
      message: 'Success',
      data: {
        list: mockUsers.slice((page - 1) * pageSize, page * pageSize),
        total: mockUsers.length,
        page,
        pageSize,
      },
    })
  }),

  http.post('/api/v1/users', async ({ request }) => {
    const authHeader = request.headers.get('Authorization')

    if (!authHeader?.startsWith('Bearer ')) {
      return HttpResponse.json(
        {
          code: 401,
          message: 'Unauthorized',
        },
        { status: 401 },
      )
    }

    const body = (await request.json()) as { username: string; email: string; password: string }

    const newUser = {
      id: mockUsers.length + 1,
      ...body,
      nickname: body.username,
      avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${body.username}`,
      phone: '',
      status: true,
      roles: [
        {
          id: 2,
          name: 'user',
          description: 'Regular User',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      permissions: ['user:view', 'file:view'],
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    mockUsers.push(newUser)

    return HttpResponse.json({
      code: 200,
      message: 'Success',
      data: newUser,
    })
  }),

  http.get('/api/v1/health', () => {
    return HttpResponse.json({
      code: 200,
      message: 'Success',
      data: {
        status: 'ok',
        timestamp: new Date().toISOString(),
      },
    })
  }),
]
