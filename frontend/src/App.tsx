import { useEffect, useState } from 'react'
import { Alert, GridContainer, Header, Title } from '@trussworks/react-uswds'

// Falls back to the local backend so a fresh checkout runs without a .env;
// deployments set VITE_API_BASE_URL at build time.
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'

interface Health {
  status: string
  model: string
}

function App() {
  const [health, setHealth] = useState<Health | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch(`${API_BASE_URL}/api/health`)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return response.json() as Promise<Health>
      })
      .then(setHealth)
      .catch((err: Error) => setError(err.message))
  }, [])

  return (
    <>
      <Header basic>
        <div className="usa-nav-container">
          <Title>TTB Label Verification</Title>
        </div>
      </Header>
      <main>
        <GridContainer className="padding-y-4">
          {health && (
            <Alert type="success">
              <h2 className="usa-alert__heading">Backend connected</h2>
              API at {API_BASE_URL} responded: status "{health.status}", model {health.model}.
            </Alert>
          )}
          {error && (
            <Alert type="error">
              <h2 className="usa-alert__heading">Backend unreachable</h2>
              Could not reach {API_BASE_URL}/api/health ({error}). Is the backend running?
            </Alert>
          )}
          {!health && !error && <p>Checking backend connection…</p>}
        </GridContainer>
      </main>
    </>
  )
}

export default App
