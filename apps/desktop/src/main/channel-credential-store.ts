import { randomUUID } from 'node:crypto'
import { chmod, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { safeStorage } from 'electron'

export interface FeishuAppCredential {
  appId: string
  appSecret: string
}

export interface ChannelCredentialStore {
  read(credentialRef: string): Promise<FeishuAppCredential | null>
  write(credentialRef: string, credential: FeishuAppCredential): Promise<void>
  delete(credentialRef: string): Promise<void>
}

export class SafeStorageChannelCredentialStore implements ChannelCredentialStore {
  readonly #root: string

  constructor(userDataPath: string) {
    this.#root = join(userDataPath, 'channel-credentials')
  }

  async read(credentialRef: string): Promise<FeishuAppCredential | null> {
    const path = this.#path(credentialRef)
    let encoded: string
    try {
      encoded = await readFile(path, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
    this.#requireEncryption()
    const plaintext = safeStorage.decryptString(Buffer.from(encoded, 'base64'))
    const parsed = JSON.parse(plaintext) as Partial<FeishuAppCredential>
    if (
      typeof parsed.appId !== 'string'
      || parsed.appId.length === 0
      || typeof parsed.appSecret !== 'string'
      || parsed.appSecret.length === 0
    ) {
      throw new Error('Stored Feishu credential is invalid')
    }
    return { appId: parsed.appId, appSecret: parsed.appSecret }
  }

  async write(credentialRef: string, credential: FeishuAppCredential): Promise<void> {
    this.#requireEncryption()
    const path = this.#path(credentialRef)
    await mkdir(dirname(path), { recursive: true, mode: 0o700 })
    const encrypted = safeStorage.encryptString(JSON.stringify(credential)).toString('base64')
    const temporaryPath = `${path}.${randomUUID()}.tmp`
    await writeFile(temporaryPath, encrypted, { encoding: 'utf8', mode: 0o600 })
    await chmod(temporaryPath, 0o600)
    await rename(temporaryPath, path)
  }

  async delete(credentialRef: string): Promise<void> {
    const path = this.#path(credentialRef)
    try {
      await unlink(path)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }

  #path(credentialRef: string): string {
    if (!/^feishu-[a-z0-9-]{1,96}$/.test(credentialRef)) {
      throw new Error('Invalid Feishu credential reference')
    }
    return join(this.#root, `${credentialRef}.bin`)
  }

  #requireEncryption(): void {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('System credential encryption is unavailable')
    }
  }
}
