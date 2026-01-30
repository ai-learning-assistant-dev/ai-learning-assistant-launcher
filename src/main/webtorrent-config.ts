/**
 * WebTorrent 相关的统一配置（单位：毫秒，除非另有说明）
 */
export const WEBTORRENT_CONFIG = {
  // ============ 种子销毁与安装相关 ============
  /** 销毁种子后等待文件句柄释放的时间 */
  TORRENT_DESTROY_WAIT: 2000,
  /** 销毁种子回调的超时时间 */
  TORRENT_DESTROY_CALLBACK_TIMEOUT: 3000,

  // ============ 重试机制相关 ============
  /** 重试的基础等待时间 */
  RETRY_BASE_WAIT: 1000,
  /** 每次重试增加的等待时间 */
  RETRY_INCREMENT: 1000,
  /** 所有重试失败后的最终等待时间 */
  FINAL_RETRY_WAIT: 10000,
  /** 最大重试次数 */
  MAX_RETRIES: 8,

  // ============ 种子下载轮询相关 ============
  /** 检查种子完成状态的轮询间隔 */
  DOWNLOAD_CHECK_INTERVAL: 1000,
  /** 最大轮询次数（3600 = 1小时） */
  DOWNLOAD_MAX_ATTEMPTS: 3600,
  /** 输出进度信息的间隔次数（每 N 次输出一次） */
  DOWNLOAD_PROGRESS_LOG_INTERVAL: 10,

  // ============ 其他超时配置 ============
  /** LM Studio 安装检测命令超时时间 */
  LM_STUDIO_CHECK_TIMEOUT: 15000,
} as const;
