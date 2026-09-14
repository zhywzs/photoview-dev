import React, { useState, useRef, useEffect } from 'react'
import styled from 'styled-components'
import { closePresentModeAction, GalleryAction } from '../mediaGalleryReducer'

import { useSwipeable } from 'react-swipeable'

import ExitIcon from './icons/Exit'
import NextIcon from './icons/Next'
import PrevIcon from './icons/Previous'

const StyledOverlayContainer = styled.div`
  width: 100%;
  height: 100%;
  position: relative;
`

const OverlayButton = styled.button`
  width: 64px;
  height: 64px;
  background: none;
  border: none;
  outline: none;
  cursor: pointer;
  position: absolute;

  & svg {
    width: 32px;
    height: 32px;
    overflow: visible !important;
  }

  & svg path {
    stroke: rgba(255, 255, 255, 0.5);
    transition-property: stroke, filter;
    transition-duration: 140ms;
  }

  &:hover svg path {
    stroke: rgba(255, 255, 255, 1);
    filter: drop-shadow(0px 0px 2px rgba(0, 0, 0, 0.6));
  }

  &.hide svg path {
    stroke: rgba(255, 255, 255, 0);
    transition: stroke 300ms;
  }
`

const ExitButton = styled(OverlayButton)`
  left: 20px;
  top: max(16px, env(safe-area-inset-top, 0px));
  z-index: 20;
`

const NavigationButton = styled(OverlayButton)<{ align: 'left' | 'right' }>`
  height: 80%;
  width: 20%;
  top: 10%;

  ${({ align: float }) => (float == 'left' ? 'left: 0;' : null)}
  ${({ align: float }) => (float == 'right' ? 'right: 0;' : null)}

  & svg {
    margin: auto;
    width: 48px;
    height: 64px;
  }
`

const ActionBar = styled.div<{ visible: boolean }>`
  position: absolute;
  right: 16px;
  top: max(16px, env(safe-area-inset-top, 0px));
  z-index: 20;
  display: flex;
  gap: 4px;

  opacity: ${props => (props.visible ? 1 : 0)};
  transition: opacity 300ms;
`

const ActionButton = styled.button`
  width: 48px;
  height: 48px;
  border-radius: 9999px;
  background: rgba(0, 0, 0, 0.4);
  border: none;
  outline: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;

  color: rgba(255, 255, 255, 0.85);
  transition: background-color 140ms, color 140ms;

  &:hover {
    background: rgba(0, 0, 0, 0.65);
    color: white;
  }

  & svg {
    width: 24px;
    height: 24px;
  }
`

type PresentNavigationOverlayProps = {
  children?: React.ReactChild
  dispatchMedia: React.Dispatch<GalleryAction>
  disableSaveCloseInHistory?: boolean
  favorite?: boolean
  onToggleFavorite?(): void
  onToggleInfo?(): void
}

const PresentNavigationOverlay = ({
  children,
  dispatchMedia,
  disableSaveCloseInHistory,
  favorite,
  onToggleFavorite,
  onToggleInfo,
}: PresentNavigationOverlayProps) => {
  // controls are visible by default (mobile has no mouse move),
  // and hide after a period of inactivity
  const [hide, setHide] = useState(false)
  const hideTimer = useRef<number | undefined>(undefined)

  useEffect(() => {
    return () => {
      if (hideTimer.current != null) window.clearTimeout(hideTimer.current)
    }
  }, [])

  const showControls = () => {
    setHide(false)
    if (hideTimer.current != null) window.clearTimeout(hideTimer.current)
    hideTimer.current = window.setTimeout(() => setHide(true), 2500)
  }

  const handlers = useSwipeable({
    onSwipedLeft: () => dispatchMedia({ type: 'nextImage' }),
    onSwipedRight: () => dispatchMedia({ type: 'previousImage' }),
    preventScrollOnSwipe: true,
    trackMouse: false,
  })

  return (
    <StyledOverlayContainer
      data-testid="present-overlay"
      onMouseMove={showControls}
    >
    <div {...handlers}>
      {children}
      <NavigationButton
        aria-label="Previous image"
        className={hide ? 'hide' : undefined}
        align="left"
        onClick={() => dispatchMedia({ type: 'previousImage' })}
      >
        <PrevIcon />
      </NavigationButton>
      <NavigationButton
        aria-label="Next image"
        className={hide ? 'hide' : undefined}
        align="right"
        onClick={() => dispatchMedia({ type: 'nextImage' })}
      >
        <NextIcon />
      </NavigationButton>

      <ActionBar visible={!hide}>
        {onToggleFavorite && (
          <ActionButton
            aria-label={favorite ? 'Remove favorite' : 'Add favorite'}
            onClick={onToggleFavorite}
            style={{ color: favorite ? '#ff5a76' : undefined }}
          >
            <svg
              viewBox="0 0 24 24"
              fill={favorite ? 'currentColor' : 'none'}
              stroke="currentColor"
              strokeWidth={favorite ? 0 : 2}
            >
              <path d="M13.999086,1 C15.0573371,1 16.0710089,1.43342987 16.8190212,2.20112483 C17.5765039,2.97781012 18,4.03198704 18,5.13009709 C18,6.22820714 17.5765039,7.28238406 16.8188574,8.05923734 L9.49975689,15.5674041 L2.18065643,8.05923735 C1.39216493,7.2503776 0.999999992,6.18971057 1,5.13009711 C1.00000001,4.07048366 1.39216496,3.00981663 2.18065647,2.20095689 C2.95931483,1.40218431 3.97927681,1.00049878 5.00042783,1.00049878 C6.02157882,1.00049878 7.04154078,1.4021843 7.82019912,2.20095684 L9.4997569,3.92390079 L11.1794784,2.20078881 C11.9271637,1.43342987 12.9408349,1 13.999086,1 L13.999086,1 Z" />
            </svg>
          </ActionButton>
        )}
        {onToggleInfo && (
          <ActionButton aria-label="Show media info" onClick={onToggleInfo}>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
          </ActionButton>
        )}
      </ActionBar>

      <ExitButton
        aria-label="Exit presentation mode"
        className={hide ? 'hide' : undefined}
        onClick={() => {
          if (disableSaveCloseInHistory === true) {
            dispatchMedia({ type: 'closePresentMode' })
          } else {
            closePresentModeAction({ dispatchMedia })
          }
        }}
      >
        <ExitIcon />
      </ExitButton>
    </div>
    </StyledOverlayContainer>
  )
}

export default PresentNavigationOverlay
