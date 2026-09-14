import React from 'react'
import { NavLink } from 'react-router-dom'
import { useQuery, gql } from '@apollo/client'
import { authToken } from '../../helpers/authentication'
import { useTranslation } from 'react-i18next'
import { mapboxEnabledQuery } from '../../__generated__/mapboxEnabledQuery'
import { tailwindClassNames } from '../../helpers/utils'
import { faceDetectionEnabled } from './__generated__/faceDetectionEnabled'

export const MAPBOX_QUERY = gql`
  query mapboxEnabledQuery {
    mapboxToken
  }
`

export const FACE_DETECTION_ENABLED_QUERY = gql`
  query faceDetectionEnabled {
    siteInfo {
      faceDetectionEnabled
    }
  }
`

type MenuButtonProps = {
  to: string
  exact: boolean
  label: string
  background: string
  activeClasses?: string
  className?: string
  icon: React.ReactNode
}

const MenuButton = ({
  to,
  exact,
  label,
  background,
  icon,
  activeClasses,
  className,
}: MenuButtonProps) => {
  return (
    <NavLink
      to={to}
      end={exact}
      className={({ isActive }) =>
        tailwindClassNames(
          'rounded-xl my-1 lg:my-2 outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-dark-bg',
          className,
          {
            [`ring-2 lg:ring-2 ${activeClasses ?? ''}`]: isActive,
          }
        )
      }
    >
      <li className="flex flex-col lg:flex-row items-center justify-center">
        <div
          className="w-11 h-11 lg:w-8 lg:h-8 p-2 lg:p-1.5 rounded-xl"
          style={{ backgroundColor: background }}
        >
          {icon}
        </div>
        <span className="lg:hidden mt-0.5 text-[10px] font-medium text-gray-500 dark:text-gray-400">
          {label}
        </span>
        <span className="hidden lg:block ml-2 text-sm">{label}</span>
      </li>
    </NavLink>
  )
}

const MenuSeparator = () => (
  <hr className="hidden lg:block my-3 border-gray-200 dark:border-dark-border" />
)

export const MainMenu = () => {
  const { t } = useTranslation()

  const mapboxQuery = authToken()
    ? useQuery<mapboxEnabledQuery>(MAPBOX_QUERY)
    : null
  const faceDetectionEnabledQuery = authToken()
    ? useQuery<faceDetectionEnabled>(FACE_DETECTION_ENABLED_QUERY)
    : null

  const mapboxEnabled = !!mapboxQuery?.data?.mapboxToken
  const faceDetectionEnabled =
    !!faceDetectionEnabledQuery?.data?.siteInfo?.faceDetectionEnabled

  return (
    <nav
      aria-label="Main navigation"
      className="fixed w-full bottom-0 lg:bottom-auto lg:top-[76px] z-30 bg-white/95 dark:bg-dark-bg/95 backdrop-blur shadow-separator lg:shadow-none lg:w-[224px] lg:ml-8 lg:mr-5 flex-shrink-0"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      <ul className="flex justify-around items-end py-1.5 px-2 max-w-lg mx-auto lg:flex-col lg:p-0 lg:items-stretch">
        <MenuButton
          to="/timeline"
          exact
          label={t('sidemenu.photos', 'Timeline')}
          background="#4c8fe0"
          activeClasses="ring-[#e8f2fd] bg-[#e8f2fd] dark:bg-[#182230] dark:ring-[#182230]"
          className="focus:ring-blue-200 dark:focus:ring-[#335981]"
          icon={
            <svg viewBox="0 0 24 24" fill="white">
              <path d="M5.62503136,14 L9.60031266,17.978 L5.38724257,24 L2.99995461,24 C1.45289603,24 0.179346174,22.8289699 0.0173498575,21.3249546 L5.62503136,14 Z M15.7557572,10 L24.0173027,21.526562 C23.7684095,22.9323278 22.5405695,24 21.0633614,24 L21.0633614,24 L5.88324257,24 L15.7557572,10 Z"></path>
            </svg>
          }
        />
        <MenuButton
          to="/favorites"
          exact
          label={t('sidemenu.favorites', 'Favorites')}
          background="#e0697a"
          activeClasses="ring-[#fdeef0] bg-[#fdeef0] dark:bg-[#23181b] dark:ring-[#23181b]"
          className="focus:ring-red-200 dark:focus:ring-[#863541]"
          icon={
            <svg viewBox="0 0 24 24" fill="white">
              <path d="M13.999086,1 C15.0573371,1 16.0710089,1.43342987 16.8190212,2.20112483 C17.5765039,2.97781012 18,4.03198704 18,5.13009709 C18,6.22820714 17.5765039,7.28238406 16.8188574,8.05923734 L16.8188574,8.05923734 L15.8553647,9.04761889 L9.49975689,15.5674041 L3.14414912,9.04761889 L2.18065643,8.05923735 C1.39216493,7.2503776 0.999999992,6.18971057 1,5.13009711 C1.00000001,4.07048366 1.39216496,3.00981663 2.18065647,2.20095689 C2.95931483,1.40218431 3.97927681,1.00049878 5.00042783,1.00049878 C6.02157882,1.00049878 7.04154078,1.4021843 7.82019912,2.20095684 L7.82019912,2.20095684 L9.4997569,3.92390079 L11.1794784,2.20078881 C11.9271637,1.43342987 12.9408349,1 13.999086,1 L13.999086,1 Z"></path>
            </svg>
          }
        />
        <MenuButton
          to="/albums"
          exact
          label={t('sidemenu.albums', 'Albums')}
          background="#e07f5f"
          activeClasses="ring-[#fdeee8] bg-[#fdeee8] dark:bg-[#231b16] dark:ring-[#231b16]"
          className="focus:ring-orange-200 dark:focus:ring-[#8a5136]"
          icon={
            <svg viewBox="0 0 24 24" fill="white">
              <path d="M19,2 C19.5522847,2 20,2.44771525 20,3 L20,21 C20,21.5522847 19.5522847,22 19,22 L6,22 C4.8954305,22 4,21.1045695 4,20 L4,4 C4,2.8954305 4.8954305,2 6,2 L19,2 Z M14.1465649,9 L10.9177928,13.7443828 L8.72759325,11.2494916 L6,15 L18,15 L14.1465649,9 Z M11,9 C10.4477153,9 10,9.44771525 10,10 C10,10.5522847 10.4477153,11 11,11 C11.5522847,11 12,10.5522847 12,10 C12,9.44771525 11.5522847,9 11,9 Z"></path>
            </svg>
          }
        />
        {mapboxEnabled ? (
          <MenuButton
            to="/places"
            exact
            label={t('sidemenu.places', 'Places')}
            background="#63c162"
            activeClasses="ring-[#e9f9e9] bg-[#e9f9e9] dark:bg-[#161f16] dark:ring-[#161f16]"
            className="focus:ring-green-100 dark:focus:ring-[#368644]"
            icon={
              <svg viewBox="0 0 24 24" fill="white">
                <path d="M2.4,3.34740684 C2.47896999,3.34740684 2.55617307,3.37078205 2.62188008,3.41458672 L8,7 L8,21 L2.4452998,17.2968665 C2.16710114,17.1114008 2,16.7991694 2,16.4648162 L2,3.74740684 C2,3.52649294 2.1790861,3.34740684 2.4,3.34740684 Z M14.5,3 L14.5,17 L8.5,21 L8.5,7 L14.5,3 Z M15,3 L21.4961389,6.71207939 C21.8077139,6.89012225 22,7.22146569 22,7.58032254 L22,20.3107281 C22,20.531642 21.8209139,20.7107281 21.6,20.7107281 C21.5303892,20.7107281 21.4616585,20.692562 21.4015444,20.6580254 L15,17 L15,3 Z"></path>
              </svg>
            }
          />
        ) : null}
        {faceDetectionEnabled ? (
          <MenuButton
            to="/people"
            exact
            label={t('sidemenu.people', 'People')}
            background="#e0b34c"
            activeClasses="ring-[#fbf3e0] bg-[#fbf3e0] dark:bg-[#1f1c14] dark:ring-[#1f1c14]"
            className="focus:ring-yellow-100 dark:focus:ring-[#8f8c36]"
            icon={
              <svg viewBox="0 0 24 24" fill="white">
                <path d="M15.713873,14.2127622 C17.4283917,14.8986066 18.9087267,16.0457918 20.0014344,17.5008819 C20,19.1568542 18.6568542,20.5 17,20.5 L7,20.5 C5.34314575,20.5 4,19.1568542 4,17.5 L4.09169034,17.3788798 C5.17486154,15.981491 6.62020934,14.878942 8.28693513,14.2120314 C9.30685583,15.018595 10.5972088,15.5 12,15.5 C13.3092718,15.5 14.5205974,15.0806428 15.5069849,14.3689203 L15.713873,14.2127622 L15.713873,14.2127622 Z M12,4 C15.0375661,4 17.5,6.46243388 17.5,9.5 C17.5,12.5375661 15.0375661,15 12,15 C8.96243388,15 6.5,12.5375661 6.5,9.5 C6.5,6.46243388 8.96243388,4 12,4 Z"></path>
              </svg>
            }
          />
        ) : null}
        <MenuSeparator />
        <MenuButton
          to="/settings"
          exact
          label={t('sidemenu.settings', 'Settings')}
          background="#7d95a3"
          activeClasses="ring-[#eaf0f4] bg-[#eaf0f4] dark:bg-[#161d22] dark:ring-[#161d22]"
          className="focus:ring-gray-200 dark:focus:ring-[#2b778a]"
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2}>
              <line x1="4" y1="7" x2="20" y2="7" />
              <circle cx="9" cy="7" r="2.4" fill="white" stroke="none" />
              <line x1="4" y1="17" x2="20" y2="17" />
              <circle cx="15" cy="17" r="2.4" fill="white" stroke="none" />
            </svg>
          }
        />
      </ul>
    </nav>
  )
}

export default MainMenu
