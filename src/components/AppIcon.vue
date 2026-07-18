<script setup lang="ts">
export type AppIconName =
  | 'alert'
  | 'archive'
  | 'arrow-down'
  | 'arrow-up'
  | 'bot'
  | 'check'
  | 'code'
  | 'eraser'
  | 'external'
  | 'files'
  | 'folder'
  | 'git-branch'
  | 'git-clone'
  | 'home'
  | 'more'
  | 'play'
  | 'plus'
  | 'refresh'
  | 'search'
  | 'settings'
  | 'sparkles'
  | 'square'
  | 'terminal'
  | 'trash'
  | 'x'

defineProps<{ name: AppIconName; size?: number }>()
</script>

<template>
  <svg
    class="app-icon"
    :width="size ?? 18"
    :height="size ?? 18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <template v-if="name === 'alert'">
      <path d="M10.3 3.6 2.4 17.5A2 2 0 0 0 4.1 20h15.8a2 2 0 0 0 1.7-2.5L13.7 3.6a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </template>
    <template v-else-if="name === 'archive'">
      <path d="M4 7v12h16V7" />
      <path d="M3 3h18v4H3z" />
      <path d="M9 11h6" />
    </template>
    <template v-else-if="name === 'arrow-down'">
      <path d="M12 4v16" />
      <path d="m6 14 6 6 6-6" />
    </template>
    <template v-else-if="name === 'arrow-up'">
      <path d="M12 20V4" />
      <path d="m6 10 6-6 6 6" />
    </template>
    <template v-else-if="name === 'bot'">
      <rect x="4" y="7" width="16" height="12" rx="3" />
      <path d="M12 3v4" />
      <path d="M8 12h.01M16 12h.01" />
      <path d="M8 16h8" />
    </template>
    <template v-else-if="name === 'check'">
      <path d="m5 12 4 4L19 6" />
    </template>
    <template v-else-if="name === 'code'">
      <path d="m8 9-4 3 4 3" />
      <path d="m16 9 4 3-4 3" />
      <path d="m14 5-4 14" />
    </template>
    <template v-else-if="name === 'eraser'">
      <path d="m7 20-4-4L14.5 4.5a2.1 2.1 0 0 1 3 0l2 2a2.1 2.1 0 0 1 0 3L9 20Z" />
      <path d="m11 8 5 5" />
      <path d="M7 20h13" />
    </template>
    <template v-else-if="name === 'external'">
      <path d="M14 4h6v6" />
      <path d="m20 4-9 9" />
      <path d="M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6" />
    </template>
    <template v-else-if="name === 'files'">
      <path d="M14 2H6a2 2 0 0 0-2 2v12" />
      <path d="M14 2v6h6" />
      <path d="M14 2l6 6v12a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V7" />
    </template>
    <template v-else-if="name === 'folder'">
      <path d="M3 6a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
      <path d="M3 10h18" />
    </template>
    <template v-else-if="name === 'git-branch'">
      <circle cx="6" cy="5" r="2" />
      <circle cx="18" cy="6" r="2" />
      <circle cx="6" cy="19" r="2" />
      <path d="M6 7v10" />
      <path d="M8 15c6 0 8-3 8-7" />
    </template>
    <template v-else-if="name === 'git-clone'">
      <circle cx="6" cy="5" r="2" />
      <circle cx="6" cy="19" r="2" />
      <path d="M6 7v10" />
      <path d="M12 6h6a2 2 0 0 1 2 2v4" />
      <path d="m16 10 4 4 4-4" transform="translate(-2 0)" />
    </template>
    <template v-else-if="name === 'home'">
      <path d="m3 11 9-8 9 8" />
      <path d="M5 10v10h14V10" />
      <path d="M9 20v-6h6v6" />
    </template>
    <template v-else-if="name === 'more'">
      <circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" />
    </template>
    <template v-else-if="name === 'play'">
      <path d="m9 7 8 5-8 5Z" fill="currentColor" stroke="none" />
    </template>
    <template v-else-if="name === 'plus'">
      <path d="M12 5v14M5 12h14" />
    </template>
    <template v-else-if="name === 'refresh'">
      <path d="M20 6v5h-5" />
      <path d="M4 18v-5h5" />
      <path d="M6.1 9a7 7 0 0 1 11.5-2.6L20 9M4 15l2.4 2.6A7 7 0 0 0 17.9 15" />
    </template>
    <template v-else-if="name === 'search'">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-4-4" />
    </template>
    <template v-else-if="name === 'settings'">
      <circle cx="12" cy="12" r="3" />
      <path
        d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"
      />
    </template>
    <template v-else-if="name === 'sparkles'">
      <path d="m12 3 1.2 3.8L17 8l-3.8 1.2L12 13l-1.2-3.8L7 8l3.8-1.2Z" />
      <path d="m18.5 14 .7 2.3 2.3.7-2.3.7-.7 2.3-.7-2.3-2.3-.7 2.3-.7Z" />
      <path d="m5 14 .7 2.3 2.3.7-2.3.7L5 20l-.7-2.3L2 17l2.3-.7Z" />
    </template>
    <template v-else-if="name === 'square'">
      <rect x="7" y="7" width="10" height="10" rx="1" fill="currentColor" stroke="none" />
    </template>
    <template v-else-if="name === 'terminal'">
      <path d="m4 7 5 5-5 5" />
      <path d="M12 17h8" />
    </template>
    <template v-else-if="name === 'trash'">
      <path d="M4 7h16" />
      <path d="M9 7V4h6v3" />
      <path d="m7 7 1 13h8l1-13" />
      <path d="M10 11v5M14 11v5" />
    </template>
    <template v-else-if="name === 'x'">
      <path d="m6 6 12 12M18 6 6 18" />
    </template>
  </svg>
</template>
