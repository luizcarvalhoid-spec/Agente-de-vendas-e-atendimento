import type { ReactNode } from 'react'

import AnnouncementBar from '../Pages/AnnouncementBar'
import ChatbotButton from '../Pages/ChatbotButton'
import Header from '../Pages/Header'

interface StoreRouteFrameProps {
  children: ReactNode
}

export default function StoreRouteFrame({ children }: StoreRouteFrameProps) {
  return (
    <div className="min-h-screen bg-gray-50 font-poppins">
      <AnnouncementBar />
      <Header />
      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto max-w-7xl px-4 py-10 focus:outline-none sm:px-6 lg:px-8"
      >
        {children}
      </main>
      <ChatbotButton />
    </div>
  )
}
