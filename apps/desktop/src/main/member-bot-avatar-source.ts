import { readFile } from 'node:fs/promises'
import {
  MEMBER_AVATAR_LIMITS,
  parseControlledMemberAvatarRef,
  type BuiltinMemberAvatarRole
} from '@contracts'
import luokeIconPath from '../renderer/src/assets/characters/luoke/icon-192.png?asset'
import mianzhiIconPath from '../renderer/src/assets/characters/mianzhi/icon-192.png?asset'
import muwaIconPath from '../renderer/src/assets/characters/muwa/icon-192.png?asset'
import qiluIconPath from '../renderer/src/assets/characters/qilu/icon-192.png?asset'
import type { MemberBotAvatarSource } from './feishu-member-bot-provisioner'
import { inspectPng, type MemberAvatarAssetService } from './member-avatar-assets'

export interface MemberBotAvatarSourceResolver {
  resolve(avatarRef: string | null): Promise<MemberBotAvatarSource | undefined>
}

type ReadBuiltinAvatar = (role: BuiltinMemberAvatarRole) => Promise<Uint8Array>

const BUILTIN_ICON_PATHS: Readonly<Record<BuiltinMemberAvatarRole, string>> = {
  luoke: luokeIconPath,
  muwa: muwaIconPath,
  mianzhi: mianzhiIconPath,
  qilu: qiluIconPath
}

export class ControlledMemberBotAvatarSourceResolver implements MemberBotAvatarSourceResolver {
  readonly #managedAvatars: Pick<MemberAvatarAssetService, 'read'>
  readonly #readBuiltinAvatar: ReadBuiltinAvatar

  constructor(
    managedAvatars: Pick<MemberAvatarAssetService, 'read'>,
    readBuiltinAvatar: ReadBuiltinAvatar = readPackagedBuiltinAvatar
  ) {
    this.#managedAvatars = managedAvatars
    this.#readBuiltinAvatar = readBuiltinAvatar
  }

  async resolve(avatarRef: string | null): Promise<MemberBotAvatarSource | undefined> {
    if (avatarRef === null) return undefined
    const parsed = parseControlledMemberAvatarRef(avatarRef)
    if (!parsed) throw new Error('feishu_member_bot_avatar_ref_invalid')

    if (parsed.kind === 'managed') {
      const rendition = await this.#managedAvatars.read(avatarRef, 'icon')
      if (!rendition) throw new Error('feishu_member_bot_avatar_unavailable')
      return {
        pngBytes: rendition.bytes,
        width: rendition.width,
        height: rendition.height
      }
    }

    const bytes = await this.#readBuiltinAvatar(parsed.role)
    let inspection: ReturnType<typeof inspectPng>
    try {
      inspection = inspectPng(bytes)
    } catch {
      throw new Error('feishu_member_bot_avatar_unavailable')
    }
    if (
      inspection.width !== MEMBER_AVATAR_LIMITS.iconEdge
      || inspection.height !== MEMBER_AVATAR_LIMITS.iconEdge
    ) throw new Error('feishu_member_bot_avatar_unavailable')
    return {
      pngBytes: bytes,
      width: inspection.width,
      height: inspection.height
    }
  }
}

async function readPackagedBuiltinAvatar(role: BuiltinMemberAvatarRole): Promise<Uint8Array> {
  try {
    return new Uint8Array(await readFile(BUILTIN_ICON_PATHS[role]))
  } catch {
    throw new Error('feishu_member_bot_avatar_unavailable')
  }
}
