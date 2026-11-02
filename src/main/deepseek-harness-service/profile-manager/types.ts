/**
 * Profile 相关的纯类型声明。
 *
 * `DshProfileInfo` 需要注册进 `../type-info.ts`，
 *
 */
import type { ProfileSummary } from './profile-manager';

/**
 * 确认一个 Profile 能否被当作启动参数。
 *
 * - 目录还没建，dsh 会不会自动创建；
 * - dsh CLI 会不会直接拒绝这个名字。
 */
export interface BootableProfile extends ProfileSummary {
  /**
   * false 表示名字来自 dsh 随包模板（`PROFILE_TEMPLATES`），
   * 首次 `dsh --profile <名>` 时由 dsh 的 `loadProfile()` 自动创建。
   */
  materialized: boolean;
  /**
   * 非 null 表示 dsh CLI 拒绝启动它（如 `desktop`），值是给用户看的原因。
   */
  unavailableReason: string | null;
}
