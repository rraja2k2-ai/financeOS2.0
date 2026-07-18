'use client'

import React from 'react'

type NavigationItemProps = {
  label: string
  icon?: React.ReactNode
  active?: boolean
  onClick?: () => void
}

export default function NavigationItem({ label, icon, active, onClick }: NavigationItemProps) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-4 py-3 rounded-md transition focus:outline-none ${
        active
          ? 'bg-white/6 text-white ring-1 ring-indigo-400/30'
          : 'text-slate-300 hover:bg-white/3 hover:text-white'
      }`}
    >
      <span className="w-6 h-6 flex items-center justify-center text-indigo-300">{icon ?? <span className="block w-3 h-3 rounded-sm bg-indigo-400" />}</span>
      <span className="text-sm font-medium">{label}</span>
    </button>
  )
}
