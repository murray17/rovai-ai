import { validateV034AcceptanceRegistry } from './lib/qualification-acceptance-v034.mjs'

console.log(JSON.stringify(await validateV034AcceptanceRegistry(), null, 2))
