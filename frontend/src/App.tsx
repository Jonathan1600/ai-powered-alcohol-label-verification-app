import { Header, Title } from '@trussworks/react-uswds'

import QueueScreen from './components/QueueScreen'

function App() {
  return (
    <>
      <Header basic>
        <div className="usa-nav-container">
          <Title>TTB Label Verification</Title>
        </div>
      </Header>
      <main>
        <QueueScreen />
      </main>
    </>
  )
}

export default App
