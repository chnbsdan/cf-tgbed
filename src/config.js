/**
 * 配置管理模块
 */

export const defaultConfig = {
  domain: '',
  database: null,
  username: '',
  password: '',
  enableAuth: false,
  tgBotToken: '',
  tgChatId: '',
  cookie: 7,
  maxSizeMB: 20,
  chunkSize: 5 * 1024 * 1024
};

export function loadConfig(env) {
  return {
    domain: env.DOMAIN || '',
    database: env.DATABASE,
    username: env.USERNAME || '',
    password: env.PASSWORD || '',
    enableAuth: env.ENABLE_AUTH === 'true',
    tgBotToken: env.TG_BOT_TOKEN || '',
    tgChatId: env.TG_CHAT_ID || '',
    cookie: Number(env.COOKIE) || 7,
    maxSizeMB: Number(env.MAX_SIZE_MB) || 20,
    chunkSize: Number(env.CHUNK_SIZE) || 5 * 1024 * 1024
  };
}

export function getSafeConfig(config) {
  return {
    maxSizeMB: config.maxSizeMB,
    chunkSize: config.chunkSize
  };
}
