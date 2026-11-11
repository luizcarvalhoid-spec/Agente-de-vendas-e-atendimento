import { Minus, RefreshCw, RotateCcw, Send, X } from 'lucide-react'
import {
  Fragment,
  type FormEvent,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react'

import {
  type ChatFailureReason,
  useChatConversation,
} from '../hooks/useChatConversation'
import ChatProductCards from '../components/ChatProductCards'

const initialMessage =
  'Olá! Sou a assistente consultiva demonstrativa da HidraSplash. Posso consultar o catálogo e as políticas fictícias quando a API estiver disponível. Não informe dados pessoais.'

const failureMessages: Record<ChatFailureReason, string> = {
  configuration:
    'O atendimento consultivo não está configurado neste ambiente.',
  network:
    'Não foi possível alcançar a API. Verifique a conexão e tente novamente.',
  validation:
    'A mensagem não pôde ser enviada. Revise o conteúdo e tente outra vez.',
  'rate-limited':
    'Muitas solicitações foram feitas. Aguarde o prazo indicado antes de tentar novamente.',
  unavailable:
    'O atendimento consultivo está temporariamente indisponível.',
  'bad-response':
    'A API não conseguiu produzir uma resposta consultiva válida.',
  timeout: 'A consulta demorou mais que o esperado e foi cancelada.',
  'invalid-response':
    'A API respondeu em um formato inesperado. Nenhum conteúdo parcial foi exibido.',
  server: 'Não foi possível concluir a consulta neste momento.',
}

export default function ChatbotButton() {
  const [open, setOpen] = useState(false)
  const [minimized, setMinimized] = useState(false)
  const [input, setInput] = useState('')
  const conversation = useChatConversation()
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const descriptionId = useId()
  const dialogId = useId()

  const closeChat = useCallback(() => {
    conversation.cancelActive()
    setOpen(false)
    setMinimized(false)
    window.requestAnimationFrame(() => triggerRef.current?.focus())
  }, [conversation])

  useEffect(() => {
    if (!open || minimized || conversation.isPending) return
    const animationFrame = window.requestAnimationFrame(() => {
      inputRef.current?.focus()
    })
    return () => window.cancelAnimationFrame(animationFrame)
  }, [conversation.isPending, minimized, open])

  useEffect(() => {
    if (!open) return
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeChat()
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [closeChat, open])

  useEffect(() => {
    if (!open || minimized) return
    const container = messagesContainerRef.current
    container?.scrollTo({ top: container.scrollHeight, behavior: 'auto' })
  }, [
    conversation.failure,
    conversation.isPending,
    conversation.retryAfterSeconds,
    conversation.turns,
    minimized,
    open,
  ])

  const sendMessage = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (conversation.send(input)) setInput('')
  }

  const editValidationMessage = () => {
    const message = conversation.takeValidationMessageForEditing()
    if (message === undefined) return
    setInput(message)
    window.requestAnimationFrame(() => inputRef.current?.focus())
  }

  const activeAttempt = conversation.pending ?? conversation.failure
  const retryBlocked = conversation.retryAfterSeconds > 0

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
            Atendimento consultivo demonstrativo sujeito à disponibilidade da
            API e do modelo. Não informe dados pessoais.
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
                  Atendimento consultivo
                </h2>
                <p className="mt-0.5 flex items-center gap-1 text-[11px] text-amber-50">
                  <span
                    aria-hidden="true"
                    className="inline-block h-1.5 w-1.5 rounded-full bg-amber-200"
                  />
                  Demonstração sujeita à disponibilidade
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  conversation.startNewConversation()
                  setInput('')
                }}
                className="flex min-h-11 min-w-11 items-center justify-center rounded-full transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                aria-label="Iniciar nova conversa"
              >
                <RotateCcw aria-hidden="true" size={17} />
              </button>
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
                aria-label="Mensagens do atendimento consultivo"
                aria-busy={conversation.isPending}
                className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-gray-50 px-4 py-3 overscroll-contain"
              >
                <AssistantMessage text={initialMessage} />
                {conversation.turns.map((turn) => (
                  <Fragment key={turn.id}>
                    <UserMessage text={turn.userMessage} />
                    <AssistantMessage text={turn.response.message} />
                    {turn.response.type !== 'text' && (
                      <ChatProductCards
                        response={turn.response}
                        restored={turn.restored}
                      />
                    )}
                  </Fragment>
                ))}

                {activeAttempt && <UserMessage text={activeAttempt.message} />}

                {conversation.isPending && (
                  <div className="flex items-end justify-start gap-2">
                    <img
                      src="/chatbot.svg"
                      alt=""
                      className="h-6 w-6 flex-shrink-0 rounded-full"
                    />
                    <div
                      className="flex gap-1 rounded-2xl rounded-bl-sm border border-gray-200 bg-white px-4 py-3 shadow-sm"
                      aria-label="Preparando resposta consultiva"
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

                {conversation.failure && (
                  <div className="flex items-start gap-2" role="alert">
                    <img
                      src="/chatbot.svg"
                      alt=""
                      className="mt-1 h-6 w-6 flex-shrink-0 rounded-full"
                    />
                    <div className="max-w-[85%] rounded-2xl rounded-bl-sm border border-red-200 bg-white px-3.5 py-2 text-sm leading-relaxed text-gray-700 shadow-sm">
                      <p>{failureMessages[conversation.failure.reason]}</p>
                      {conversation.failure.reason === 'validation' && (
                        <button
                          type="button"
                          onClick={editValidationMessage}
                          className="mt-2 inline-flex min-h-10 items-center rounded-full border border-amber-800 px-3 py-1.5 text-xs font-semibold text-amber-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-800"
                        >
                          Editar mensagem
                        </button>
                      )}
                      {conversation.failure.canRetry && (
                        <button
                          type="button"
                          onClick={conversation.retry}
                          disabled={retryBlocked || conversation.isPending}
                          className="mt-2 inline-flex min-h-10 items-center gap-1.5 rounded-full border border-amber-800 px-3 py-1.5 text-xs font-semibold text-amber-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-800 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <RefreshCw aria-hidden="true" size={14} />
                          {retryBlocked
                            ? `Tente em ${conversation.retryAfterSeconds}s`
                            : 'Tentar novamente'}
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <form
                onSubmit={sendMessage}
                className="border-t border-gray-200 bg-white px-3 py-3"
              >
                <p className="mb-2 text-[11px] leading-snug text-gray-500">
                  Demonstração fictícia. Não informe dados pessoais.
                </p>
                <div className="flex items-center gap-2">
                  <label htmlFor={`${dialogId}-message`} className="sr-only">
                    Mensagem para o atendimento consultivo
                  </label>
                  <input
                    ref={inputRef}
                    id={`${dialogId}-message`}
                    type="text"
                    value={input}
                    maxLength={4_000}
                    disabled={conversation.isPending}
                    onChange={(event) => setInput(event.target.value)}
                    placeholder="Como posso ajudar?"
                    className="min-h-11 min-w-0 flex-1 rounded-full border border-gray-300 bg-gray-50 px-3.5 py-2 text-sm text-gray-700 placeholder-gray-500 transition-all focus:border-amber-700 focus:outline-none focus:ring-2 focus:ring-amber-700/40 disabled:cursor-wait disabled:opacity-70"
                  />
                  <button
                    type="submit"
                    disabled={!input.trim() || !conversation.canSend}
                    className="flex min-h-11 min-w-11 flex-shrink-0 items-center justify-center rounded-full bg-amber-800 text-white shadow-sm transition-colors hover:bg-amber-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-800 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-700"
                    aria-label="Enviar mensagem"
                  >
                    <Send aria-hidden="true" size={17} />
                  </button>
                </div>
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
        aria-label={open ? 'Fechar chat' : 'Abrir atendimento consultivo'}
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

function UserMessage({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-amber-800 px-3.5 py-2 text-sm leading-relaxed text-white">
        {text}
      </div>
    </div>
  )
}

function AssistantMessage({ text }: { text: string }) {
  return (
    <div className="flex justify-start">
      <img
        src="/chatbot.svg"
        alt=""
        className="mr-2 mt-1 h-6 w-6 flex-shrink-0 rounded-full"
      />
      <div className="max-w-[80%] rounded-2xl rounded-bl-sm border border-gray-200 bg-white px-3.5 py-2 text-sm leading-relaxed text-gray-700 shadow-sm">
        {text}
      </div>
    </div>
  )
}
