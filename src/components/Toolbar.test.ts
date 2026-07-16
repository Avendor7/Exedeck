// @vitest-environment happy-dom

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import Toolbar from './Toolbar.vue'

describe('Toolbar', () => {
  it('enables only actions valid for a stopped task', async () => {
    const wrapper = mount(Toolbar, { props: { disabled: false, running: false } })
    const buttons = wrapper.findAll('button')

    expect(buttons.map((button) => button.attributes('disabled'))).toEqual([
      undefined,
      '',
      undefined,
      undefined,
      undefined,
    ])

    await buttons[0].trigger('click')
    await buttons[2].trigger('click')
    expect(wrapper.emitted('start')).toHaveLength(1)
    expect(wrapper.emitted('restart')).toHaveLength(1)
  })

  it('switches start and stop availability for a running task', () => {
    const wrapper = mount(Toolbar, { props: { disabled: false, running: true } })
    const buttons = wrapper.findAll('button')

    expect(buttons[0].attributes('disabled')).toBe('')
    expect(buttons[1].attributes('disabled')).toBeUndefined()
  })
})
