import { gql, useQuery } from '@apollo/client'
import React, { useCallback, useContext } from 'react'
import { Helmet } from 'react-helmet'
import { useLocation } from 'react-router-dom'
import { useApolloClient } from '@apollo/client'
import Header from '../header/Header'
import { Authorized } from '../routes/AuthorizedRoute'
import { Sidebar, SidebarContext } from '../sidebar/Sidebar'
import MainMenu from './MainMenu'
import UploadFab from '../upload/UploadFab'
import { authToken } from '../../helpers/authentication'

export const ADMIN_QUERY = gql`
  query adminQuery {
    myUser {
      admin
    }
  }
`

/** routes where the upload FAB is shown */
const UPLOAD_ROUTES = ['/timeline', '/favorites', '/albums', '/album/', '/people']

type LayoutProps = {
  children: React.ReactNode
  title: string
}

const Layout = ({ children, title, ...otherProps }: LayoutProps) => {
  const { pinned, content: sidebarContent } = useContext(SidebarContext)
  const location = useLocation()
  const apolloClient = useApolloClient()

  const showUploadFab =
    authToken() != null &&
    UPLOAD_ROUTES.some(route => location.pathname.startsWith(route))

  const handleUploaded = useCallback(() => {
    // refetch all queries so the new media appears immediately
    apolloClient.refetchQueries({ include: 'active' })
  }, [apolloClient])

  return (
    <>
      <Helmet>
        <title>{title ? `${title} - Photoview` : `Photoview`}</title>
      </Helmet>
      <div className="relative" {...otherProps} data-testid="Layout">
        <Header />
        <div className="">
          <Authorized>
            <MainMenu />
          </Authorized>
          <div
            className={`mx-3 my-3 lg:mt-5 lg:mr-8 lg:ml-[260px] pb-24 lg:pb-4 ${
              pinned && sidebarContent ? 'lg:pr-[420px]' : ''
            }`}
            id="layout-content"
          >
            {children}
          </div>
        </div>
        <Sidebar />
        {showUploadFab && <UploadFab onUploaded={handleUploaded} />}
      </div>
    </>
  )
}

export default Layout
