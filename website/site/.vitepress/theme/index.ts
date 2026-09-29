import type { Theme } from 'vitepress'
import Layout from './Layout.vue'
import { installInteractions } from './interactions'

export default {
  Layout,
  enhanceApp() {
    if (typeof document !== 'undefined') installInteractions()
  }
} satisfies Theme
