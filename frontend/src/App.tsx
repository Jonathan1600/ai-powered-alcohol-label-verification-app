import {
  Header,
  Identifier,
  IdentifierIdentity,
  IdentifierLink,
  IdentifierLinkItem,
  IdentifierLinks,
  IdentifierMasthead,
  SiteAlert,
  Title,
} from '@trussworks/react-uswds'

import QueueScreen from './components/QueueScreen'

const REPOSITORY_URL = 'https://github.com/Jonathan1600/ai-powered-alcohol-label-verification-app'

function App() {
  return (
    <>
      {/* Written by hand rather than taken from the wrapper, which ships no
          skip-nav component. USWDS styles .usa-skipnav on its own. */}
      <a className="usa-skipnav" href="#main-content">
        Skip to main content
      </a>

      {/* Deliberately not the USWDS GovBanner. Its text asserts "an official
          website of the United States government", which is not true of this
          prototype, and borrowing that assurance to look the part would spend
          exactly the trust the design principle is about. This says the true
          thing in the same visual language. */}
      <SiteAlert variant="info" slim heading="Prototype for evaluation">
        <p>
          This is a demonstration of AI-assisted label verification. It is not an official TTB
          system, it makes no determination on any application, and nothing entered here is stored.
        </p>
      </SiteAlert>

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

      <Identifier>
        <IdentifierMasthead aria-label="About this prototype">
          {/* The domain slot names the prototype, not ttb.gov. Putting a real
              agency domain here would read as affiliation. */}
          <IdentifierIdentity domain="TTB Label Verification prototype">
            Built for evaluation. Not affiliated with, or endorsed by, the Alcohol and Tobacco Tax
            and Trade Bureau, and not connected to COLA or any system of record.
          </IdentifierIdentity>
        </IdentifierMasthead>
        <IdentifierLinks navProps={{ 'aria-label': 'Prototype links' }}>
          <IdentifierLinkItem>
            <IdentifierLink href={REPOSITORY_URL}>Source code</IdentifierLink>
          </IdentifierLinkItem>
          <IdentifierLinkItem>
            <IdentifierLink href={`${REPOSITORY_URL}/blob/main/docs/approach.md`}>
              How this works, and what it cannot do
            </IdentifierLink>
          </IdentifierLinkItem>
        </IdentifierLinks>
      </Identifier>
    </>
  )
}

export default App
