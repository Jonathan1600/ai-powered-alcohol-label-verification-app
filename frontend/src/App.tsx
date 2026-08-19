import { Header, Title } from '@trussworks/react-uswds'

import QueueScreen from './components/QueueScreen'

function App() {
  return (
    <>
      {/* Written by hand rather than taken from the wrapper, which ships no
          skip-nav component. USWDS styles .usa-skipnav on its own. */}
      <a className="usa-skipnav" href="#main-content">
        Skip to main content
      </a>

      <Header basic>
        <div className="usa-nav-container">
          <div className="usa-navbar">
            <Title>
              <span className="display-block font-body-2xs text-base-dark text-normal">
                Alcohol and Tobacco Tax and Trade Bureau
              </span>
              Label Verification
            </Title>
          </div>
        </div>
      </Header>

      <main id="main-content">
        <QueueScreen />
      </main>
    </>
  )
}

export default App
