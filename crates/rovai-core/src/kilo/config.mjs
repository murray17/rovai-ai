// Kilo merges all native configuration sources before invoking config hooks.
// Its last matching rule wins, so the product default must precede native rules.
export default async () => ({
  config: async (config) => {
    const { '*': _default, question: _question, ...rules } = config.permission ?? {}
    config.permission = { '*': __ROVAI_PERMISSION__, ...rules, question: 'deny' }
  }
})
