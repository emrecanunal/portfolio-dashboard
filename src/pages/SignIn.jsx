// Giriş ekranı: parola ya da e-postaya gelen tek kullanımlık bağlantı.
//
// NEDEN İKİSİ BİRDEN — VE PAROLA NEDEN SONRADAN GELDİ
//
// Başlangıçta yalnızca magic link vardı ve gerekçesi hâlâ geçerli: parola,
// kullanıcının hatırlaması ve bizim saklamamız gereken bir sır ekler, üstelik
// "şifremi unuttum" akışı zaten e-postaya bağlantı yollamaya varır.
//
// Ama Supabase'in yerleşik e-posta servisi SAATTE 2 mesaj gönderiyor ve
// yalnızca proje ekibindeki adreslere ulaşıyor. Tek kullanıcı için bile dar:
// iki cihazda arka arkaya giriş denemek limiti bitiriyor ve bir saat kapıda
// bekliyorsun. Parola bu bağımlılığı tamamen kaldırıyor — hiçbir e-posta
// gönderilmiyor.
//
// Magic link kalıyor çünkü davet akışı için doğru yol o: yeni bir kullanıcıya
// "önce bir parola belirle" diyemezsin, henüz hesabı yok.
//
// PAROLA ALANI VARSAYILAN, BAĞLANTI İKİNCİL
//
// Günlük kullanan kişi parolayı kullanacak; davet edilen kişi bağlantıyı, ve o
// bir kez olacak bir şey. Sık olanı öne koymak, nadir olanı bir tık arkaya.

import { useState } from 'react'
import { Mail, ArrowLeft, Loader2 } from 'lucide-react'
import { sendMagicLink, signInWithPassword } from '../lib/backend/index.js'
import { Button } from '../components/ui/Primitives.jsx'
import { useT } from '../i18n/useT.js'

const FIELD =
  'w-full px-3 py-2.5 rounded-lg bg-bg-tertiary border border-border-default ' +
  'text-sm text-text-primary placeholder:text-text-muted ' +
  'focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-border-strong ' +
  'disabled:opacity-60 transition-all'

export function SignIn() {
  const { t, ti } = useT()
  const [mode, setMode] = useState('password')   // password | link
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [state, setState] = useState('idle')     // idle | working | sent | error
  const [error, setError] = useState('')

  async function submit(e) {
    e.preventDefault()
    const address = email.trim()
    if (!address) return

    setState('working')
    setError('')

    const result = mode === 'password'
      ? await signInWithPassword(address, password)
      : await sendMagicLink(address)

    if (!result.ok) {
      setState('error')
      setError(result.error || '')
      return
    }
    // Parola girişinde "başarılı" ekranı yok: oturum kurulunca AuthGate zaten
    // bu bileşeni söküyor, o ekran bir kare parlayıp kaybolurdu.
    setState(mode === 'link' ? 'sent' : 'idle')
  }

  function switchTo(next) {
    setMode(next)
    setState('idle')
    setError('')
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
            <h1 className="text-base font-medium text-text-primary mb-2">{t.auth.sentTitle}</h1>
            <p className="text-sm text-text-tertiary leading-relaxed mb-6">
              {ti(t.auth.sentBody, { email: email.trim() })}
            </p>
            <button
              type="button"
              onClick={() => switchTo('password')}
              className="text-xs text-text-tertiary hover:text-text-primary inline-flex items-center gap-1.5 transition-colors"
            >
              <ArrowLeft className="w-3 h-3" />
              {t.auth.backToPassword}
            </button>
          </div>
        ) : (
          <form onSubmit={submit}>
            <h1 className="text-base font-medium text-text-primary mb-1">{t.auth.title}</h1>
            <p className="text-sm text-text-tertiary mb-5 leading-relaxed">
              {mode === 'password' ? t.auth.subtitlePassword : t.auth.subtitle}
            </p>

            <input
              type="email"
              required
              autoFocus
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t.auth.emailPlaceholder}
              disabled={state === 'working'}
              className={FIELD}
            />

            {mode === 'password' && (
              <input
                type="password"
                required
                // current-password: parola yöneticileri bunu görüp kayıtlı
                // girişi teklif ediyor. Telefonda uzun bir parolayı elle yazmak,
                // kaçınmak istediğimiz sürtünmenin ta kendisi.
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t.auth.passwordPlaceholder}
                disabled={state === 'working'}
                className={`${FIELD} mt-2`}
              />
            )}

            {state === 'error' && (
              <p className="mt-2 text-xs text-danger leading-relaxed">
                {mode === 'password' ? t.auth.signInFailed : t.auth.failed}
                {error ? ` — ${error}` : ''}
              </p>
            )}

            <Button
              type="submit"
              size="lg"
              disabled={state === 'working'}
              className="w-full mt-4 inline-flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {state === 'working' && <Loader2 className="w-4 h-4 animate-spin" />}
              {state === 'working'
                ? (mode === 'password' ? t.auth.signingIn : t.auth.sending)
                : (mode === 'password' ? t.auth.signIn : t.auth.send)}
            </Button>

            <button
              type="button"
              onClick={() => switchTo(mode === 'password' ? 'link' : 'password')}
              className="w-full mt-3 text-xs text-text-tertiary hover:text-text-primary transition-colors"
            >
              {mode === 'password' ? t.auth.useLinkInstead : t.auth.usePasswordInstead}
            </button>
          </form>
        )}

        <p className="mt-8 text-2xs text-text-muted text-center leading-relaxed">
          {t.auth.privacy}
        </p>
      </div>
    </div>
  )
}
