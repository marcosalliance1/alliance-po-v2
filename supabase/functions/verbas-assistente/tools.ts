// Ferramentas de consulta do assistente de Verbas. Código puro (sem APIs do Deno), para poder ser testado em Node.
// Só enxerga CUSTOS de produção dos projetos (orçado, contratado, fornecedor, status) — nunca receita, margem, comissão ou pagamentos.

export interface ItemRaw {
  item?: string
  subcategoria?: string
  fornecedor?: string
  status?: string
  valorOrcado?: number
  valorContratado?: number
  valorFinal?: number
}
export interface SecaoRaw { nome?: string; itens?: ItemRaw[] }
export interface ProjetoRaw {
  id: string
  tap?: { tipoEscola?: string; turma?: string; instituicao?: string; curso?: string; local?: string; dataEvento?: string; anoRealizacao?: number }
  secoes?: SecaoRaw[]
}
export interface GrupoRaw { nome: string; itens: { categoria: string; sub: string; item: string }[] }

export interface Linha {
  projeto: string
  ensino: string
  ano: number | null
  local: string
  data: string
  categoria: string
  subcategoria: string
  item: string
  fornecedor: string
  status: string
  orcado: number
  contratado: number
}

const CATEGORIAS = ['Produção', 'Artístico', 'Equipe', 'Bar & Food e Outros', 'Cerimônia Religiosa', 'Colação de Grau'] as const

export const norm = (s: unknown) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()

// Mesma regra da aba Verbas: administrativo e pré-eventos ficam de fora.
export function categoriaDaSecao(nomeSecao: string): string | null {
  const n = norm(nomeSecao)
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

const ensinoDe = (t?: string) => (t === 'SUPERIOR' ? 'Ensino Superior' : t === 'FUNDAMENTAL' ? '9º Ano' : 'Ensino Médio')

// Contratado = valor final dos itens com status "fechado" (regra da coluna Valor Final da P.O.).
function contratadoDe(it: ItemRaw): number {
  if (it.status !== 'fechado') return 0
  const v = (it.valorFinal ?? 0) > 0 ? it.valorFinal! : (it.valorContratado ?? 0)
  return v > 0 ? v : 0
}

export function montarLinhas(projetos: ProjetoRaw[]): Linha[] {
  const out: Linha[] = []
  for (const p of projetos) {
    const tap = p.tap ?? {}
    const nome = tap.turma || `${tap.instituicao ?? ''} ${tap.curso ?? ''}`.trim() || p.id.slice(0, 6)
    const ano = tap.anoRealizacao || Number((tap.dataEvento ?? '').slice(0, 4)) || null
    for (const secao of p.secoes ?? []) {
      const categoria = categoriaDaSecao(secao.nome ?? '')
      if (!categoria) continue
      for (const it of secao.itens ?? []) {
        if (!it.subcategoria?.trim()) continue // item-mãe / linha de grupo
        const orcado = it.valorOrcado ?? 0
        const contratado = contratadoDe(it)
        if (orcado <= 0 && contratado <= 0) continue
        out.push({
          projeto: nome, ensino: ensinoDe(tap.tipoEscola), ano, local: (tap.local ?? '').trim(), data: (tap.dataEvento ?? '').slice(0, 10),
          categoria, subcategoria: it.subcategoria.trim(), item: (it.item || '(sem nome)').trim(),
          fornecedor: (it.fornecedor ?? '').trim(), status: it.status ?? '', orcado, contratado,
        })
      }
    }
  }
  return out
}

const r2 = (x: number) => Math.round(x * 100) / 100

// 'Espaço Ava' e 'ESPAÇO AVA' são o mesmo lugar: agrupa pela forma sem acento/caixa, mostrando a primeira grafia vista.
const grafiasLocal = new Map<string, string>()
function localCanonico(local: string): string {
  const k = norm(local)
  if (!k) return ''
  if (!grafiasLocal.has(k)) grafiasLocal.set(k, local)
  return grafiasLocal.get(k)!
}

// ── Definições das ferramentas (formato da Messages API: name, description, input_schema) ──
export const FERRAMENTAS = [
  {
    name: 'listar_projetos',
    description:
      'Lista os projetos (turmas) com ensino (9º Ano, Ensino Médio, Ensino Superior), ano de conclusão da festa, local e data do evento. ' +
      'Use para descobrir os nomes exatos dos projetos, os locais e os anos existentes antes de filtrar.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'listar_grupos',
    description: 'Lista os grupos de itens salvos pela equipe na aba Verbas (ex.: Mobiliário, Palco), com a quantidade de itens de cada um.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'buscar_itens',
    description:
      'Consulta itens de custo de produção dos projetos: valores ORÇADO e CONTRATADO (contratado = só itens já fechados com fornecedor; itens ainda não fechados têm contratado 0). ' +
      'Devolve totais, um agrupamento e as linhas de detalhe (projeto, local, categoria, item, fornecedor, orçado, contratado). ' +
      'Todos os filtros são opcionais e se combinam (E). Textos casam por trecho, sem diferenciar maiúsculas/acentos.',
    input_schema: {
      type: 'object',
      properties: {
        termos: { type: 'array', items: { type: 'string' }, description: 'Trechos do nome do item ou da subcategoria (OU entre eles). Ex.: ["gerador"], ["floral","flor"].' },
        categorias: { type: 'array', items: { type: 'string', enum: [...CATEGORIAS] }, description: 'Categorias da P.O.' },
        projetos: { type: 'array', items: { type: 'string' }, description: 'Trechos do nome do projeto. Ex.: ["CMMG 74"].' },
        anos: { type: 'array', items: { type: 'integer' }, description: 'Ano de conclusão da festa. Ex.: [2026].' },
        ensino: { type: 'array', items: { type: 'string', enum: ['9º Ano', 'Ensino Médio', 'Ensino Superior'] } },
        locais: { type: 'array', items: { type: 'string' }, description: 'Trechos do nome do local do evento. Ex.: ["Expominas"].' },
        grupo: { type: 'string', description: 'Nome de um grupo salvo (veja listar_grupos): restringe aos itens do grupo.' },
        somente_contratados: { type: 'boolean', description: 'Se true, só itens já contratados (fechados).' },
        agrupar_por: { type: 'string', enum: ['item', 'projeto', 'local', 'categoria', 'ano', 'ensino'], description: 'Como agrupar o resumo. Padrão: projeto.' },
      },
      additionalProperties: false,
    },
  },
] as const

const LIMITE_LINHAS = 80
const LIMITE_GRUPOS = 60

type Entrada = Record<string, unknown>
const lista = (v: unknown): string[] => (Array.isArray(v) ? v.map(x => String(x)).filter(Boolean) : [])

export function executarFerramenta(nome: string, entrada: Entrada, linhas: Linha[], grupos: GrupoRaw[]): unknown {
  if (nome === 'listar_projetos') {
    const m = new Map<string, { projeto: string; ensino: string; ano: number | null; local: string; data: string }>()
    for (const l of linhas) if (!m.has(l.projeto)) m.set(l.projeto, { projeto: l.projeto, ensino: l.ensino, ano: l.ano, local: l.local, data: l.data })
    return { projetos: [...m.values()].sort((a, b) => a.projeto.localeCompare(b.projeto)) }
  }

  if (nome === 'listar_grupos') {
    return { grupos: grupos.map(g => ({ nome: g.nome, itens: g.itens.length })) }
  }

  if (nome === 'buscar_itens') {
    const termos = lista(entrada.termos).map(norm)
    const cats = lista(entrada.categorias).map(norm)
    const projs = lista(entrada.projetos).map(norm)
    const locais = lista(entrada.locais).map(norm)
    const ensino = lista(entrada.ensino).map(norm)
    const anos = Array.isArray(entrada.anos) ? entrada.anos.map(Number).filter(Number.isFinite) : []
    const soContr = entrada.somente_contratados === true
    const agrupar = ['item', 'projeto', 'local', 'categoria', 'ano', 'ensino'].includes(String(entrada.agrupar_por)) ? String(entrada.agrupar_por) : 'projeto'

    let chavesGrupo: Set<string> | null = null
    let grupoAviso: string | undefined
    if (typeof entrada.grupo === 'string' && entrada.grupo.trim()) {
      const g = grupos.find(x => norm(x.nome) === norm(entrada.grupo))
      if (!g) grupoAviso = `Grupo "${entrada.grupo}" não encontrado; filtro de grupo ignorado.`
      else chavesGrupo = new Set(g.itens.map(i => `${i.categoria}|${i.sub}|${i.item}`))
    }

    const filtradas = linhas.filter(l => {
      if (termos.length && !termos.some(t => norm(l.item).includes(t) || norm(l.subcategoria).includes(t))) return false
      if (cats.length && !cats.includes(norm(l.categoria))) return false
      if (projs.length && !projs.some(p => norm(l.projeto).includes(p))) return false
      if (locais.length && !locais.some(p => norm(l.local).includes(p))) return false
      if (ensino.length && !ensino.includes(norm(l.ensino))) return false
      if (anos.length && (l.ano === null || !anos.includes(l.ano))) return false
      if (chavesGrupo && !chavesGrupo.has(`${l.categoria}|${l.subcategoria}|${l.item}`)) return false
      if (soContr && l.contratado <= 0) return false
      return true
    })

    const chave = (l: Linha) =>
      agrupar === 'item' ? l.item : agrupar === 'local' ? (localCanonico(l.local) || '(sem local)') : agrupar === 'categoria' ? l.categoria
        : agrupar === 'ano' ? String(l.ano ?? 'sem ano') : agrupar === 'ensino' ? l.ensino : l.projeto
    const g = new Map<string, { orcado: number; contratado: number; itens: number; projetos: Set<string> }>()
    let orc = 0, contr = 0
    const projetos = new Set<string>()
    for (const l of filtradas) {
      orc += l.orcado; contr += l.contratado; projetos.add(l.projeto)
      const k = chave(l)
      const e = g.get(k) ?? { orcado: 0, contratado: 0, itens: 0, projetos: new Set<string>() }
      e.orcado += l.orcado; e.contratado += l.contratado; e.itens++; e.projetos.add(l.projeto)
      g.set(k, e)
    }
    const agrupado = [...g.entries()]
      .map(([k, e]) => ({ [agrupar]: k, orcado: r2(e.orcado), contratado: r2(e.contratado), linhas: e.itens, projetos: e.projetos.size }))
      .sort((a, b) => b.orcado - a.orcado)
    const detalhe = [...filtradas].sort((a, b) => b.orcado - a.orcado || b.contratado - a.contratado)

    return {
      aviso: grupoAviso,
      encontrou: filtradas.length,
      totais: { orcado: r2(orc), contratado: r2(contr), linhas: filtradas.length, projetos: projetos.size },
      agrupado_por: agrupar,
      agrupado: agrupado.slice(0, LIMITE_GRUPOS),
      agrupado_truncado: agrupado.length > LIMITE_GRUPOS,
      linhas: detalhe.slice(0, LIMITE_LINHAS).map(l => ({
        projeto: l.projeto, ano: l.ano, local: l.local || null, categoria: l.categoria, subcategoria: l.subcategoria, item: l.item,
        fornecedor: l.fornecedor || null, orcado: r2(l.orcado), contratado: r2(l.contratado), status: l.status || null,
      })),
      linhas_truncadas: detalhe.length > LIMITE_LINHAS,
    }
  }

  return { erro: `Ferramenta desconhecida: ${nome}` }
}
