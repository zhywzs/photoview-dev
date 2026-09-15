import React from 'react'
import { useTranslation } from 'react-i18next'

import ExitIcon from './icons/Exit'
import NextIcon from './icons/Next'
import PrevIcon from './icons/Previous'

type PresentControlsProps = {
  visible: boolean
  favorite?: boolean
  onToggleFavorite?(): void
  onToggleInfo(): void
  infoOpen: boolean
  onClose(): void
  onPrev(): void
  onNext(): void
  onDelete?(): void
}

const buttonBase =
  'w-11 h-11 rounded-full bg-black/40 hover:bg-black/65 active:bg-black/70 border-none outline-none cursor-pointer flex items-center justify-center text-white/85 hover:text-white transition-colors'

const PresentControls = React.memo(({
  visible,
  favorite,
  onToggleFavorite,
  onToggleInfo,
  infoOpen,
  onClose,
  onPrev,
  onNext,
  onDelete,
}: PresentControlsProps) => {
  const { t } = useTranslation()

  return (
    <div
      aria-hidden={!visible}
      className={`transition-opacity duration-300 ${
        visible ? 'opacity-100' : 'opacity-0 pointer-events-none'
      }`}
    >
      {/* exit */}
      <button
        aria-label={t('present.exit', 'Exit presentation mode')}
        className={`${buttonBase} fixed z-[120] left-4`}
        style={{ top: 'max(14px, env(safe-area-inset-top, 0px))' }}
        onClick={onClose}
      >
        <ExitIcon />
      </button>

      {/* favorite + info */}
      <div
        className="fixed z-[120] flex gap-2 right-4"
        style={{ top: 'max(14px, env(safe-area-inset-top, 0px))' }}
      >
        {onToggleFavorite && (
          <button
            aria-label={favorite ? 'Remove favorite' : 'Add favorite'}
            className={`${buttonBase} ${favorite ? 'text-[#ff5a76]' : ''}`}
            style={favorite ? { color: '#ff5a76' } : undefined}
            onClick={onToggleFavorite}
          >
            <svg
              viewBox="0 0 24 24"
              className="w-5 h-5"
              fill={favorite ? 'currentColor' : 'none'}
              stroke="currentColor"
              strokeWidth={favorite ? 0 : 2}
            >
              <path d="M13.999086,1 C15.0573371,1 16.0710089,1.43342987 16.8190212,2.20112483 C17.5765039,2.97781012 18,4.03198704 18,5.13009709 C18,6.22820714 17.5765039,7.28238406 16.8188574,8.05923734 L9.49975689,15.5674041 L2.18065643,8.05923735 C1.39216493,7.2503776 0.999999992,6.18971057 1,5.13009711 C1.00000001,4.07048366 1.39216496,3.00981663 2.18065647,2.20095689 C2.95931483,1.40218431 3.97927681,1.00049878 5.00042783,1.00049878 C6.02157882,1.00049878 7.04154078,1.4021843 7.82019912,2.20095684 L9.4997569,3.92390079 L11.1794784,2.20078881 C11.9271637,1.43342987 12.9408349,1 13.999086,1 L13.999086,1 Z" />
            </svg>
          </button>
        )}
        <button
          aria-label={t('present.info', 'Show media info')}
          aria-pressed={infoOpen}
          className={`${buttonBase} ${infoOpen ? 'bg-black/65 text-white' : ''}`}
          onClick={onToggleInfo}
        >
          <svg
            viewBox="0 0 24 24"
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
        </button>
        {onDelete && (
          <button
            aria-label={t('present.delete', 'Delete media')}
            className={`${buttonBase} hover:text-red-400`}
            onClick={onDelete}
          >
            <svg
              viewBox="0 0 24 24"
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
          </button>
        )}
      </div>

      {/* prev / next (desktop; mobile pages by swiping) */}
      <button
        aria-label="Previous image"
        className={`${buttonBase} fixed z-[120] hidden lg:flex left-5 top-1/2 -translate-y-1/2 w-12 h-12`}
        onClick={onPrev}
      >
        <PrevIcon />
      </button>
      <button
        aria-label="Next image"
        className={`${buttonBase} fixed z-[120] hidden lg:flex right-5 top-1/2 -translate-y-1/2 w-12 h-12`}
        onClick={onNext}
      >
        <NextIcon />
      </button>
    </div>
  )
})

export default PresentControls
