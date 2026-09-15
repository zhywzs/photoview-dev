import { MockedProvider } from '@apollo/client/testing'
import { render, screen } from '@testing-library/react'
import React from 'react'
import { MemoryRouter } from 'react-router-dom'
import TimelineGallery, { MY_TIMELINE_QUERY } from './TimelineGallery'
import { timelineData } from './timelineTestData'

vi.mock('../../hooks/useScrollPagination')

test('timeline with media', async () => {
  const graphqlMocks = [
    {
      request: {
        query: MY_TIMELINE_QUERY,
        variables: { onlyFavorites: false, offset: 0, limit: 200 },
      },
      result: {
        data: {
          myTimeline: timelineData,
        },
      },
    },
  ]

  render(
    <MemoryRouter initialEntries={['/timeline']}>
      <MockedProvider mocks={graphqlMocks}>
        <TimelineGallery />
      </MockedProvider>
    </MemoryRouter>
  )

  // 5 media items are rendered as tiles
  expect(await screen.findAllByRole('img')).toHaveLength(5)

  // at the default zoom (5 columns) the sparse days merge into a single date
  // group (2020-11-09 .. 2020-12-13), shown in the floating date pill
  expect(await screen.findByText(/November 9/)).toBeInTheDocument()
})
