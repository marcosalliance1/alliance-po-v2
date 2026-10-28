import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { Send, Sparkles, RotateCcw } from 'lucide-react'
import { supabase } from '../../lib/supabase'

// Painel de perguntas em linguagem natural sobre as verbas. Chama a função `verbas-assistente`
// (Supabase), que consulta os dados e responde com o Claude. Só funciona com login.

interface Turno { role: 'user' | 'assistant'; texto: string; ferramentas?: string[] }

const SUGESTOES = [
  'Quanto temos orçado para gerador em 2026, separado por local?',
  'Quais itens de floral já foram contratados e por quanto?',
  'Compare orçado e contratado da cenografia nos bailes do Expominas.',
  'Qual a média orçada de ambulância por projeto?',
]

// ── Markdown mínimo (parágrafos, listas, tabelas, **negrito**) sem HTML cru ──────────────────────
function inline(t: string): ReactNode[] {
  return t.split(/(\*\*[^*]+\*\*)/g).map((p, i) =>
    p.startsWith('**') && p.endsWith('**') && p.length > 4 ? <strong key={i}>{p.slice(2, -2)}</strong> : <Fragment key={i}>{p}</Fragment>,
  )
}

function Markdown({ texto }: { texto: string }) {
  const blocos = texto.replace(/\r/g, '').split(/\n{2,}/)
  return (
    <div className="space-y-2 text-sm leading-relaxed text-text-main">
      {blocos.map((b, bi) => {
        const linhas = b.split('\n').filter(l => l.trim() !== '')
        if (linhas.length === 0) return null
        if (linhas.length >= 2 && linhas.every(l => l.trim().startsWith('|'))) {
          const celulas = (l: string) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim())
          const cab = celulas(linhas[0])
          const corpo = linhas.slice(1).filter(l => !/^\|?\s*:?-{2,}/.test(l.trim())).map(celulas)
          return (
            <div key={bi} className="overflow-x-auto">
              <table className="w-full border-collapse text-xs">
                <thead><tr>{cab.map((c, i) => <th key={i} className="border-b border-white/15 px-2 py-1.5 text-left font-semibold text-text-muted">{inline(c)}</th>)}</tr></thead>
                <tbody>{corpo.map((r, ri) => (
                  <tr key={ri} className="border-b border-white/5">{r.map((c, ci) => <td key={ci} className="px-2 py-1.5 tabular-nums">{inline(c)}</td>)}</tr>
                ))}</tbody>
              </table>
            </div>
          )
        }
        if (linhas.every(l => /^\s*[-*]\s+/.test(l))) {
          return <ul key={bi} className="list-disc space-y-0.5 pl-5">{linhas.map((l, i) => <li key={i}>{inline(l.replace(/^\s*[-*]\s+/, ''))}</li>)}</ul>
        }
        return <p key={bi}>{linhas.map((l, i) => <Fragment key={i}>{i > 0 && <br />}{inline(l)}</Fragment>)}</p>
      })}
    </div>
  )
}

async function mensagemDeErro(e: unknown): Promise<string> {
  if (e instanceof FunctionsHttpError) {
    try {
      const corpo = await e.context.json()
      if (corpo?.erro) return String(corpo.erro)
    } catch { /* corpo não era JSON */ }
    return 'O assistente não respondeu. Tente de novo.'
  }
  return 'Não consegui falar com o assistente. Confira a conexão e tente de novo.'
}

export function AssistenteVerbas() {
  const [turnos, setTurnos] = useState<Turno[]>([])
  const [pergunta, setPergunta] = useState('')
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const fimRef = useRef<HTMLDivElement>(null)

  useEffect(() => { fimRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }) }, [turnos, carregando])

  async function perguntar(texto?: string) {
    const q = (texto ?? pergunta).trim()
    if (!q || carregando) return
    setErro(null)
    setPergunta('')
    const historico = turnos.slice(-6).map(t => ({ role: t.role, content: t.texto }))
    setTurnos(t => [...t, { role: 'user', texto: q }])
    setCarregando(true)
    try {
      const { data, error } = await supabase.functions.invoke('verbas-assistente', { body: { pergunta: q, historico } })
      if (error) throw error
      setTurnos(t => [...t, { role: 'assistant', texto: String(data?.resposta ?? 'Sem resposta.'), ferramentas: data?.ferramentas }])
    } catch (e) {
      setErro(await mensagemDeErro(e))
    } finally {
      setCarregando(false)
    }
  }

  return (
    <div className="card !p-4">
      <div className="mb-3 flex items-center gap-2">
        <Sparkles size={16} className="text-primary" />
        <h2 className="text-sm font-semibold text-text-main">Pergunte sobre as verbas</h2>
        <span className="text-xs text-text-muted">· responde com o orçado e o contratado dos projetos</span>
        {turnos.length > 0 && (
          <button
            type="button"
            onClick={() => { setTurnos([]); setErro(null) }}
            className="ml-auto inline-flex items-center gap-1 text-xs text-text-muted hover:text-text-main"
          >
            <RotateCcw size={12} /> Nova conversa
          </button>
        )}
      </div>

      {turnos.length > 0 && (
        <div className="mb-3 max-h-[480px] space-y-3 overflow-y-auto pr-1">
          {turnos.map((t, i) => t.role === 'user' ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[85%] rounded-xl rounded-br-sm bg-primary/15 px-3 py-2 text-sm text-text-main">{t.texto}</div>
            </div>
          ) : (
            <div key={i} className="rounded-xl rounded-bl-sm border border-white/10 bg-surface-2 px-3 py-2.5">
              <Markdown texto={t.texto} />
              {t.ferramentas && t.ferramentas.length > 0 && (
                <p className="mt-2 text-[11px] text-text-muted">Consultei {t.ferramentas.length} vez(es) os dados de orçado e contratado.</p>
              )}
            </div>
          ))}
          {carregando && (
            <div className="flex items-center gap-2 text-xs text-text-muted">
              <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary border-t-transparent" /> Consultando as verbas…
            </div>
          )}
          <div ref={fimRef} />
        </div>
      )}

      {erro && <p className="mb-3 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-text-main">{erro}</p>}

      <form onSubmit={e => { e.preventDefault(); void perguntar() }} className="flex gap-2">
        <input
          value={pergunta}
          onChange={e => setPergunta(e.target.value)}
          maxLength={1000}
          placeholder="Ex.: quanto temos para gastar com gerador nos bailes do Expominas?"
          className="min-w-0 flex-1 rounded-lg border border-white/10 bg-surface-2 px-3 py-2 text-sm text-text-main placeholder:text-text-muted"
          aria-label="Pergunta sobre as verbas"
        />
        <button type="submit" disabled={!pergunta.trim() || carregando} className="btn-primary flex items-center gap-1.5 disabled:opacity-50">
          <Send size={14} /> Perguntar
        </button>
      </form>

      {turnos.length === 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {SUGESTOES.map(s => (
            <button
              key={s}
              type="button"
              onClick={() => void perguntar(s)}
              disabled={carregando}
              className="rounded-full border border-white/10 bg-surface-2 px-3 py-1 text-xs text-text-muted hover:border-primary/50 hover:text-text-main disabled:opacity-50"
            >
              {s}
            </button>
          ))}
        </div>
      )}
      <p className="mt-3 text-[11px] text-text-muted">Confira os valores importantes na tabela abaixo. O assistente não tem acesso a receita, margem ou pagamentos.</p>
    </div>
  )
}
