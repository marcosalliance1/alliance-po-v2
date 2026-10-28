import { Fragment, useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Download, FileText, FilterX } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { formatBRL } from '../utils/formatters'
import {
  exportarVerbasExcel,
  type CategoriaBloco, type ColunaProjeto, type ConjuntoExport, type LinhaValores,
} from '../lib/exportarVerbasExcel'
import { MultiSelect, type OpcaoMulti } from '../components/verbas/MultiSelect'
import { gerarPdfVerbas } from '../lib/gerarPdfVerbas'
import { AssistenteVerbas } from '../components/verbas/AssistenteVerbas'

// ── Tipos locais ─────────────────────────────────────────────────────────────
// Lê direto de projetos.secoes — mesmo dado já mantido em dia pelo sync (manual
// ou automático). Sem pipeline/tabela própria, sem sync próprio.

interface ItemRaw {
  item: string
  subcategoria: string
  fornecedor?: string
  status?: string
  valorOrcado: number
  valorContratado?: number
  valorFinal?: number
}
interface SecaoRaw {
  nome: string
  itens: ItemRaw[]
}
interface ProjetoRaw {
  id: string
  tap: { tipoEscola?: string; turma?: string; instituicao?: string; curso?: string; local?: string; dataEvento?: string; anoRealizacao?: number }
  secoes: SecaoRaw[]
  total_convidados_atual?: number | null
}

// ── Categorias fixas, na ordem combinada ────────────────────────────────────
// "Bar" e "Food e Outros" ficam juntos porque são uma seção só na P.O. (2.4 CUSTO
// BAR & FOOD E OUTROS). Administrativos e Pré-Eventos ficam de fora (não são
// "verba" de produção do evento).
const CATEGORIAS_ORDEM = [
  'Produção', 'Artístico', 'Equipe', 'Bar & Food e Outros', 'Cerimônia Religiosa', 'Colação de Grau',
] as const

function categoriaDaSecao(nomeSecao: string): string | null {
  const n = (nomeSecao || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  if (n.includes('administrativ')) return null
  if (n.includes('pre-event') || n.includes('pre event') || n.includes('preevent') || n.includes('pre-eventos')) return null
  if (n.includes('producao')) return 'Produção'
  if (n.includes('artistic')) return 'Artístico'
  if (n.includes('equipe')) return 'Equipe'
  if (n.includes('bar') || n.includes('food')) return 'Bar & Food e Outros'
  if (n.includes('cerimonia')) return 'Cerimônia Religiosa'
  if (n.includes('colacao')) return 'Colação de Grau'
  return null
}

type Segmento = '9º Ano' | 'Ensino Médio' | 'Ensino Superior'
const SEGMENTOS: Segmento[] = ['9º Ano', 'Ensino Médio', 'Ensino Superior']

interface GrupoSalvo { id: string; nome: string; itens: { categoria: string; sub: string; item: string }[] }
const chaveItem = (categoria: string, sub: string, item: string) => `${categoria}|${sub}|${item}`

const CORES_SEGMENTO: Record<string, string> = {
  '9º Ano': '#e94560',
  'Ensino Médio': '#0078d4',
  'Ensino Superior': '#00b894',
}

function segmentoDoTipo(tipoEscola?: string): Segmento {
  if (tipoEscola === 'SUPERIOR') return 'Ensino Superior'
  if (tipoEscola === 'FUNDAMENTAL') return '9º Ano'
  return 'Ensino Médio'
}

// Cores da leitura: azul = o que foi orçado, verde = o que já foi contratado (fechado).
const COR_ORC = '#4f8cff'
const COR_CONTR = '#00b894'
const COR_BOM = '#00b894'
const COR_RUIM = '#e17055'

type Metrica = 'orcado' | 'contratado' | 'comparar'
type Visao = 'itens' | 'planilha'

interface Linha {
  projetoId: string
  categoria: string
  sub: string
  item: string
  fornecedor: string
  status: string
  orc: number
  contr: number
}

// Contratado = valor final dos itens com status "fechado" (mesma regra da coluna Valor Final da P.O.).
function contratadoDe(it: ItemRaw): number {
  if (it.status !== 'fechado') return 0
  const v = (it.valorFinal ?? 0) > 0 ? it.valorFinal! : (it.valorContratado ?? 0)
  return v > 0 ? v : 0
}

const dataCurta = (iso?: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '')
  return m ? `${m[3]}/${m[2]}/${m[1].slice(2)}` : ''
}

function montarBlocos(rows: Linha[], pick: (r: Linha) => number): CategoriaBloco[] {
  const nova = (): LinhaValores => ({ valores: {}, total: 0 })
  const somar = (dest: LinhaValores, pid: string, v: number) => {
    dest.valores[pid] = (dest.valores[pid] ?? 0) + v
    dest.total += v
  }
  const porCategoria = new Map<string, Map<string, Map<string, LinhaValores>>>()
  for (const r of rows) {
    const v = pick(r)
    if (v <= 0) continue
    if (!porCategoria.has(r.categoria)) porCategoria.set(r.categoria, new Map())
    const porSub = porCategoria.get(r.categoria)!
    if (!porSub.has(r.sub)) porSub.set(r.sub, new Map())
    const porItem = porSub.get(r.sub)!
    if (!porItem.has(r.item)) porItem.set(r.item, nova())
    somar(porItem.get(r.item)!, r.projetoId, v)
  }
  const resultado: CategoriaBloco[] = []
  for (const categoria of CATEGORIAS_ORDEM) {
    const porSub = porCategoria.get(categoria)
    if (!porSub) continue
    const catTotal = nova()
    const subcategorias = [...porSub.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([nomeSub, porItem]) => {
      const subTotal = nova()
      const itens = [...porItem.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([item, linha]) => {
        for (const [pid, v] of Object.entries(linha.valores)) somar(subTotal, pid, v)
        return { item, ...linha }
      })
      for (const [pid, v] of Object.entries(subTotal.valores)) somar(catTotal, pid, v)
      return { nome: nomeSub, itens, ...subTotal }
    })
    resultado.push({ categoria, subcategorias, ...catTotal })
  }
  return resultado
}

// ── Peças visuais ────────────────────────────────────────────────────────────

function Segmentado<T extends string>({ valor, opcoes, onChange }: {
  valor: T
  opcoes: { v: T; rotulo: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="inline-flex rounded-lg border border-white/10 bg-surface-2 p-0.5">
      {opcoes.map(o => (
        <button
          key={o.v}
          type="button"
          onClick={() => onChange(o.v)}
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            valor === o.v ? 'bg-primary text-white shadow' : 'text-text-muted hover:text-text-main'
          }`}
        >
          {o.rotulo}
        </button>
      ))}
    </div>
  )
}

// Duas barras finas: azul = orçado, verde = contratado. Só aparece o que a leitura pede.
function Barras({ orc, contr, max, metrica }: { orc: number; contr: number; max: number; metrica: Metrica }) {
  const w = (v: number) => `${max > 0 ? Math.max(v > 0 ? 1.5 : 0, (v / max) * 100) : 0}%`
  return (
    <div className="flex w-full flex-col gap-1">
      {metrica !== 'contratado' && (
        <div className="h-1.5 w-full rounded-full bg-white/10">
          <div className="h-full rounded-full" style={{ width: w(orc), background: COR_ORC }} />
        </div>
      )}
      {metrica !== 'orcado' && (
        <div className="h-1.5 w-full rounded-full bg-white/10">
          <div className="h-full rounded-full" style={{ width: w(contr), background: COR_CONTR }} />
        </div>
      )}
    </div>
  )
}

function Valores({ orc, contr, metrica, tamanho = 'sm' }: { orc: number; contr: number; metrica: Metrica; tamanho?: 'sm' | 'xs' }) {
  const t = tamanho === 'xs' ? 'text-xs' : 'text-sm'
  return (
    <div className={`flex shrink-0 flex-col items-end tabular-nums leading-tight ${t}`}>
      {metrica !== 'contratado' && (
        orc > 0
          ? <span className="font-semibold" style={{ color: COR_ORC }}>{formatBRL(orc)}</span>
          : <span className="text-text-muted/60">sem orçado</span>
      )}
      {metrica !== 'orcado' && (
        contr > 0
          ? <span className="font-semibold" style={{ color: COR_CONTR }}>{formatBRL(contr)}</span>
          : <span className="text-text-muted/60">a contratar</span>
      )}
    </div>
  )
}

function Kpi({ rotulo, valor, sub, cor }: { rotulo: string; valor: string; sub: string; cor?: string }) {
  return (
    <div className="card !p-4" style={cor ? { borderTop: `3px solid ${cor}` } : undefined}>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">{rotulo}</div>
      <div className="mt-1 text-xl font-bold tabular-nums text-text-main">{valor}</div>
      <div className="mt-0.5 text-xs text-text-muted">{sub}</div>
    </div>
  )
}

// ── Página ───────────────────────────────────────────────────────────────────

interface Par { o: number; c: number }

export function Verbas() {
  const [projetosRaw, setProjetosRaw] = useState<ProjetoRaw[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  const [metrica, setMetrica] = useState<Metrica>('comparar')
  const [visao, setVisao] = useState<Visao>('itens')
  const [fProjetos, setFProjetos] = useState<Set<string>>(new Set())
  const [fLocais, setFLocais] = useState<Set<string>>(new Set())
  const [fCategorias, setFCategorias] = useState<Set<string>>(new Set())
  const [fItens, setFItens] = useState<Set<string>>(new Set())
  const [fSegmentos, setFSegmentos] = useState<Set<string>>(new Set())
  const [fAnos, setFAnos] = useState<Set<string>>(new Set())
  const [fGrupos, setFGrupos] = useState<Set<string>>(new Set())
  const [busca, setBusca] = useState('')
  const [grupos, setGrupos] = useState<GrupoSalvo[]>([])
  const [painelGrupos, setPainelGrupos] = useState<'nenhum' | 'salvar' | 'gerenciar'>('nenhum')
  const [nomeGrupo, setNomeGrupo] = useState('')
  const [msgGrupo, setMsgGrupo] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [catAbertas, setCatAbertas] = useState<Record<string, boolean>>({})
  const [itensAbertos, setItensAbertos] = useState<Record<string, boolean>>({})

  useEffect(() => {
    supabase
      .from('projetos')
      .select('id, tap, secoes, total_convidados_atual')
      .then(({ data, error }) => {
        if (error) setErro(error.message)
        setProjetosRaw((data as ProjetoRaw[]) ?? [])
        setLoading(false)
      })
  }, [])

  async function carregarGrupos() {
    const { data, error } = await supabase.from('verbas_grupos').select('id, nome, itens').order('nome')
    if (!error) setGrupos((data as GrupoSalvo[]) ?? [])
  }
  useEffect(() => {
    supabase.from('verbas_grupos').select('id, nome, itens').order('nome').then(({ data, error }) => {
      if (!error) setGrupos((data as GrupoSalvo[]) ?? [])
    })
  }, [])

  // ── Base: projetos e linhas (item × projeto) ───────────────────────────────
  const projetos = useMemo(() =>
    projetosRaw
      .map(p => ({
        id: p.id,
        nome: p.tap.turma || `${p.tap.instituicao ?? ''} ${p.tap.curso ?? ''}`.trim() || p.id.slice(0, 6),
        segmento: segmentoDoTipo(p.tap.tipoEscola),
        local: (p.tap.local ?? '').trim(),
        data: dataCurta(p.tap.dataEvento),
        ano: String(p.tap.anoRealizacao || (p.tap.dataEvento ?? '').slice(0, 4) || ''),
        convidados: p.total_convidados_atual ?? 0,
      }))
      .sort((a, b) => a.nome.localeCompare(b.nome)),
  [projetosRaw])

  const projetoPorId = useMemo(() => new Map(projetos.map(p => [p.id, p])), [projetos])

  const todasLinhas = useMemo(() => {
    const lista: Linha[] = []
    const compacta = (t: string) => t.replace(/\s+/g, ' ').trim()
    // Subcategoria que os demais projetos usam para cada nome de item.
    const subPadrao = new Map<string, Map<string, number>>()
    for (const p of projetosRaw) for (const secao of p.secoes ?? []) for (const it of secao.itens ?? []) {
      const nome = compacta(it.item ?? ''); const sub = (it.subcategoria ?? '').trim()
      if (!nome || !sub) continue
      const k = nome.toLowerCase()
      const m = subPadrao.get(k) ?? new Map<string, number>()
      m.set(sub, (m.get(sub) ?? 0) + 1); subPadrao.set(k, m)
    }
    const subDe = (nome: string) => {
      const m = subPadrao.get(nome.toLowerCase())
      return m ? [...m.entries()].sort((a, b) => b[1] - a[1])[0][0] : 'Outras'
    }
    for (const p of projetosRaw) {
      for (const secao of p.secoes ?? []) {
        const categoria = categoriaDaSecao(secao.nome)
        if (!categoria) continue
        for (const it of secao.itens ?? []) {
          let sub = (it.subcategoria ?? '').trim()
          if (!sub) continue // item-mãe / linha de grupo
          let nomeItem = compacta(it.item ?? '')
          // Layout antigo (ex.: Balão Vermelho): o nome do item veio na subcategoria e o item ficou vazio.
          if (!nomeItem) { nomeItem = compacta(sub); sub = subDe(nomeItem) }
          const orc = it.valorOrcado ?? 0
          const contr = contratadoDe(it)
          if (orc <= 0 && contr <= 0) continue
          lista.push({
            projetoId: p.id, categoria, sub, item: nomeItem,
            fornecedor: (it.fornecedor ?? '').trim(), status: it.status ?? '', orc, contr,
          })
        }
      }
    }
    return lista
  }, [projetosRaw])

  // ── Filtros em cascata: cada lista de opções respeita os filtros anteriores ──
  const idsPermitidos = useMemo(() => {
    const ids = new Set<string>()
    for (const p of projetos) {
      if (fProjetos.size > 0 && !fProjetos.has(p.id)) continue
      if (fLocais.size > 0 && !fLocais.has(p.local)) continue
      if (fSegmentos.size > 0 && !fSegmentos.has(p.segmento)) continue
      if (fAnos.size > 0 && !fAnos.has(p.ano)) continue
      ids.add(p.id)
    }
    return ids
  }, [projetos, fProjetos, fLocais, fSegmentos, fAnos])

  const r1 = useMemo(() => todasLinhas.filter(r => idsPermitidos.has(r.projetoId)), [todasLinhas, idsPermitidos])
  const chavesGrupos = useMemo(() => {
    const set = new Set<string>()
    for (const g of grupos) if (fGrupos.has(g.id)) for (const i of g.itens) set.add(chaveItem(i.categoria, i.sub, i.item))
    return set
  }, [grupos, fGrupos])
  const rg = useMemo(() => (fGrupos.size ? r1.filter(r => chavesGrupos.has(chaveItem(r.categoria, r.sub, r.item))) : r1), [r1, fGrupos, chavesGrupos])
  const r2 = useMemo(() => (fCategorias.size ? rg.filter(r => fCategorias.has(r.categoria)) : rg), [rg, fCategorias])
  const r4 = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return r2.filter(r => (fItens.size === 0 || fItens.has(r.item)) && (!q || r.item.toLowerCase().includes(q) || r.sub.toLowerCase().includes(q)))
  }, [r2, fItens, busca])

  // Linhas exibidas (depende da leitura escolhida)
  const R = useMemo(() => r4.filter(r =>
    metrica === 'contratado' ? r.contr > 0 : metrica === 'orcado' ? r.orc > 0 : true,
  ), [r4, metrica])

  // Projetos separados por ano da festa; a bolinha mostra o ensino. Clicar no ano marca todos daquele ano.
  const opProjetos: OpcaoMulti[] = useMemo(() =>
    [...projetos]
      .sort((a, b) => (a.ano || '9999').localeCompare(b.ano || '9999') || a.nome.localeCompare(b.nome))
      .map(p => ({
        value: p.id, label: p.nome, grupo: p.ano ? `Festa em ${p.ano}` : 'Sem ano', cor: CORES_SEGMENTO[p.segmento],
        dica: `${p.segmento.replace('Ensino ', '')}${p.data ? ' · ' + p.data : ''}`,
      })),
  [projetos])

  const opLocais: OpcaoMulti[] = useMemo(() => {
    const cont = new Map<string, number>()
    for (const p of projetos) if (p.local) cont.set(p.local, (cont.get(p.local) ?? 0) + 1)
    return [...cont.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([l, n]) => ({ value: l, label: l, dica: `${n} proj.` }))
  }, [projetos])

  const opSegmentos: OpcaoMulti[] = useMemo(() => SEGMENTOS.map(sg => ({ value: sg, label: sg, cor: CORES_SEGMENTO[sg], dica: `${projetos.filter(p => p.segmento === sg).length} proj.` })), [projetos])

  const opAnos: OpcaoMulti[] = useMemo(() => {
    const cont = new Map<string, number>()
    for (const p of projetos) if (p.ano) cont.set(p.ano, (cont.get(p.ano) ?? 0) + 1)
    return [...cont.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([a, n]) => ({ value: a, label: a, dica: `${n} proj.` }))
  }, [projetos])

  const opGrupos: OpcaoMulti[] = useMemo(() => grupos.map(g => ({ value: g.id, label: g.nome, dica: `${g.itens.length} itens` })), [grupos])

  const opCategorias: OpcaoMulti[] = useMemo(() => {
    const tem = new Set(rg.map(r => r.categoria))
    return CATEGORIAS_ORDEM.filter(c => tem.has(c)).map(c => ({ value: c, label: c }))
  }, [rg])

  // Itens agrupados pela subcategoria (ex.: Infraestrutura, Decoração). Clicar no grupo marca todos os itens dele.
  const opItens: OpcaoMulti[] = useMemo(() => {
    const subDoItem = new Map<string, string>()
    for (const r of r2) if (!subDoItem.has(r.item)) subDoItem.set(r.item, r.sub)
    return [...subDoItem.entries()]
      .sort((a, b) => a[1].localeCompare(b[1]) || a[0].localeCompare(b[0]))
      .map(([item, sub]) => ({ value: item, label: item, grupo: sub }))
  }, [r2])

  const temFiltro = fProjetos.size + fLocais.size + fSegmentos.size + fAnos.size + fGrupos.size + fCategorias.size + fItens.size > 0 || busca.trim() !== ''
  function limparFiltros() {
    setFProjetos(new Set()); setFLocais(new Set()); setFSegmentos(new Set()); setFAnos(new Set()); setFGrupos(new Set()); setFCategorias(new Set()); setFItens(new Set()); setBusca('')
  }
  const abrirTudo = fItens.size + fGrupos.size > 0 || busca.trim() !== ''

  // Itens do filtro atual, de TODOS os projetos (o grupo é uma lista de itens, não de projetos).
  const itensParaGrupo = useMemo(() => {
    const q = busca.trim().toLowerCase()
    const mapa = new Map<string, { categoria: string; sub: string; item: string }>()
    for (const r of todasLinhas) {
      if (fGrupos.size && !chavesGrupos.has(chaveItem(r.categoria, r.sub, r.item))) continue
      if (fCategorias.size && !fCategorias.has(r.categoria)) continue
      if (fItens.size && !fItens.has(r.item)) continue
      if (q && !r.item.toLowerCase().includes(q) && !r.sub.toLowerCase().includes(q)) continue
      mapa.set(chaveItem(r.categoria, r.sub, r.item), { categoria: r.categoria, sub: r.sub, item: r.item })
    }
    return [...mapa.values()]
  }, [todasLinhas, fGrupos, chavesGrupos, fCategorias, fItens, busca])

  const totalItensDistintos = useMemo(() => new Set(todasLinhas.map(r => chaveItem(r.categoria, r.sub, r.item))).size, [todasLinhas])
  const podeSalvarGrupo = itensParaGrupo.length > 0 && itensParaGrupo.length < totalItensDistintos

  async function salvarGrupo() {
    const nome = nomeGrupo.trim()
    if (!nome || ocupado) return
    setMsgGrupo(null)
    const { data: auth } = await supabase.auth.getUser()
    if (!auth.user) { setMsgGrupo('Entre com o seu login para salvar grupos. A leitura continua liberada.'); return }
    const existente = grupos.find(g => g.nome.trim().toLowerCase() === nome.toLowerCase())
    if (existente && !window.confirm(`Já existe o grupo "${existente.nome}". Substituir os itens dele pelos ${itensParaGrupo.length} da tela?`)) return
    setOcupado(true)
    const base = { nome, itens: itensParaGrupo, atualizado_em: new Date().toISOString() }
    const { data, error } = existente
      ? await supabase.from('verbas_grupos').update(base).eq('id', existente.id).select('id').single()
      : await supabase.from('verbas_grupos').insert({ ...base, criado_por: auth.user.email ?? null }).select('id').single()
    setOcupado(false)
    if (error || !data) { setMsgGrupo(`Não consegui salvar: ${error?.message ?? 'sem resposta'}`); return }
    await carregarGrupos()
    // Passa a ver só o grupo recém-salvo, sem os outros filtros de item.
    setFCategorias(new Set()); setFItens(new Set()); setBusca('')
    setFGrupos(new Set([data.id as string]))
    setNomeGrupo(''); setPainelGrupos('nenhum')
  }

  async function excluirGrupo(g: GrupoSalvo) {
    if (!window.confirm(`Excluir o grupo "${g.nome}"? Os itens continuam existindo; só o grupo some.`)) return
    setMsgGrupo(null)
    const { data: auth } = await supabase.auth.getUser()
    if (!auth.user) { setMsgGrupo('Entre com o seu login para excluir grupos.'); return }
    const { error } = await supabase.from('verbas_grupos').delete().eq('id', g.id)
    if (error) { setMsgGrupo(`Não consegui excluir: ${error.message}`); return }
    setFGrupos(prev => { const n = new Set(prev); n.delete(g.id); return n })
    await carregarGrupos()
  }

  // ── Agregações ──────────────────────────────────────────────────────────────
  const kpi = useMemo(() => {
    let orc = 0, contr = 0, nContr = 0, dif = 0
    const projs = new Set<string>()
    for (const r of R) {
      orc += r.orc; contr += r.contr
      if (r.contr > 0) { nContr++; if (r.orc > 0) dif += r.orc - r.contr }
      projs.add(r.projetoId)
    }
    return { orc, contr, nContr, dif, nItens: R.length, nProj: projs.size }
  }, [R])

  const porCategoria = useMemo(() => {
    const m = new Map<string, Par>()
    for (const r of R) { const p = m.get(r.categoria) ?? { o: 0, c: 0 }; p.o += r.orc; p.c += r.contr; m.set(r.categoria, p) }
    return CATEGORIAS_ORDEM.filter(c => m.has(c)).map(c => ({ nome: c, ...m.get(c)! }))
  }, [R])

  const porProjeto = useMemo(() => {
    const m = new Map<string, Par>()
    for (const r of R) { const p = m.get(r.projetoId) ?? { o: 0, c: 0 }; p.o += r.orc; p.c += r.contr; m.set(r.projetoId, p) }
    const chave = (p: Par) => (metrica === 'contratado' ? p.c : p.o)
    return [...m.entries()]
      .map(([id, p]) => ({ id, ...p, nome: projetoPorId.get(id)?.nome ?? id, segmento: projetoPorId.get(id)?.segmento ?? '' }))
      .sort((a, b) => chave(b) - chave(a))
  }, [R, metrica, projetoPorId])

  const maxCat = Math.max(0, ...porCategoria.map(c => (metrica === 'contratado' ? c.c : Math.max(c.o, metrica === 'comparar' ? c.c : 0))))
  const maxProj = Math.max(0, ...porProjeto.map(c => (metrica === 'contratado' ? c.c : Math.max(c.o, metrica === 'comparar' ? c.c : 0))))

  // Visão "Por item": categoria → item (junta o mesmo item dos vários projetos)
  const gruposPorItem = useMemo(() => {
    interface PorProj { o: number; c: number; status: string; fornecedor: string }
    interface Grupo { chave: string; categoria: string; sub: string; item: string; o: number; c: number; projs: Map<string, PorProj> }
    const m = new Map<string, Grupo>()
    for (const r of R) {
      const chave = `${r.categoria}|${r.sub}|${r.item}`
      let g = m.get(chave)
      if (!g) { g = { chave, categoria: r.categoria, sub: r.sub, item: r.item, o: 0, c: 0, projs: new Map() }; m.set(chave, g) }
      g.o += r.orc; g.c += r.contr
      const pp = g.projs.get(r.projetoId) ?? { o: 0, c: 0, status: r.status, fornecedor: r.fornecedor }
      pp.o += r.orc; pp.c += r.contr
      if (!pp.fornecedor && r.fornecedor) pp.fornecedor = r.fornecedor
      g.projs.set(r.projetoId, pp)
    }
    const val = (g: Grupo) => (metrica === 'contratado' ? g.c : g.o)
    return CATEGORIAS_ORDEM
      .map(cat => {
        const itens = [...m.values()].filter(g => g.categoria === cat).sort((a, b) => val(b) - val(a) || a.item.localeCompare(b.item))
        return { categoria: cat, itens, o: itens.reduce((s, g) => s + g.o, 0), c: itens.reduce((s, g) => s + g.c, 0) }
      })
      .filter(c => c.itens.length > 0)
  }, [R, metrica])

  // Visão "Planilha": totais por categoria > sub > item × projeto (orçado e contratado)
  const planilha = useMemo(() => {
    const mapa = new Map<string, Par>()
    const soma = (k: string, r: Linha) => { const p = mapa.get(k) ?? { o: 0, c: 0 }; p.o += r.orc; p.c += r.contr; mapa.set(k, p) }
    const estrutura = new Map<string, Map<string, Set<string>>>()
    const pids = new Set<string>()
    for (const r of R) {
      pids.add(r.projetoId)
      for (const pid of [r.projetoId, '*']) {
        soma(`${r.categoria}|${r.sub}|${r.item}|${pid}`, r)
        soma(`${r.categoria}|${r.sub}||${pid}`, r)
        soma(`${r.categoria}|||${pid}`, r)
        soma(`|||${pid}`, r)
      }
      if (!estrutura.has(r.categoria)) estrutura.set(r.categoria, new Map())
      const subs = estrutura.get(r.categoria)!
      if (!subs.has(r.sub)) subs.set(r.sub, new Set())
      subs.get(r.sub)!.add(r.item)
    }
    const colunas = projetos.filter(p => pids.has(p.id))
    return { mapa, estrutura, colunas }
  }, [R, projetos])

  function exportar() {
    const colunas: ColunaProjeto[] = planilha.colunas.map(p => ({ id: p.id, nome: p.nome }))
    const conj = (nomeAba: string, pick: (r: Linha) => number): ConjuntoExport => {
      const blocos = montarBlocos(R, pick)
      const total: LinhaValores = { valores: {}, total: 0 }
      for (const b of blocos) for (const [pid, v] of Object.entries(b.valores)) { total.valores[pid] = (total.valores[pid] ?? 0) + v; total.total += v }
      return { nomeAba, blocos, totalGeral: total }
    }
    const conjuntos: ConjuntoExport[] = []
    if (metrica !== 'contratado') conjuntos.push(conj('Orçado', r => r.orc))
    if (metrica !== 'orcado') conjuntos.push(conj('Contratado', r => r.contr))
    exportarVerbasExcel(conjuntos, colunas)
  }

  function exportarPdf() {
    const descreve = (rotulo: string, sel: Set<string>, ops: OpcaoMulti[]) => {
      if (sel.size === 0) return null
      const nomes = ops.filter(o => sel.has(o.value)).map(o => o.label)
      return `${rotulo}: ${nomes.length > 5 ? `${nomes.slice(0, 5).join(', ')} +${nomes.length - 5}` : nomes.join(', ')}`
    }
    const filtros = [
      descreve('Projetos', fProjetos, opProjetos), descreve('Ensino', fSegmentos, opSegmentos), descreve('Ano da festa', fAnos, opAnos),
      descreve('Local', fLocais, opLocais), descreve('Grupo', fGrupos, opGrupos), descreve('Categoria', fCategorias, opCategorias),
      descreve('Item', fItens, opItens), busca.trim() ? `Busca: "${busca.trim()}"` : null,
    ].filter((x): x is string => x !== null)
    gerarPdfVerbas({
      metrica,
      filtros,
      resumo: { orc: kpi.orc, contr: kpi.contr, nItens: kpi.nItens, nProj: kpi.nProj, nContr: kpi.nContr, dif: kpi.dif },
      categorias: gruposPorItem.map(cat => ({
        nome: cat.categoria, o: cat.o, c: cat.c,
        itens: cat.itens.map(g => ({
          item: g.item, sub: g.sub, o: g.o, c: g.c,
          projetos: [...g.projs.entries()]
            .map(([pid, v]) => ({ nome: projetoPorId.get(pid)?.nome ?? pid, local: projetoPorId.get(pid)?.local ?? '', fornecedor: v.fornecedor, o: v.o, c: v.c }))
            .sort((a, b) => (metrica === 'contratado' ? b.c - a.c : b.o - a.o)),
        })),
      })),
    })
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  const difBom = kpi.dif >= 0

  return (
    <div className="space-y-5">

      {/* Cabeçalho */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-text-main">Verbas</h1>
          <p className="mt-0.5 text-sm text-text-muted">Quanto temos para gastar em cada item, por projeto.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Segmentado
            valor={metrica}
            onChange={setMetrica}
            opcoes={[
              { v: 'comparar', rotulo: 'Orçado + contratado' },
              { v: 'orcado', rotulo: 'Só orçado' },
              { v: 'contratado', rotulo: 'Só contratado' },
            ]}
          />
          <button onClick={exportarPdf} disabled={R.length === 0} className="btn-secondary flex items-center gap-2 disabled:opacity-60">
            <FileText size={16} /> Exportar PDF
          </button>
          <button onClick={exportar} disabled={R.length === 0} className="btn-primary flex items-center gap-2 disabled:opacity-60">
            <Download size={16} /> Exportar Excel
          </button>
        </div>
      </div>

      {/* Legenda */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-text-muted">
        <span className="inline-flex items-center gap-1.5"><i className="h-2 w-5 rounded-full" style={{ background: COR_ORC }} /> Orçado: o que previmos gastar</span>
        <span className="inline-flex items-center gap-1.5"><i className="h-2 w-5 rounded-full" style={{ background: COR_CONTR }} /> Contratado: o que já está fechado com fornecedor</span>
      </div>

      {/* Assistente de perguntas */}
      <AssistenteVerbas />

      {/* Filtros */}
      <div className="card !p-4">
        <div className="flex flex-wrap items-center gap-3">
          <MultiSelect rotulo="Projetos" vazio="Todos" opcoes={opProjetos} selecionados={fProjetos} onChange={setFProjetos} largura={340} />
          <MultiSelect rotulo="Ensino" vazio="Todos" opcoes={opSegmentos} selecionados={fSegmentos} onChange={setFSegmentos} />
          <MultiSelect rotulo="Ano da festa" vazio="Todos" opcoes={opAnos} selecionados={fAnos} onChange={setFAnos} />
          {opLocais.length > 0 && <MultiSelect rotulo="Local" vazio="Todos" opcoes={opLocais} selecionados={fLocais} onChange={setFLocais} />}
          <MultiSelect rotulo="Grupo salvo" vazio={grupos.length ? 'Nenhum' : 'Sem grupos'} opcoes={opGrupos} selecionados={fGrupos} onChange={v => { setFGrupos(v); setFCategorias(new Set()); setFItens(new Set()) }} />
          <MultiSelect rotulo="Categoria" vazio="Todas" opcoes={opCategorias} selecionados={fCategorias} onChange={v => { setFCategorias(v); setFItens(new Set()) }} />
          <MultiSelect rotulo="Item" vazio="Todos" opcoes={opItens} selecionados={fItens} onChange={setFItens} largura={360} />
          <input
            type="text"
            placeholder="Buscar por nome…"
            value={busca}
            onChange={e => setBusca(e.target.value)}
            className="min-w-44 flex-1 rounded-lg border border-white/10 bg-surface-2 px-3 py-2.5 text-sm text-text-main placeholder:text-text-muted"
          />
          {temFiltro && (
            <button onClick={limparFiltros} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm text-text-muted hover:text-text-main">
              <FilterX size={15} /> Limpar
            </button>
          )}
        </div>
      </div>

      {/* Grupos salvos */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <button
          type="button"
          disabled={!podeSalvarGrupo}
          onClick={() => { setPainelGrupos(p => (p === 'salvar' ? 'nenhum' : 'salvar')); setMsgGrupo(null) }}
          title={podeSalvarGrupo ? 'Guarda os itens que estão no filtro como um grupo com nome' : 'Filtre por categoria ou item para poder salvar um grupo'}
          className="rounded-lg border border-white/10 bg-surface-2 px-3 py-1.5 text-text-main hover:border-white/25 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Salvar filtro como grupo
        </button>
        <button
          type="button"
          onClick={() => { setPainelGrupos(p => (p === 'gerenciar' ? 'nenhum' : 'gerenciar')); setMsgGrupo(null) }}
          className="rounded-lg px-3 py-1.5 text-text-muted hover:text-text-main"
        >
          Gerenciar grupos ({grupos.length})
        </button>
        {painelGrupos === 'salvar' && (
          <span className="flex flex-wrap items-center gap-2">
            <input
              autoFocus
              value={nomeGrupo}
              onChange={e => setNomeGrupo(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void salvarGrupo() }}
              placeholder="Nome do grupo (ex.: Mobiliário)"
              className="w-64 rounded-lg border border-white/10 bg-surface-2 px-3 py-1.5 text-text-main placeholder:text-text-muted"
            />
            <button type="button" onClick={() => void salvarGrupo()} disabled={!nomeGrupo.trim() || ocupado} className="btn-primary !py-1.5 disabled:opacity-50">
              {ocupado ? 'Salvando…' : `Salvar ${itensParaGrupo.length} itens`}
            </button>
          </span>
        )}
      </div>
      {painelGrupos === 'gerenciar' && (
        <div className="card !p-3">
          {grupos.length === 0 ? (
            <p className="px-1 text-sm text-text-muted">Nenhum grupo salvo ainda. Filtre os itens e use "Salvar filtro como grupo".</p>
          ) : (
            <ul className="divide-y divide-white/5">
              {grupos.map(g => (
                <li key={g.id} className="flex items-center gap-3 px-1 py-2 text-sm">
                  <span className="font-medium text-text-main">{g.nome}</span>
                  <span className="text-xs text-text-muted">{g.itens.length} itens</span>
                  <button type="button" className="ml-auto text-xs text-primary hover:underline" onClick={() => { setFGrupos(new Set([g.id])); setPainelGrupos('nenhum') }}>Ver</button>
                  <button type="button" className="text-xs text-danger hover:underline" onClick={() => void excluirGrupo(g)}>Excluir</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {msgGrupo && <p className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-2 text-sm text-text-main">{msgGrupo}</p>}

      {erro && <p className="rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">Não consegui carregar os projetos: {erro}</p>}

      {loading ? (
        <div className="flex h-32 items-center justify-center gap-2 text-sm text-text-muted">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" /> Carregando…
        </div>
      ) : R.length === 0 ? (
        <p className="card py-12 text-center text-sm text-text-muted">Nenhum item encontrado com esses filtros.</p>
      ) : (
        <>
          {/* Resumo */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi rotulo="Orçado" valor={formatBRL(kpi.orc)} sub={`${kpi.nItens} itens · ${kpi.nProj} projeto(s)`} cor={COR_ORC} />
            <Kpi
              rotulo="Contratado"
              valor={formatBRL(kpi.contr)}
              sub={kpi.nContr > 0 ? `${kpi.nContr} de ${kpi.nItens} itens já fechados` : 'nada fechado ainda'}
              cor={COR_CONTR}
            />
            <Kpi
              rotulo="Diferença nos itens fechados"
              valor={kpi.nContr > 0 ? formatBRL(Math.abs(kpi.dif)) : '—'}
              sub={kpi.nContr === 0 ? 'sem itens fechados' : difBom ? 'abaixo do orçado (bom)' : 'acima do orçado'}
              cor={kpi.nContr === 0 ? undefined : difBom ? COR_BOM : COR_RUIM}
            />
            <Kpi
              rotulo="Média por projeto"
              valor={formatBRL(kpi.nProj > 0 ? (metrica === 'contratado' ? kpi.contr : kpi.orc) / kpi.nProj : 0)}
              sub={metrica === 'contratado' ? 'contratado ÷ projetos' : 'orçado ÷ projetos'}
            />
          </div>

          {/* Por categoria e por projeto */}
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="card">
              <h2 className="mb-3 text-sm font-semibold text-text-main">Por categoria</h2>
              <div className="space-y-3">
                {porCategoria.map(c => (
                  <div key={c.nome}>
                    <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
                      <span className="text-text-main">{c.nome}</span>
                      <Valores orc={c.o} contr={c.c} metrica={metrica} tamanho="xs" />
                    </div>
                    <Barras orc={c.o} contr={c.c} max={maxCat} metrica={metrica} />
                  </div>
                ))}
              </div>
            </div>
            <div className="card">
              <h2 className="mb-3 text-sm font-semibold text-text-main">Por projeto <span className="font-normal text-text-muted">· {porProjeto.length}</span></h2>
              <div className="max-h-[420px] space-y-3 overflow-y-auto pr-1">
                {porProjeto.map(p => (
                  <div key={p.id}>
                    <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
                      <span className="flex min-w-0 items-center gap-2 text-text-main">
                        <i className="h-2 w-2 shrink-0 rounded-full" style={{ background: CORES_SEGMENTO[p.segmento] ?? '#8892b0' }} />
                        <span className="truncate">{p.nome}</span>
                      </span>
                      <Valores orc={p.o} contr={p.c} metrica={metrica} tamanho="xs" />
                    </div>
                    <Barras orc={p.o} contr={p.c} max={maxProj} metrica={metrica} />
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Detalhe */}
          <div className="card !p-0 overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
              <h2 className="text-sm font-semibold text-text-main">Detalhe</h2>
              <Segmentado
                valor={visao}
                onChange={setVisao}
                opcoes={[{ v: 'itens', rotulo: 'Por item' }, { v: 'planilha', rotulo: 'Planilha por projeto' }]}
              />
            </div>

            {visao === 'itens' ? (
              <div>
                {gruposPorItem.map(cat => {
                  const aberta = catAbertas[cat.categoria] ?? abrirTudo
                  return (
                    <div key={cat.categoria} className="border-b border-white/10 last:border-b-0">
                      <button
                        type="button"
                        onClick={() => setCatAbertas(p => ({ ...p, [cat.categoria]: !aberta }))}
                        className="flex w-full items-center gap-2 bg-white/[0.03] px-4 py-3 text-left hover:bg-white/[0.06]"
                      >
                        {aberta ? <ChevronDown size={16} className="text-text-muted" /> : <ChevronRight size={16} className="text-text-muted" />}
                        <span className="text-sm font-bold uppercase tracking-wide text-text-main">{cat.categoria}</span>
                        <span className="text-xs text-text-muted">· {cat.itens.length} item(ns)</span>
                        <span className="ml-auto"><Valores orc={cat.o} contr={cat.c} metrica={metrica} /></span>
                      </button>
                      {aberta && cat.itens.map(g => {
                        const open = itensAbertos[g.chave] ?? false
                        const maxItem = Math.max(...cat.itens.map(x => (metrica === 'contratado' ? x.c : Math.max(x.o, metrica === 'comparar' ? x.c : 0))))
                        const projsOrdenados = [...g.projs.entries()]
                          .map(([pid, v]) => ({ pid, ...v, p: projetoPorId.get(pid) }))
                          .sort((a, b) => (metrica === 'contratado' ? b.c - a.c : b.o - a.o))
                        return (
                          <div key={g.chave} className="border-t border-white/5">
                            <button
                              type="button"
                              onClick={() => setItensAbertos(p => ({ ...p, [g.chave]: !open }))}
                              className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 text-left hover:bg-white/5 sm:flex-nowrap"
                            >
                              {open ? <ChevronDown size={14} className="shrink-0 text-text-muted" /> : <ChevronRight size={14} className="shrink-0 text-text-muted" />}
                              <span className="min-w-0 flex-1 basis-48">
                                <span className="block truncate text-sm font-medium text-text-main">{g.item}</span>
                                <span className="block truncate text-xs text-text-muted">{g.sub} · {g.projs.size} projeto(s)</span>
                              </span>
                              <span className="order-last w-full sm:order-none sm:w-44"><Barras orc={g.o} contr={g.c} max={maxItem} metrica={metrica} /></span>
                              <span className="min-w-[110px]"><Valores orc={g.o} contr={g.c} metrica={metrica} /></span>
                            </button>
                            {open && (
                              <div className="bg-black/10 px-4 pb-3 pt-1 sm:pl-11">
                                <table className="w-full text-sm">
                                  <thead>
                                    <tr className="text-[11px] uppercase tracking-wider text-text-muted">
                                      <th className="py-1.5 text-left font-medium">Projeto</th>
                                      <th className="hidden py-1.5 text-left font-medium sm:table-cell">Fornecedor</th>
                                      {metrica !== 'contratado' && <th className="py-1.5 text-right font-medium">Orçado</th>}
                                      {metrica !== 'orcado' && <th className="py-1.5 text-right font-medium">Contratado</th>}
                                      <th className="hidden py-1.5 text-right font-medium md:table-cell">Por convidado</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {projsOrdenados.map(pp => (
                                      <tr key={pp.pid} className="border-t border-white/5">
                                        <td className="py-1.5 pr-3 text-text-main">
                                          <span className="inline-flex items-center gap-2">
                                            <i className="h-2 w-2 shrink-0 rounded-full" style={{ background: CORES_SEGMENTO[pp.p?.segmento ?? ''] ?? '#8892b0' }} />
                                            {pp.p?.nome ?? pp.pid}
                                            {pp.p?.local && <span className="hidden text-xs text-text-muted md:inline">· {pp.p.local}</span>}
                                          </span>
                                        </td>
                                        <td className="hidden py-1.5 pr-3 text-text-muted sm:table-cell">{pp.fornecedor || '—'}</td>
                                        {metrica !== 'contratado' && (
                                          <td className="py-1.5 text-right tabular-nums" style={{ color: COR_ORC }}>{pp.o > 0 ? formatBRL(pp.o) : <span className="text-text-muted/50">—</span>}</td>
                                        )}
                                        {metrica !== 'orcado' && (
                                          <td className="py-1.5 text-right tabular-nums">
                                            {pp.c > 0
                                              ? <span style={{ color: pp.o > 0 && pp.c > pp.o ? COR_RUIM : COR_CONTR }}>{formatBRL(pp.c)}</span>
                                              : <span className="text-xs text-text-muted/60">a contratar</span>}
                                          </td>
                                        )}
                                        <td className="hidden py-1.5 text-right tabular-nums text-text-muted md:table-cell">
                                          {(pp.p?.convidados ?? 0) > 0 ? formatBRL((metrica === 'contratado' ? pp.c : pp.o) / pp.p!.convidados) : '—'}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-white/10">
                      <th className="sticky left-0 z-10 min-w-[220px] bg-surface px-3 py-2.5 text-left text-xs font-medium text-text-muted">Categoria / Subcategoria / Item</th>
                      {planilha.colunas.map(p => (
                        <th key={p.id} className="min-w-[140px] whitespace-nowrap border-l border-dashed border-white/15 px-3 py-2.5 text-right text-xs font-medium text-text-muted">
                          <span className="inline-flex items-center justify-end gap-1.5">
                            <i className="h-2 w-2 rounded-full" style={{ background: CORES_SEGMENTO[p.segmento] ?? '#8892b0' }} />
                            {p.nome}
                          </span>
                        </th>
                      ))}
                      <th className="min-w-[150px] whitespace-nowrap border-l border-dashed border-white/15 px-3 py-2.5 text-right text-xs font-semibold text-primary">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {CATEGORIAS_ORDEM.filter(c => planilha.estrutura.has(c)).map(cat => {
                      const aberta = catAbertas[cat] ?? abrirTudo
                      const subs = planilha.estrutura.get(cat)!
                      const cel = (k: string, forte = false) => {
                        const p = planilha.mapa.get(k)
                        if (!p || (p.o <= 0 && p.c <= 0)) return <span className="text-white/20">—</span>
                        return <Valores orc={p.o} contr={p.c} metrica={metrica} tamanho={forte ? 'sm' : 'xs'} />
                      }
                      return (
                        <Fragment key={cat}>
                          <tr className="cursor-pointer bg-primary/10 hover:opacity-90" onClick={() => setCatAbertas(p => ({ ...p, [cat]: !aberta }))}>
                            <td className="sticky left-0 z-10 px-3 py-2 text-xs font-bold uppercase tracking-wide text-primary" style={{ background: 'rgba(233,69,96,0.14)' }}>
                              <span className="inline-flex items-center gap-1.5">{aberta ? <ChevronDown size={13} /> : <ChevronRight size={13} />}{cat}</span>
                            </td>
                            {planilha.colunas.map(p => (
                              <td key={p.id} className="border-l border-dashed border-white/15 px-3 py-2 text-right">{cel(`${cat}|||${p.id}`, true)}</td>
                            ))}
                            <td className="border-l border-dashed border-white/15 px-3 py-2 text-right">{cel(`${cat}|||*`, true)}</td>
                          </tr>
                          {aberta && [...subs.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([sub, itens]) => (
                            <Fragment key={sub}>
                              {[...itens].sort((a, b) => a.localeCompare(b)).map(item => (
                                <tr key={item} className="border-b border-white/5 hover:bg-white/5">
                                  <td className="sticky left-0 z-10 bg-surface px-3 py-2 text-text-main">
                                    <span className="text-xs text-text-muted">{sub}</span><span className="text-text-muted/50"> — </span>{item}
                                  </td>
                                  {planilha.colunas.map(p => (
                                    <td key={p.id} className="border-l border-dashed border-white/10 px-3 py-2 text-right">{cel(`${cat}|${sub}|${item}|${p.id}`)}</td>
                                  ))}
                                  <td className="border-l border-dashed border-white/10 px-3 py-2 text-right">{cel(`${cat}|${sub}|${item}|*`)}</td>
                                </tr>
                              ))}
                              <tr className="border-b border-white/10 bg-white/[0.03]">
                                <td className="sticky left-0 z-10 bg-surface px-3 py-1.5 text-xs font-semibold text-text-muted">Subtotal — {sub}</td>
                                {planilha.colunas.map(p => (
                                  <td key={p.id} className="border-l border-dashed border-white/10 px-3 py-1.5 text-right">{cel(`${cat}|${sub}||${p.id}`)}</td>
                                ))}
                                <td className="border-l border-dashed border-white/10 px-3 py-1.5 text-right">{cel(`${cat}|${sub}||*`)}</td>
                              </tr>
                            </Fragment>
                          ))}
                        </Fragment>
                      )
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-white/20 bg-white/[0.04]">
                      <td className="sticky left-0 z-10 bg-surface px-3 py-3 text-sm font-bold text-text-main">TOTAL GERAL</td>
                      {planilha.colunas.map(p => {
                        const t = planilha.mapa.get(`|||${p.id}`)
                        return <td key={p.id} className="border-l border-dashed border-white/15 px-3 py-3 text-right">{t ? <Valores orc={t.o} contr={t.c} metrica={metrica} /> : '—'}</td>
                      })}
                      <td className="border-l border-dashed border-white/15 px-3 py-3 text-right">
                        {(() => { const t = planilha.mapa.get('|||*'); return t ? <Valores orc={t.o} contr={t.c} metrica={metrica} /> : '—' })()}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
