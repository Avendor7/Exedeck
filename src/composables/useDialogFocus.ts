import { nextTick, onBeforeUnmount, onMounted, type Ref } from 'vue'

const focusableSelector = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export function useDialogFocus(
  dialogRef: Ref<HTMLElement | null>,
  requestClose?: () => void,
): void {
  let previouslyFocused: HTMLElement | null = null

  const getFocusableElements = (): HTMLElement[] => {
    if (!dialogRef.value) {
      return []
    }

    return Array.from(dialogRef.value.querySelectorAll<HTMLElement>(focusableSelector)).filter(
      (element) => element.offsetParent !== null && !element.closest('[inert]'),
    )
  }

  const onKeydown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && requestClose) {
      event.preventDefault()
      event.stopPropagation()
      requestClose()
      return
    }

    if (event.key !== 'Tab') {
      return
    }

    const focusable = getFocusableElements()
    if (focusable.length === 0) {
      event.preventDefault()
      dialogRef.value?.focus()
      return
    }

    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  onMounted(async () => {
    previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    await nextTick()
    dialogRef.value?.addEventListener('keydown', onKeydown)
    const initialFocus = dialogRef.value?.querySelector<HTMLElement>('[autofocus]')
    ;(initialFocus ?? dialogRef.value)?.focus()
  })

  onBeforeUnmount(() => {
    dialogRef.value?.removeEventListener('keydown', onKeydown)
    if (previouslyFocused?.isConnected) {
      previouslyFocused.focus()
    }
  })
}
