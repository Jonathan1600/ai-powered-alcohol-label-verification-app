// Loaded before every test file. `jest-dom` supplies the DOM matchers the
// component tests assert with, and the cleanup keeps one test's rendered tree
// out of the next one's queries.

import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(cleanup)
