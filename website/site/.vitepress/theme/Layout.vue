<script setup lang="ts">
import { useData } from 'vitepress'
import { watch } from 'vue'

const { page } = useData()

watch(() => page.value.relativePath, (path) => {
  if (typeof document === 'undefined') return
  document.body.dataset.page = path.includes('docs/') ? 'docs' : path.includes('download/') ? 'download' : 'home'
  document.body.dataset.lang = path.startsWith('zh/') ? 'zh' : 'en'
}, { immediate: true })
</script>

<template>
  <Content />
</template>
