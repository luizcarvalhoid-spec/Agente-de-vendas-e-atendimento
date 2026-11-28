type History = readonly { readonly role: 'user' | 'assistant'; readonly content: string }[]

type Wordings = readonly [string, ...string[]]
export type ClarificationPrompt = string | Wordings

const introductions = [
  'Pelo que você me contou, eu escolheria ',
  'Para o que você procura, sugiro ',
  'Minha indicação para esta busca é ',
] as const

const conversationalReplies = {
  price: ['Entendo que o preço pesa na decisão.', 'Faz sentido levar o preço em conta.'],
  hesitation: ['Tudo bem decidir no seu tempo.', 'Você pode decidir com calma.'],
  pause: ['Tudo bem. Podemos retomar quando você quiser.', 'Sem pressa. Podemos retomar quando você quiser.'],
  stop: ['Tudo bem, vou encerrar esta busca.', 'Certo, vou encerrar esta busca por aqui.'],
  product: ['Entendido. Vou deixar esse produto de fora desta busca.', 'Vou deixar esse produto de fora desta busca.'],
  unverified: ['Não consegui verificar essa informação com os dados disponíveis.', 'Com os dados disponíveis, ainda não consigo confirmar essa informação.'],
} as const

type ReplyKind = keyof typeof conversationalReplies

function asWordings(prompt: ClarificationPrompt): Wordings {
  return typeof prompt === 'string' ? [prompt] : prompt
}

function endsWithBlock(reply: string, text: string) {
  return reply === text || reply.endsWith('\n\n' + text)
}

export function matchesClarificationQuestion(reply: string, prompt: ClarificationPrompt) {
  return asWordings(prompt).some((text) => endsWithBlock(reply, text))
}

export function recommendationSubject(
  message: string,
  products: readonly { readonly id: number; readonly name: string }[],
) {
  const matches = products.filter(({ name }) => introductions.some((prefix) => {
    const introduction = prefix + name + '.'
    return message.startsWith(introduction) &&
      (message.length === introduction.length || /^\s/.test(message.slice(introduction.length)))
  }))
  return matches.length === 1 ? matches[0]?.id : undefined
}

export function createConversationLanguage(history: History = []) {
  const replies = history.filter(({ role }) => role === 'assistant').map(({ content }) => content)
  const choose = (variants: Wordings, matches: (reply: string, variant: string) => boolean) => {
    for (let index = replies.length - 1; index >= 0; index -= 1) {
      const reply = replies[index]
      if (reply === undefined) continue
      const previous = variants.findIndex((variant) => matches(reply, variant))
      if (previous !== -1) return variants[(previous + 1) % variants.length] ?? variants[0]
    }
    return variants[0]
  }

  return {
    recommendation(name: string) {
      return choose(introductions, (reply, prefix) => reply.startsWith(prefix)) + name + '.'
    },
    question(prompt: ClarificationPrompt) {
      return choose(asWordings(prompt), endsWithBlock)
    },
    reply(kind: ReplyKind) {
      return choose(conversationalReplies[kind], (reply, variant) => reply.split('\n\n').includes(variant))
    },
    comparison(details: readonly [string, string], notice?: string) {
      return [details[0], details[1], notice].filter(Boolean).join(' ')
    },
    withSupportingText(text: string, supportingText?: string) {
      return supportingText ? text + '\n\n' + supportingText : text
    },
  }
}

export type ConversationLanguage = ReturnType<typeof createConversationLanguage>
