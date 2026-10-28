import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Search } from 'lucide-react'

export interface OpcaoMulti {
  value: string
  label: string
  /** Agrupa visualmente (ex.: segmento do projeto). Clicar no grupo marca/desmarca todos dele. */
  grupo?: string
  /** 2º nível dentro do grupo (ex.: ensino dentro do ano). Clicar nele marca/desmarca só os dele. */
  subgrupo?: string
  cor?: string
  dica?: string
}

interface Props {
  rotulo: string
  /** Texto quando nada está marcado (= tudo). */
  vazio: string
  opcoes: OpcaoMulti[]
  selecionados: Set<string>
  onChange: (next: Set<string>) => void
  largura?: number
}

const semAcento = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

export function MultiSelect({ rotulo, vazio, opcoes, selecionados, onChange, largura = 300 }: Props) {
  const [aberto, setAberto] = useState(false)
  const [busca, setBusca] = useState('')
  const [alinhaDireita, setAlinhaDireita] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!aberto) return
    const fora = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setAberto(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setAberto(false) }
    document.addEventListener('mousedown', fora)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', fora); document.removeEventListener('keydown', esc) }
  }, [aberto])

  const visiveis = useMemo(() => {
    const q = semAcento(busca.trim())
    return q ? opcoes.filter(o => semAcento(o.label).includes(q)) : opcoes
  }, [opcoes, busca])

  // grupo → { todas as opções do grupo, subgrupos na ordem recebida }
  const grupos = useMemo(() => {
    const m = new Map<string, { todas: OpcaoMulti[]; subs: Map<string, OpcaoMulti[]> }>()
    for (const o of visiveis) {
      const g = o.grupo ?? ''
      if (!m.has(g)) m.set(g, { todas: [], subs: new Map() })
      const e = m.get(g)!
      e.todas.push(o)
      const sg = o.subgrupo ?? ''
      if (!e.subs.has(sg)) e.subs.set(sg, [])
      e.subs.get(sg)!.push(o)
    }
    return [...m.entries()]
  }, [visiveis])

  function alternar(v: string) {
    const next = new Set(selecionados)
    if (next.has(v)) next.delete(v); else next.add(v)
    onChange(next)
  }
  function alternarLista(lista: OpcaoMulti[]) {
    const next = new Set(selecionados)
    const todos = lista.every(o => next.has(o.value))
    for (const o of lista) { if (todos) next.delete(o.value); else next.add(o.value) }
    onChange(next)
  }

  const n = [...selecionados].filter(v => opcoes.some(o => o.value === v)).length
  const resumo = n === 0
    ? vazio
    : n === 1
      ? (opcoes.find(o => selecionados.has(o.value))?.label ?? '1 selecionado')
      : `${n} selecionados`

  return (
    <div className="relative w-full sm:w-auto" ref={ref}>
      <button
        type="button"
        onClick={() => {
          if (!aberto && ref.current) {
            // Sem espaço à direita: abre alinhado pela borda direita do botão.
            const r = ref.current.getBoundingClientRect()
            const larg = Math.min(largura, window.innerWidth * 0.92)
            setAlinhaDireita(r.left + larg > window.innerWidth - 8 && r.right >= larg)
          }
          setAberto(v => !v)
        }}
        className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors sm:w-auto ${
          n > 0 ? 'border-primary/60 bg-primary/10' : 'border-white/10 bg-surface-2 hover:border-white/25'
        }`}
        style={{ minWidth: 168, maxWidth: 260 }}
        aria-haspopup="listbox"
        aria-expanded={aberto}
      >
        <span className="flex min-w-0 flex-col leading-tight">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">{rotulo}</span>
          <span className={`truncate ${n > 0 ? 'font-semibold text-text-main' : 'text-text-muted'}`}>{resumo}</span>
        </span>
        <ChevronDown size={14} className={`ml-auto shrink-0 text-text-muted transition-transform ${aberto ? 'rotate-180' : ''}`} />
      </button>

      {aberto && (
        <div
          className={`absolute ${alinhaDireita ? 'right-0' : 'left-0'} top-full z-50 mt-1.5 overflow-hidden rounded-xl border border-white/15 bg-surface shadow-2xl`}
          style={{ width: largura, maxWidth: '92vw' }}
        >
          <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2">
            <Search size={14} className="shrink-0 text-text-muted" />
            <input
              autoFocus
              value={busca}
              onChange={e => setBusca(e.target.value)}
              placeholder={`Buscar em ${rotulo.toLowerCase()}...`}
              className="w-full bg-transparent text-sm text-text-main outline-none placeholder:text-text-muted"
            />
          </div>
          <div className="flex items-center justify-between border-b border-white/10 px-3 py-1.5 text-[11px]">
            <button type="button" className="font-medium text-primary hover:underline" onClick={() => alternarLista(visiveis)}>
              {visiveis.length > 0 && visiveis.every(o => selecionados.has(o.value)) ? 'Desmarcar visíveis' : `Marcar visíveis (${visiveis.length})`}
            </button>
            <button
              type="button"
              className="text-text-muted hover:text-text-main disabled:opacity-40"
              disabled={n === 0}
              onClick={() => onChange(new Set())}
            >
              Limpar
            </button>
          </div>
          <div className="max-h-72 overflow-y-auto py-1">
            {visiveis.length === 0 && <p className="px-3 py-4 text-center text-xs text-text-muted">Nada encontrado.</p>}
            {grupos.map(([g, { todas, subs }]) => (
              <div key={g || '_'}>
                {g && (
                  <button
                    type="button"
                    onClick={() => alternarLista(todas)}
                    className="flex w-full items-center gap-2 border-t border-white/5 bg-white/[0.03] px-3 pb-1 pt-2 text-left text-[11px] font-bold uppercase tracking-wider text-text-main hover:bg-white/[0.07]"
                    title="Marcar ou desmarcar o grupo inteiro"
                  >
                    {todas[0]?.cor && todas.every(x => x.cor === todas[0].cor) && <span className="h-2 w-2 rounded-full" style={{ background: todas[0].cor }} />}
                    {g}
                    <span className="font-normal normal-case tracking-normal text-text-muted">· {todas.length}</span>
                  </button>
                )}
                {[...subs.entries()].map(([sg, lista]) => (
                  <div key={sg || '_'}>
                    {sg && (
                      <button
                        type="button"
                        onClick={() => alternarLista(lista)}
                        className="flex w-full items-center gap-2 px-3 pb-0.5 pl-5 pt-1.5 text-left text-[10px] font-semibold uppercase tracking-wider text-text-muted hover:text-text-main"
                        title="Marcar ou desmarcar só este grupo"
                      >
                        {lista[0]?.cor && lista.every(x => x.cor === lista[0].cor) && <span className="h-2 w-2 rounded-full" style={{ background: lista[0].cor }} />}
                        {sg}
                        <span className="font-normal normal-case tracking-normal">· {lista.length}</span>
                      </button>
                    )}
                    {lista.map(o => {
                      const on = selecionados.has(o.value)
                      return (
                        <button
                          type="button"
                          key={o.value}
                          onClick={() => alternar(o.value)}
                          className={`flex w-full items-center gap-2.5 py-1.5 pr-3 text-left hover:bg-white/5 ${sg ? 'pl-7' : 'pl-3'}`}
                          role="option"
                          aria-selected={on}
                        >
                          <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${on ? 'border-primary bg-primary' : 'border-white/30'}`}>
                            {on && <Check size={11} className="text-white" strokeWidth={3} />}
                          </span>
                          {o.cor && !sg && !todas.every(x => x.cor === o.cor) && <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: o.cor }} />}
                          <span className="min-w-0 flex-1 truncate text-sm text-text-main">{o.label}</span>
                          {o.dica && <span className="shrink-0 text-[11px] text-text-muted">{o.dica}</span>}
                        </button>
                      )
                    })}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
