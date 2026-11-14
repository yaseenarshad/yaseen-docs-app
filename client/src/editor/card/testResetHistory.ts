/** Tests only: answers the Reset history box (YAZ-5376) — it waits for the box, checks the red button waits for the word, then types it and confirms. */
import { act } from 'react'
import { expect, vi } from 'vitest'

const typeInto = (input: HTMLInputElement, text: string): void => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

export async function confirmResetHistory(): Promise<void> {
  const box = await vi.waitFor(() => {
    const found = document.querySelector<HTMLElement>('[aria-labelledby="confirm-reset-history-text"]')
    if (found === null) throw new Error('no Reset history box yet')
    return found
  })
  const button = [...box.querySelectorAll<HTMLButtonElement>('.confirm__btn--danger')].find((b) => b.textContent === 'Reset history')!
  const input = box.querySelector<HTMLInputElement>('.confirm__input')!
  expect(button.disabled).toBe(true)
  act(() => typeInto(input, 'rese'))
  expect(button.disabled).toBe(true)
  act(() => typeInto(input, 'reset'))
  expect(button.disabled).toBe(false)
  act(() => button.click())
  await act(async () => await Promise.resolve())
}
