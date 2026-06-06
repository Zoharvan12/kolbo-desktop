import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { installElectronApiStub } from './lib/electron-api-stub'
import { installKolboInitBridge } from './lib/kolbo-init'
import { installProjectStorageDevtools } from './lib/project-storage-devtools'
import './index.css'

installElectronApiStub()
installKolboInitBridge()
installProjectStorageDevtools()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
