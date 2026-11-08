import { Minus, Send, X } from 'lucide-react'
import {
  type FormEvent,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react'

interface Message {
  id: number
  from: 'bot' | 'user'
  text: string
}

const INITIAL_MESSAGES: Message[] = [
  {
    id: 1,
    from: 'bot',
    text: 'Olá! Este chat é uma simulação visual da futura assistente HidraSplash. Nenhum atendimento real está ativo.',
  },
]

const simulatedReplyDelayMs = 1_200

export default function ChatbotButton() {
  const [open, setOpen] = useState(false)
  const [minimized, setMinimized] = useState(false)
  const [messages, setMessages] = useState<Message[]>(INITIAL_MESSAGES)
  const [input, setInput] = useState('')
  const [isTyping, setIsTyping] = useState(false)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const pendingReplyRef = useRef<number>()
  const titleId = useId()
  const descriptionId = useId()
  const dialogId = useId()

  const cancelPendingReply = useCallback(() => {
    if (pendingReplyRef.current !== undefined) {
      window.clearTimeout(pendingReplyRef.current)
      pendingReplyRef.current = undefined
    }
    setIsTyping(false)
  }, [])

  const closeChat = useCallback(() => {
    cancelPendingReply()
    setOpen(false)
    setMinimized(false)
    window.requestAnimationFrame(() => triggerRef.current?.focus())
  }, [cancelPendingReply])

  useEffect(
    () => () => {
      if (pendingReplyRef.current !== undefined) {
        window.clearTimeout(pendingReplyRef.current)
      }
    },
    [],
  )

  useEffect(() => {
    if (!open || minimized) return

    const animationFrame = window.requestAnimationFrame(() => {
      inputRef.current?.focus()
    })

    return () => window.cancelAnimationFrame(animationFrame)
  }, [minimized, open])

  useEffect(() => {
    if (!open) return

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeChat()
    }

    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [closeChat, open])

  useEffect(() => {
    if (open && !minimized) {
      const container = messagesContainerRef.current
      container?.scrollTo({ top: container.scrollHeight, behavior: 'auto' })
    }
  }, [messages, open, minimized])

  const sendMessage = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const text = input.trim()
    if (!text) return

    cancelPendingReply()
    setMessages((previous) => [
      ...previous,
      { id: Date.now(), from: 'user', text },
    ])
    setInput('')
    setIsTyping(true)

    pendingReplyRef.current = window.setTimeout(() => {
      setMessages((previous) => [
        ...previous,
        {
          id: Date.now() + 1,
          from: 'bot',
          text: 'Resposta simulada: posso demonstrar a interface, mas ainda não consulto o catálogo nem ofereço atendimento real.',
        },
      ])
      pendingReplyRef.current = undefined
      setIsTyping(false)
    }, simulatedReplyDelayMs)
  }

  return (
    <>
      {open && (
        <section
          id={dialogId}
          role="dialog"
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
          className={`fixed bottom-24 left-4 right-4 z-50 flex w-auto max-h-[calc(100dvh-7rem)] flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl transition-[height] duration-300 motion-reduce:transition-none sm:left-auto sm:right-6 sm:w-96 ${
            minimized ? 'h-16' : 'h-[calc(100dvh-7rem)] sm:max-h-[30rem]'
          }`}
        >
          <p id={descriptionId} className="sr-only">
            Interface simulada, sem agente de inteligência artificial e sem atendimento humano.
          </p>
          <div className="flex min-h-16 flex-shrink-0 items-center justify-between gap-3 bg-gradient-to-r from-amber-800 to-amber-700 px-3 py-2 text-white sm:px-4">
            <div className="flex min-w-0 items-center gap-2.5">
              <img
                src="/chatbot.svg"
                alt=""
                className="h-9 w-9 flex-shrink-0 rounded-full border-2 border-white/60"
              />
              <div className="min-w-0 leading-tight">
                <h2 id={titleId} className="truncate text-sm font-semibold">
                  Chat demonstrativo
                </h2>
                <p className="mt-0.5 flex items-center gap-1 text-[11px] text-amber-50">
                  <span
                    aria-hidden="true"
                    className="inline-block h-1.5 w-1.5 rounded-full bg-amber-200"
                  />
                  Simulação local
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setMinimized((value) => !value)}
                className="flex min-h-11 min-w-11 items-center justify-center rounded-full transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                aria-label={minimized ? 'Expandir chat' : 'Minimizar chat'}
              >
                <Minus aria-hidden="true" size={18} />
              </button>
              <button
                type="button"
                onClick={closeChat}
                className="flex min-h-11 min-w-11 items-center justify-center rounded-full transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                aria-label="Fechar chat"
              >
                <X aria-hidden="true" size={18} />
              </button>
            </div>
          </div>

          {!minimized && (
            <>
              <div
                ref={messagesContainerRef}
                role="log"
                aria-live="polite"
                aria-relevant="additions text"
                aria-label="Mensagens do chat demonstrativo"
                className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-gray-50 px-4 py-3 overscroll-contain"
              >
                {messages.map((message) => (
                  <div
                    key={message.id}
                    className={`flex ${
                      message.from === 'user' ? 'justify-end' : 'justify-start'
                    }`}
                  >
                    {message.from === 'bot' && (
                      <img
                        src="/chatbot.svg"
                        alt=""
                        className="mr-2 mt-1 h-6 w-6 flex-shrink-0 rounded-full"
                      />
                    )}
                    <div
                      className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
                        message.from === 'user'
                          ? 'rounded-br-sm bg-amber-800 text-white'
                          : 'rounded-bl-sm border border-gray-200 bg-white text-gray-700 shadow-sm'
                      }`}
                    >
                      {message.text}
                    </div>
                  </div>
                ))}

                {isTyping && (
                  <div className="flex items-end justify-start gap-2">
                    <img
                      src="/chatbot.svg"
                      alt=""
                      className="h-6 w-6 flex-shrink-0 rounded-full"
                    />
                    <div
                      className="flex gap-1 rounded-2xl rounded-bl-sm border border-gray-200 bg-white px-4 py-3 shadow-sm"
                      aria-label="Preparando resposta simulada"
                    >
                      {[0, 1, 2].map((index) => (
                        <span
                          key={index}
                          aria-hidden="true"
                          className="h-1.5 w-1.5 animate-bounce rounded-full bg-amber-700 motion-reduce:animate-none"
                          style={{ animationDelay: `${index * 0.15}s` }}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <form
                onSubmit={sendMessage}
                className="flex flex-shrink-0 items-center gap-2 border-t border-gray-200 bg-white px-3 py-3"
              >
                <label htmlFor={`${dialogId}-message`} className="sr-only">
                  Mensagem para o chat demonstrativo
                </label>
                <input
                  ref={inputRef}
                  id={`${dialogId}-message`}
                  type="text"
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  placeholder="Digite uma mensagem de teste..."
                  className="min-h-11 min-w-0 flex-1 rounded-full border border-gray-300 bg-gray-50 px-3.5 py-2 text-sm text-gray-700 placeholder-gray-500 transition-all focus:border-amber-700 focus:outline-none focus:ring-2 focus:ring-amber-700/40"
                />
                <button
                  type="submit"
                  disabled={!input.trim()}
                  className="flex min-h-11 min-w-11 flex-shrink-0 items-center justify-center rounded-full bg-amber-800 text-white shadow-sm transition-colors hover:bg-amber-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-800 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-700"
                  aria-label="Enviar mensagem simulada"
                >
                  <Send aria-hidden="true" size={17} />
                </button>
              </form>
            </>
          )}
        </section>
      )}

      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          if (open) closeChat()
          else {
            setOpen(true)
            setMinimized(false)
          }
        }}
        className="fixed bottom-6 right-4 z-50 h-14 w-14 rounded-full shadow-lg transition-transform duration-300 hover:scale-105 hover:shadow-xl focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-700 focus-visible:ring-offset-2 active:scale-95 motion-reduce:transition-none motion-reduce:hover:scale-100 motion-reduce:active:scale-100 sm:right-6"
        aria-label={
          open ? 'Fechar chat demonstrativo' : 'Abrir chat demonstrativo'
        }
        aria-controls={open ? dialogId : undefined}
        aria-expanded={open}
      >
        {!open && (
          <span className="absolute inset-0 rounded-full bg-amber-500 opacity-30 motion-safe:animate-ping" />
        )}
        <img
          src="/chatbot.svg"
          alt=""
          className="relative z-10 h-14 w-14 rounded-full object-cover"
        />
      </button>
    </>
  )
}
