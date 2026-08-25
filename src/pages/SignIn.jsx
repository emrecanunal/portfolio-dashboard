// Giriş ekranı: e-posta gir, gelen bağlantıya tıkla.
//
// PAROLA NEDEN YOK
//
// Parola, kullanıcının hatırlaması gereken bir sır ve bizim saklamamız gereken
// bir sorumluluk ekler; ikisi de karşılığında bir şey vermez. Tek kullanıcılık
// bir üründe "şifremi unuttum" akışı zaten e-postaya bağlantı yollamaya
// varıyor — yani parola, aynı yere giden yolun üstüne konmuş fazladan bir kapı.
// Telefonda uzun bir parola yazmak da bu uygulamanın en sık yapılacak işi
// olmamalı.
//
// GÖNDERDİKTEN SONRA EKRAN NEDEN DEĞİŞİYOR
//
// "Bağlantı yollandı" bilgisini bir tost mesajıyla verip formu bırakmak,
// kullanıcının e-postayı beklerken tekrar tekrar "Gönder"e basmasına yol açıyor
// — ve her basış Supabase'in hız sınırına yaklaştırıyor. Form yerini bir
// bekleme ekranına bırakınca basılacak bir düğme kalmıyor.

import { useState } from 'react'
import { Mail, ArrowLeft, Loader2 } from 'lucide-react'
import { sendMagicLink } from '../lib/backend/index.js'
import { Button } from '../components/ui/Primitives.jsx'
import { useT } from '../i18n/useT.js'

export function SignIn() {
  const { t, ti } = useT()
  const [email, setEmail] = useState('')
  const [state, setState] = useState('idle')   // idle | sending | sent | error
  const [error, setError] = useState('')

  async function submit(e) {
    e.preventDefault()
    const address = email.trim()
    if (!address) return

    setState('sending')
    setError('')
    const result = await sendMagicLink(address)

    if (result.ok) {
      setState('sent')
    } else {
      setState('error')
      setError(result.error || '')
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-bg-primary">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="display-font text-2xl text-text-primary">portfolio</div>
          <div className="text-2xs uppercase tracking-widest text-text-tertiary mt-1">
            FIRE tracker
          </div>
        </div>

        {state === 'sent' ? (
          <div className="text-center">
            <div className="w-12 h-12 rounded-full bg-success/10 flex items-center justify-center mx-auto mb-4">
              <Mail className="w-5 h-5 text-success" />
            </div>
            <h1 className="text-base font-medium text-text-primary mb-2">
              {t.auth.sentTitle}
            </h1>
            <p className="text-sm text-text-tertiary leading-relaxed mb-6">
              {ti(t.auth.sentBody, { email: email.trim() })}
            </p>
            <button
              type="button"
              onClick={() => { setState('idle'); setError('') }}
              className="text-xs text-text-tertiary hover:text-text-primary inline-flex items-center gap-1.5 transition-colors"
            >
              <ArrowLeft className="w-3 h-3" />
              {t.auth.useAnother}
            </button>
          </div>
        ) : (
          <form onSubmit={submit}>
            <h1 className="text-base font-medium text-text-primary mb-1">
              {t.auth.title}
            </h1>
            <p className="text-sm text-text-tertiary mb-5 leading-relaxed">
              {t.auth.subtitle}
            </p>

            <input
              type="email"
              required
              autoFocus
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t.auth.emailPlaceholder}
              disabled={state === 'sending'}
              className="w-full px-3 py-2.5 rounded-lg bg-bg-tertiary border border-border-default
                         text-sm text-text-primary placeholder:text-text-muted
                         focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-border-strong
                         disabled:opacity-60 transition-all"
            />

            {state === 'error' && (
              <p className="mt-2 text-xs text-danger leading-relaxed">
                {t.auth.failed}{error ? ` — ${error}` : ''}
              </p>
            )}

            <Button
              type="submit"
              size="lg"
              disabled={state === 'sending'}
              className="w-full mt-4 inline-flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {state === 'sending' && <Loader2 className="w-4 h-4 animate-spin" />}
              {state === 'sending' ? t.auth.sending : t.auth.send}
            </Button>
          </form>
        )}

        <p className="mt-8 text-2xs text-text-muted text-center leading-relaxed">
          {t.auth.privacy}
        </p>
      </div>
    </div>
  )
}
