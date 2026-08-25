export const MACOS_SIGNING_POLICY = Object.freeze({
  appId: 'ai.rovai.desktop',
  authority: 'Rovai Release Signing',
  certificateRoot: '465802da7386e9676668078e7d44704cbbeadd1e',
  certificateSha256: '875C6F486E223AB1889A2AD63860FBE48F7E8C0E4D94832656896BA5DA4EF82E'
})

export function assertStableMacosSignature(label, {
  details,
  designatedRequirement,
  expectedIdentifier = null
}) {
  if (/^Signature=adhoc$/m.test(details)) {
    throw new Error(`${label} uses an ad-hoc signature`)
  }
  const authorities = [...details.matchAll(/^Authority=(.+)$/gm)]
    .map((match) => match[1].trim())
  if (!authorities.includes(MACOS_SIGNING_POLICY.authority)) {
    throw new Error(`${label} is missing Authority=${MACOS_SIGNING_POLICY.authority}`)
  }
  if (/designated\s*=>\s*cdhash\b/i.test(designatedRequirement)) {
    throw new Error(`${label} uses a CDHash-only designated requirement`)
  }

  const normalized = designatedRequirement.toLowerCase()
  const expectedRoot = `certificate root = h"${MACOS_SIGNING_POLICY.certificateRoot}"`
  if (!normalized.includes(expectedRoot)) {
    throw new Error(`${label} designated requirement has the wrong certificate root`)
  }
  if (
    expectedIdentifier
    && !normalized.includes(`identifier "${expectedIdentifier.toLowerCase()}"`)
  ) {
    throw new Error(`${label} designated requirement has the wrong identifier`)
  }
}
