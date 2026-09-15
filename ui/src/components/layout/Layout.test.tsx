import { render, screen } from '@testing-library/react'
import { MockedProvider } from '@apollo/client/testing'
import { MemoryRouter } from 'react-router-dom'
import React from 'react'
import Layout from './Layout'

vi.mock('../../helpers/authentication', () => ({
  authToken: () => null,
}))

test('Layout component', () => {
  render(
    <MockedProvider mocks={[]}>
      <MemoryRouter>
        <Layout title="Test title">
          <p>layout_content</p>
        </Layout>
      </MemoryRouter>
    </MockedProvider>
  )

  expect(screen.getByTestId('Layout')).toBeInTheDocument()
  expect(screen.getByText('layout_content')).toBeInTheDocument()
})
