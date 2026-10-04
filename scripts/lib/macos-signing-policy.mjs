export const MACOS_SIGNING_POLICY = Object.freeze({
  appId: 'ai.rovai.desktop',
  authorityPrefix: 'Developer ID Application:',
  intermediateAuthority: 'Developer ID Certification Authority',
  rootAuthorityPrefix: 'Apple Root CA'
})

export function assertAdhocMacosSignature(label, {
  details,
  designatedRequirement
}) {
  if (!/^Signature=adhoc$/m.test(details)) {
    throw new Error(`${label} is not ad-hoc signed`)
  }
  if (/^Authority=/m.test(details)) {
    throw new Error(`${label} ad-hoc signature unexpectedly has a certificate authority`)
  }
  if (!/designated\s*=>\s*cdhash\b/i.test(designatedRequirement)) {
    throw new Error(`${label} ad-hoc signature is missing a CDHash designated requirement`)
  }
}

export function assertStableMacosSignature(label, {
  details,
  designatedRequirement,
  expectedIdentifier = null,
  expectedTeamId
}) {
  if (!/^[A-Z0-9]{10}$/.test(expectedTeamId ?? '')) {
    throw new Error('MAC_RELEASE_TEAM_ID must be a 10-character Apple Developer Team ID')
  }
  if (/^Signature=adhoc$/m.test(details)) {
    throw new Error(`${label} uses an ad-hoc signature`)
  }
  const authorities = [...details.matchAll(/^Authority=(.+)$/gm)]
    .map((match) => match[1].trim())
  if (!authorities[0]?.startsWith(`${MACOS_SIGNING_POLICY.authorityPrefix} `)
      || !authorities[0].endsWith(`(${expectedTeamId})`)
      || !authorities.includes(MACOS_SIGNING_POLICY.intermediateAuthority)
      || !authorities.some((authority) => authority.startsWith(MACOS_SIGNING_POLICY.rootAuthorityPrefix))) {
    throw new Error(`${label} does not have the expected Apple Developer ID authority chain`)
  }
  if (!details.split('\n').includes(`TeamIdentifier=${expectedTeamId}`)) {
    throw new Error(`${label} has the wrong Apple Developer Team ID`)
  }
  if (!/^CodeDirectory\b.*\([^)]*\bruntime\b/m.test(details)) {
    throw new Error(`${label} is missing Hardened Runtime`)
  }
  if (!/^Timestamp=.+$/m.test(details)) {
    throw new Error(`${label} is missing a secure signing timestamp`)
  }
  if (/designated\s*=>\s*cdhash\b/i.test(designatedRequirement)) {
    throw new Error(`${label} uses a CDHash-only designated requirement`)
  }

  const normalized = designatedRequirement.toLowerCase()
    .replaceAll('/* exists */', 'exists')
  if (!normalized.includes('anchor apple generic')
      || !normalized.includes('certificate 1[field.1.2.840.113635.100.6.2.6] exists')
      || !normalized.includes('certificate leaf[field.1.2.840.113635.100.6.1.13] exists')) {
    throw new Error(`${label} designated requirement does not require an Apple Developer ID certificate`)
  }
  const teamRequirement = new RegExp(`certificate\\s+leaf\\[subject\\.ou\\]\\s*=\\s*"?${expectedTeamId.toLowerCase()}"?(?:\\s|$)`)
  if (!teamRequirement.test(normalized)) {
    throw new Error(`${label} designated requirement has the wrong Apple Developer Team ID`)
  }
  if (
    expectedIdentifier
    && !normalized.includes(`identifier "${expectedIdentifier.toLowerCase()}"`)
  ) {
    throw new Error(`${label} designated requirement has the wrong identifier`)
  }
}
