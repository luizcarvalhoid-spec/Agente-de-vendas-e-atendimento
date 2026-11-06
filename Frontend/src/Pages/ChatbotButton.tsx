import { X, Send, Minus } from 'lucide-react'
import { useState, useRef, useEffect } from 'react'

interface Message {
  id: number
  from: 'bot' | 'user'
  text: string
}

const INITIAL_MESSAGES: Message[] = [
  {
    id: 1,
    from: 'bot',
    text: 'Olá! 👋 Sou a assistente HidraSplash. Como posso te ajudar hoje?',
  },
]

export default function ChatbotButton() {
  const [open, setOpen] = useState(false)
  const [minimized, setMinimized] = useState(false)
  const [messages, setMessages] = useState<Message[]>(INITIAL_MESSAGES)
  const [input, setInput] = useState('')
  const [isTyping, setIsTyping] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  /* Auto-scroll to bottom on new message */
  useEffect(() => {
    if (open && !minimized) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages, open, minimized])

  const sendMessage = () => {
    const text = input.trim()
    if (!text) return

    const userMsg: Message = { id: Date.now(), from: 'user', text }
    setMessages((prev) => [...prev, userMsg])
    setInput('')
    setIsTyping(true)

    /* Simulated bot reply */
    setTimeout(() => {
      const botReply: Message = {
        id: Date.now() + 1,
        from: 'bot',
        text: 'Obrigada pelo contato! Em breve um de nossos especialistas vai te atender. 😊',
      }
      setMessages((prev) => [...prev, botReply])
      setIsTyping(false)
    }, 1200)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') sendMessage()
  }

  return (
    <>
      {/* Chat Window */}
      {open && (
        <div
          className={`fixed bottom-24 right-6 z-50 w-80 sm:w-96 bg-white rounded-2xl shadow-2xl border border-gray-100 flex flex-col overflow-hidden transition-all duration-300 ${
            minimized ? 'h-14' : 'h-[480px]'
          }`}
        >
          {/* Header */}
          <div className="flex items-center justify-between gap-3 px-4 py-3 bg-gradient-to-r from-amber-600 to-amber-500 text-white flex-shrink-0">
            <div className="flex items-center gap-2.5">
              <img
                src="/chatbot.svg"
                alt="Chatbot"
                className="w-8 h-8 rounded-full border-2 border-white/40"
              />
              <div className="leading-tight">
                <p className="text-sm font-semibold">HidraSplash IA</p>
                <p className="text-[10px] text-amber-100 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 bg-green-300 rounded-full inline-block" />
                  Online agora
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setMinimized((v) => !v)}
                className="p-1.5 rounded-full hover:bg-white/20 transition-colors"
                aria-label={minimized ? 'Expandir chat' : 'Minimizar chat'}
              >
                <Minus size={15} />
              </button>
              <button
                onClick={() => setOpen(false)}
                className="p-1.5 rounded-full hover:bg-white/20 transition-colors"
                aria-label="Fechar chat"
              >
                <X size={15} />
              </button>
            </div>
          </div>

          {/* Body */}
          {!minimized && (
            <>
              {/* Messages */}
              <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 bg-gray-50">
                {messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex ${msg.from === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    {msg.from === 'bot' && (
                      <img
                        src="/chatbot.svg"
                        alt="Bot"
                        className="w-6 h-6 rounded-full mr-2 mt-1 flex-shrink-0"
                      />
                    )}
                    <div
                      className={`max-w-[75%] text-sm px-3.5 py-2 rounded-2xl leading-relaxed ${
                        msg.from === 'user'
                          ? 'bg-amber-500 text-white rounded-br-sm'
                          : 'bg-white text-gray-700 shadow-sm border border-gray-100 rounded-bl-sm'
                      }`}
                    >
                      {msg.text}
                    </div>
                  </div>
                ))}

                {/* Typing indicator */}
                {isTyping && (
                  <div className="flex justify-start items-end gap-2">
                    <img
                      src="/chatbot.svg"
                      alt="Bot"
                      className="w-6 h-6 rounded-full flex-shrink-0"
                    />
                    <div className="bg-white border border-gray-100 shadow-sm px-4 py-3 rounded-2xl rounded-bl-sm flex gap-1">
                      {[0, 1, 2].map((i) => (
                        <span
                          key={i}
                          className="w-1.5 h-1.5 bg-amber-400 rounded-full animate-bounce"
                          style={{ animationDelay: `${i * 0.15}s` }}
                        />
                      ))}
                    </div>
                  </div>
                )}
                <div ref={bottomRef} />
              </div>

              {/* Input */}
              <div className="flex items-center gap-2 px-3 py-3 border-t border-gray-100 bg-white flex-shrink-0">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Digite sua mensagem..."
                  className="flex-1 text-sm px-3.5 py-2 rounded-full border border-gray-200 bg-gray-50 focus:outline-none focus:ring-2 focus:ring-amber-300 focus:border-amber-400 transition-all"
                />
                <button
                  onClick={sendMessage}
                  disabled={!input.trim()}
                  className="w-9 h-9 flex items-center justify-center rounded-full bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex-shrink-0 shadow-sm"
                  aria-label="Enviar mensagem"
                >
                  <Send size={15} />
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* FAB Button */}
      <button
        onClick={() => {
          setOpen((v) => !v)
          setMinimized(false)
        }}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-110 active:scale-95 focus:outline-none focus:ring-4 focus:ring-amber-300"
        aria-label="Abrir chat"
      >
        {/* Pulse ring */}
        {!open && (
          <span className="absolute inset-0 rounded-full bg-amber-400 opacity-30 animate-ping" />
        )}
        <img
          src="/chatbot.svg"
          alt="Chatbot HidraSplash"
          className="w-14 h-14 rounded-full object-cover relative z-10"
        />
      </button>
    </>
  )
}
