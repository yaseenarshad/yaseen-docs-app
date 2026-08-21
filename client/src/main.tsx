import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import { storage } from './lib/storage'
import '@milkdown/crepe/theme/common/style.css'
import '@milkdown/crepe/theme/frame.css'
import './app.css'

function render(): void {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
}

// The app state lives in the main process (D9): load it (and this window's identity) before the first render.
void storage
  .init()
  .catch((err: unknown) => console.error('[storage] init failed; rendering with defaults', err))
  .then(render)
