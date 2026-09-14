import React, { useContext, useState } from 'react'
import SearchBar from './Searchbar'

import { authToken } from '../../helpers/authentication'
import { SidebarContext } from '../sidebar/Sidebar'
import classNames from 'classnames'

const Header = () => {
  const { pinned } = useContext(SidebarContext)
  const [searchOpen, setSearchOpen] = useState(false)

  const loggedIn = authToken() != null

  return (
    <div
      className={classNames(
        'sticky top-0 z-40 bg-white/90 dark:bg-dark-bg/90 backdrop-blur flex items-center justify-between py-2 px-3 lg:px-8 lg:pt-3 shadow-separator lg:shadow-none transition-[margin] motion-reduce:transition-none',
        { 'mr-[404px]': pinned }
      )}
    >
      <h1 className="flex-shrink-0 flex items-center">
        <img
          className="h-8 lg:h-9"
          src={import.meta.env.BASE_URL + 'photoview-logo.svg'}
          alt="logo"
        />
        <span className="hidden lg:block ml-2 text-xl font-medium tracking-tight">
          Photoview
        </span>
      </h1>

      {loggedIn && !searchOpen && (
        <button
          className="lg:hidden w-10 h-10 -mr-1 rounded-full flex items-center justify-center text-gray-500 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-dark-bg2"
          aria-label="Open search"
          onClick={() => setSearchOpen(true)}
        >
          <svg
            viewBox="0 0 24 24"
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
          >
            <circle cx="11" cy="11" r="7" />
            <line x1="16.5" y1="16.5" x2="21" y2="21" />
          </svg>
        </button>
      )}

      {loggedIn && (
        <div
          className={classNames(
            'flex-1 flex justify-end lg:justify-center lg:max-w-lg',
            searchOpen ? 'flex' : 'hidden lg:flex'
          )}
        >
          <div className={classNames('w-full', searchOpen && 'px-1')}>
            <SearchBar
              autoFocusMobile={searchOpen}
              onCloseMobile={() => setSearchOpen(false)}
            />
          </div>
        </div>
      )}
    </div>
  )
}

export default Header
