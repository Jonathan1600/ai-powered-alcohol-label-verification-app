import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Compiled USWDS CSS plus the wrapper's component styles. The USWDS JS is
// deliberately never imported: react-uswds owns those behaviors, and loading
// both initializes components twice (ADR-010).
import '@uswds/uswds/css/uswds.css'
import '@trussworks/react-uswds/lib/index.css'
import './styles/app.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
