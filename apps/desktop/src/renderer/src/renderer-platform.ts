type PlatformAttributeTarget = {
  setAttribute(name: string, value: string): void
}

export const RENDERER_PLATFORM_ATTRIBUTE = 'data-rovai-platform'

export function applyRendererPlatform(
  target: PlatformAttributeTarget,
  platform: NodeJS.Platform
): void {
  target.setAttribute(RENDERER_PLATFORM_ATTRIBUTE, platform)
}
