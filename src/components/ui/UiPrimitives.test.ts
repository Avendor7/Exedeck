// @vitest-environment happy-dom

import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { describe, expect, it } from 'vitest'
import UiButton from './UiButton.vue'
import UiDialog from './UiDialog.vue'
import UiIconButton from './UiIconButton.vue'

describe('UI primitives', () => {
  it('maps semantic button props to the shared visual classes', async () => {
    const wrapper = mount(UiButton, {
      props: { variant: 'danger', size: 'small', prominent: true },
      attrs: { disabled: true },
      slots: { default: 'Remove' },
    })

    const button = wrapper.get('button')
    expect(button.attributes('type')).toBe('button')
    expect(button.attributes('disabled')).toBe('')
    expect(button.classes()).toEqual(expect.arrayContaining(['danger', 'small', 'prominent-danger']))
    expect(button.text()).toBe('Remove')
  })

  it('provides consistent dialog semantics and Escape handling', async () => {
    const wrapper = mount(UiDialog, {
      props: { labelledby: 'dialog-title', panelClass: 'test-dialog' },
      slots: { default: '<h2 id="dialog-title">Example</h2>' },
    })

    const dialog = wrapper.get('[role="dialog"]')
    expect(dialog.attributes('aria-modal')).toBe('true')
    expect(dialog.attributes('aria-labelledby')).toBe('dialog-title')
    expect(dialog.classes()).toContain('test-dialog')

    await nextTick()
    await dialog.trigger('keydown', { key: 'Escape' })
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('requires an accessible name for icon-only buttons', () => {
    const wrapper = mount(UiIconButton, {
      props: { label: 'Dismiss', variant: 'primary' },
      slots: { default: '×' },
    })

    const button = wrapper.get('button')
    expect(button.attributes('aria-label')).toBe('Dismiss')
    expect(button.classes()).toEqual(expect.arrayContaining(['icon-button', 'primary']))
  })
})
