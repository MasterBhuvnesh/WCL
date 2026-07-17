import React from 'react'
import { Mirage } from 'ldrs/react'
import 'ldrs/react/Mirage.css'

export default function Loading(): React.JSX.Element {
  return (
    <div className="flex items-center justify-center h-full">
      <Mirage size="60" speed="2.5" color="gray" />
    </div>
  )
}
