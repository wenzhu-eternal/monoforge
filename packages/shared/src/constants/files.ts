// 文件上传限制（前后端共用，避免各自维护导致漂移）
export const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB

// 允许上传的扩展名白名单（后端 file-validator 与前端上传预检共用单一来源）
export const ALLOWED_EXTENSIONS = [
  'jpg',
  'jpeg',
  'png',
  'gif',
  'webp',
  'svg',
  'ico',
  'bmp',
  'pdf',
  'doc',
  'docx',
  'xls',
  'xlsx',
  'txt',
  'html',
  'css',
  'json',
  'mp4',
  'mp3',
  'wav',
  'zip',
  'rar',
  'sql',
]

// 分页默认值（前端各列表页共用，避免散落多处导致不一致）
export const DEFAULT_PAGE_SIZE = 10
