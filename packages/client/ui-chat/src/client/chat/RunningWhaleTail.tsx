import css from './ChatView.module.css'

export function RunningWhaleTail() {
  return (
    <span className={css.runningIcon} aria-hidden="true">
      <svg className={css.runningWhaleStill} width="100%" height="100%" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="9" stroke="#0066FF" strokeWidth="3.2" strokeDasharray="8 11" strokeDashoffset="-1" transform="rotate(-118 12 12)" />
        <circle cx="12" cy="12" r="9" stroke="#7EB6FF" strokeWidth="3.2" strokeDasharray="8 11" strokeDashoffset="-10.5" transform="rotate(-118 12 12)" />
        <path d="M11.6 7.4H14.5L12.7 15.2H14.2L13.8 16.9H9.5L9.9 15.2H11.1L12.3 9.4H11.1L11.6 7.4Z" fill="#0066FF" />
      </svg>
    </span>
  )
}
